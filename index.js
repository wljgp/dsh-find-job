import { defineTool } from '@deepseek-ai/dsh-tools'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { inflateSync, inflateRawSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'

export const inject = ['llm', 'tools']

const EXTENSION_DIR = fileURLToPath(new URL('./find-job', import.meta.url))

function openExtensionDir() {
  if (process.platform !== 'win32') return { ok: false, message: '仅支持 Windows' }
  try {
    spawn('explorer.exe', [EXTENSION_DIR], { detached: true, stdio: 'ignore' }).unref()
    return { ok: true, path: EXTENSION_DIR }
  } catch (e) {
    return { ok: false, message: String((e && e.message) || e) }
  }
}

// 数据库路径优先级：config.dbPath > 环境变量 FIND_JOB_DB_PATH > 用户主目录 ~/.find-job/job_matcher.db
const DEFAULT_DB_PATH = process.env.FIND_JOB_DB_PATH || join(homedir(), '.find-job', 'job_matcher.db')
const DEFAULT_MODEL = 'deepseek-v4-pro'

// 跟随 DSH 的默认模型（profile 里 agent-default-model 的 provider/model），
// 这样插件与「对话框默认使用的模型」保持一致，而不是插件另配一份。
function readAgentDefaults() {
  try {
    const profile = process.env.DSH_PROFILE || 'desktop'
    const patchPath = join(homedir(), '.dsh', 'profiles', profile, 'cordis.patch.yml')
    const text = readFileSync(patchPath, 'utf8')
    const block = text.match(/id:\s*agent-default-model[\s\S]{0,500}/)
    if (!block) return null
    const pm = block[0].match(/provider:\s*([\w-]+)/)
    const mm = block[0].match(/model:\s*([\w.-]+)/)
    if (!pm && !mm) return null
    return { provider: pm ? pm[1] : null, model: mm ? mm[1] : null }
  } catch { return null }
}

// ---------- 提示词（与 FastAPI 版 app/jd.py、app/tips.py 保持一致） ----------

const MATCH_SYSTEM = [
  '你是资深职业顾问。基于求职者的能力画像对职位描述打分（0~100 整数），并给出匹配理由。',
  '',
  '规则：',
  '1. 只依据「已确认能力」与「履历摘要」中的事实打分和写理由，逐条引用证据，不编造。',
  '2. 经验年限是软信号：只写入理由，不据此大幅扣分；城市/薪资硬过滤已由系统预先完成，你无需重复判断。',
  '3. 区分度要求：明显匹配 70+；一般相关 50~69；不相关 40 以下。给分克制，不要人人 80。',
  '4. 匹配理由 3~6 条：每条把画像证据与职位要求对应起来；不足 3 条就写几条。',
  '5. 输出严格 JSON（不要输出 JSON 以外的内容）：',
  '{"score": 0, "dims": [{"维度": "核心能力匹配", "分": 80, "说明": "..."}], "reasons": ["..."], "misses": ["..."], "suggestion": "..."}',
  'dims 维度示例：核心能力匹配、行业与业务经验、工具与方法、软素质与协作；每项给 0~100 分并一句话说明。',
  'misses：职位描述明确要求但画像缺少的关键项（最多 3 条，没有则空数组）。',
  'suggestion：一句话投递建议（如"建议重点突出 X 项目经验"）。',
].join('\n')

const GREETING_SYSTEM = [
  '你是求职沟通顾问。为求职者写一段发给招聘者的「打招呼」开场白。',
  '',
  '背景：BOSS直聘等平台要求先发打招呼，招聘者回复后才能投递简历，所以开场白必须短、突出匹配、引导对方回复。',
  '',
  '铁律：',
  '1. 只依据给定材料（目标职位描述 + 该职位的匹配理由），绝不编造经历、数据、学历或头衔；匹配理由里没提到的背景不要写。',
  '2. 语气自然、专业、有亲和力，面向招聘者本人；不要堆砌「我很优秀」「吃苦耐劳」这类空话。',
  '3. 主体 80~120 字：一句自我介绍（匹配理由中体现的职位/年限，没有就不写）+ 一两个最相关的匹配点（对应职位要求）+ 一句期待沟通。',
  '4. 输出严格 JSON（不要输出 JSON 以外的内容）：',
  '{"开场白": "...", "备用话术": "...", "要点": ["..."]}',
  '开场白与备用话术各一段、可直接复制发送；要点 2~3 条点出这段话里的匹配依据。',
].join('\n')

const GAP_SYSTEM = [
  '你是资深职业顾问。基于求职者的能力画像、匹配统计与高频缺口，输出差距分析与提升建议。',
  '',
  '规则：',
  '1. 只依据给定材料，不编造事实；数据不足时如实说明。',
  '2. 重点分析高频缺口背后的能力短板，给出可执行的提升建议（学习方向、项目实践、简历呈现）。',
  '3. 输出严格 JSON（不要输出 JSON 以外的内容）：',
  '{"总体判断": "...", "能力短板": ["..."], "提升建议": ["..."], "简历呈现建议": ["..."]}',
  '每项 2~4 条，简洁具体。',
].join('\n')

const REWRITE_SYSTEM = [
  '你是资深简历顾问。基于简历原文、已确认能力画像、目标求职方向，以及一批参考职位的共性要求（匹配理由），为该方向写一份完整、可投递、结果导向的调整后简历。',
  '',
  '铁律：',
  '1. 绝不编造经历、数据、技能、学历或头衔；只能重组、取舍、突出简历原文与画像中已有的事实。所有数字必须来自原文，不得放大或虚构。',
  '2. 推断能力只有在「已确认能力」中列出才可写入。',
  '3. 个人概述 2~3 句：第 1 句一句话定位（方向 + 年限 + 核心领域），第 2 句列 2~3 项最有分量的量化证据，第 3 句点出差异化（如 AI 应用能力）。禁用「擅长…闭环」「负责…全流程」这类空泛套话。',
  '4. 工作经历是简历主体，必须逐段完整保留、不得删除任何一段（保持时间线从最早到最近连续、不断档）。选择与目标方向最相关的 2~3 段作为重点，每段展开写 3~4 条 bullet，把原文该段的具体动作、机制、量化成果全部纳入（数字不得遗漏、不得放大）；其余次要/早期经历每段压缩为 1 条 bullet 简写，仍要保留。每条 bullet 一句一事、动词开头（主导/搭建/设计/落地/优化/推动，禁用「负责」）、结构「动词 + 具体动作 + 量化结果」、结果数字紧随动作或前置。',
  '5. 简历正文必须直接采用「建议改写」后的措辞；「改写示例」挑 3~6 个最能体现方向匹配的关键句，给出「原表述 → 建议改写」（只换说法、不换事实，改写后更具体、更量化、对齐职位关键词）。',
  '6. 「调整说明」3~5 条，逐条说明针对该方向做了什么调整、依据哪条共性要求。',
  '7. 输出严格 JSON（不要输出 JSON 以外的内容）：',
  '{"调整说明": ["..."], "改写示例": [{"原表述": "...", "建议改写": "..."}], "简历正文": "..."}',
  '「简历正文」为完整 markdown 简历，第一行用「# 姓名」（姓名来自画像，画像无姓名则省略该标题）；之后依次为个人概述、能力标签、工作经历、项目经历、技能与工具、教育背景；只写简历里有的内容，某项为空就整节省略，不要输出「未提供」等占位。',
].join('\n')

const INTENT_REGEN_SYSTEM = [
  '你是求职方向规划顾问。为求职者重新生成一个「意向职位方向」及其职位名变体。',
  '',
  '规则：',
  '1. 新方向必须与「已有方向」在职能上真正不同（比较核心职能词，不能只换前缀——「用户体验运营 / 客户体验运营 / 服务体验运营」算同一方向）。',
  '2. 方向应基于简历原文中真实存在的经历与能力，不编造。',
  '3. 职位名变体 3~5 个：必须是招聘平台上真实、独立可搜索的职位名，与方向属于同一职能族；禁止只换前缀（用户/客户/服务/商家/平台/在线）或只换修饰词。',
  '4. 输出严格 JSON（不要输出 JSON 以外的内容）：',
  '{"方向": "...", "变体": ["..."]}',
].join('\n')

// ---------- 纯规则：变体去伪 / 缺口标签化 / 硬过滤 ----------

const _VARIANT_PREFIXES = ['全流程体验', '用户体验', '客户体验', '服务体验', '体验', '用户', '客户', '服务', '在线', '数字化', '智能']

function _variantCore(title) {
  let t = String(title || '').replace(/[\s（）()·\-—_/]+/g, '').toLowerCase()
  for (const p of _VARIANT_PREFIXES) {
    if (t.startsWith(p) && t.length > p.length) { t = t.slice(p.length); break }
  }
  return t
}

const _DIM_ORDER = ['核心能力匹配', '行业与业务经验', '工具与方法', '软素质与协作']

const _MISS_TAGS = [
  ['指标体系与数据度量经验不足', ['数据', '指标', '埋点', '度量', '看板', '报表', '实验', 'sql', '统计']],
  ['缺少系统的用户研究方法', ['用户研究', '调研', '访谈', '问卷', '可用性', '用户画像', '洞察']],
  ['AI 应用缺少效果评测与优化闭环', ['大模型', 'ai', 'agent', '智能', '自动化', '提示词', '模型', 'rpa']],
  ['缺少营销传播与增长转化经验', ['增长', '商业化', '营销', '传播', '转化', 'gmv', '渗透率', '获客', '留存', '变现']],
  ['缺少风险与准入机制建设经验', ['风险', '准入', '舆情', '合规', '规则', '机制']],
  ['目标行业直接经验不足', ['行业', '金融', '电商', '物流', '本地生活', '餐饮', '酒旅', '零售', '供应链', '外贸']],
  ['缺少汇报与跨部门协作证据', ['项目', '跨部门', '协作', '沟通', '汇报', '管理', '团队', '协调']],
  ['缺少独立负责策略规划的案例', ['策略', '规划', '方案', '商业分析', '经营分析', '咨询']],
  ['B 端客户 / 商家运营经验不足', ['b端', 'saas', '企业', '客户', '账号', '权限', 'crm', '商家']],
  ['履约与服务体系经验不足', ['服务', '客服', '售后', '投诉', '工单', '履约', '体验', '配送', '退款']],
]
const _MISS_OTHER = '其他零散缺口'

const _TAG_DIM = {
  '指标体系与数据度量经验不足': '工具与方法',
  '缺少系统的用户研究方法': '工具与方法',
  'AI 应用缺少效果评测与优化闭环': '工具与方法',
  '缺少营销传播与增长转化经验': '核心能力匹配',
  '缺少风险与准入机制建设经验': '核心能力匹配',
  '目标行业直接经验不足': '行业与业务经验',
  '缺少汇报与跨部门协作证据': '软素质与协作',
  '缺少独立负责策略规划的案例': '核心能力匹配',
  'B 端客户 / 商家运营经验不足': '行业与业务经验',
  '履约与服务体系经验不足': '核心能力匹配',
  [_MISS_OTHER]: '核心能力匹配',
}

function _tagMiss(text) {
  const t = String(text || '').toLowerCase()
  for (const [label, kws] of _MISS_TAGS) {
    if (kws.some(k => t.includes(k))) return label
  }
  return _MISS_OTHER
}

const _CITY_RE = /北京|上海|广州|深圳|杭州|南京|成都|武汉|西安|重庆|长沙|苏州|天津|郑州|青岛|济南|合肥|福州|厦门|东莞|佛山|宁波|无锡|大连|昆明|南昌|贵阳|南宁|哈尔滨|长春|沈阳|石家庄|太原|呼和浩特|乌鲁木齐|兰州|银川|西宁|拉萨|海口|三亚|珠海|惠州|中山|嘉兴|绍兴|金华|台州|温州|泉州|常州|南通|徐州|扬州|盐城|泰州|镇江|淮安|连云港|宿迁/
const _SALARY_K_RANGE_RE = /(\d+(?:\.\d+)?)\s*[kK]\s*[-—~至]\s*(\d+(?:\.\d+)?)\s*[kK]/
const _SALARY_RANGE_RE = /(\d+(?:\.\d+)?)\s*[-—~至]\s*(\d+(?:\.\d+)?)\s*[kK]/
const _SALARY_K_MIN_RE = /(\d+(?:\.\d+)?)\s*[kK]/
const _YEARLY_RE = /年薪\s*(\d+(?:\.\d+)?)\s*[-—~至]?\s*(\d+(?:\.\d+)?)?\s*万/
const _SALARY_SUFFIX_RE = /(\d{1,2})\s*薪/

function extractSalaryCity(text) {
  const t = String(text || '')
  let city = ''
  const cm = t.match(_CITY_RE)
  if (cm) city = cm[0]
  let salaryMin = null
  let salaryMax = null
  let m
  if ((m = t.match(_SALARY_K_RANGE_RE))) { salaryMin = Number(m[1]); salaryMax = Number(m[2]) }
  else if ((m = t.match(_SALARY_RANGE_RE))) { salaryMin = Number(m[1]); salaryMax = Number(m[2]) }
  else if ((m = t.match(_YEARLY_RE))) { salaryMin = Math.round(Number(m[1]) * 10 / 12 * 10) / 10; salaryMax = m[2] ? Math.round(Number(m[2]) * 10 / 12 * 10) / 10 : salaryMin }
  else if ((m = t.match(_SALARY_K_MIN_RE))) { salaryMin = Number(m[1]) }
  const sm = t.match(_SALARY_SUFFIX_RE)
  const salarySuffix = sm ? `${sm[1]}薪` : ''
  return { city, salary_min: salaryMin, salary_max: salaryMax, salary_suffix: salarySuffix }
}

function hardFilter(job, settings) {
  const city = String(settings.city || '').trim()
  if (city) {
    const want = city.split(/[,，、]/).map(s => s.trim()).filter(Boolean)
    const jc = String(job.city || '').trim()
    if (want.length && jc && !want.some(w => jc.includes(w))) {
      return `城市不符：期望「${want.join('/')}」，职位在「${jc}」`
    }
  }
  const smin = Number(settings.salary_min) || 0
  if (smin > 0) {
    const smax = job.salary_max
    if (typeof smax === 'number' && smax < smin) {
      return `薪资不符：职位上限 ${smax}K 低于最低月薪 ${smin}K`
    }
  }
  return null
}

// ---------- 去重规范化 / 公司清洗 / 经验提取（纯规则） ----------

const _COMPANY_SUFFIXES = ['股份有限公司', '有限责任公司', '集团有限公司', '有限公司', '集团', '公司']
const _TITLE_NOISE = ['急聘', '急招', '高薪', '五险一金', '双休', '全职', '兼职', '实习', '招聘', '若干', '待遇从优', '福利好', '弹性工作', '补充医疗保险', '可远程']

function normalizeText(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^0-9a-z\u4e00-\u9fff]/g, '')
    .toLowerCase()
}

function normalizeCompany(name) {
  let s = normalizeText(name)
  for (const suf of _COMPANY_SUFFIXES) {
    if (s.endsWith(suf)) { s = s.slice(0, -suf.length); break }
  }
  return s
}

function normalizeTitle(title) {
  let s = String(title || '')
  for (const w of _TITLE_NOISE) s = s.split(w).join('')
  return normalizeText(s)
}

function cleanCompany(raw) {
  let s = String(raw || '').trim()
  if (!s) return ''
  s = s.split(/\r?\n/)[0].trim()
  s = s.replace(/^公司简介\s*[:：]?\s*/i, '')
  const m = s.match(/^(.{1,20}?)\s*(成立于|创立于)/)
  if (m) s = m[1].trim()
  const noise = s.search(/公司简介|薪资福利|职位描述|岗位职责|任职要求|发布于|更新于/)
  if (noise >= 0) s = s.slice(0, noise).trim()
  if (s.length > 30) return ''
  return s
}

function extractExp(text) {
  const t = String(text || '')
  if (/经验不限|无经验|应届/.test(t)) {
    const m = t.match(/经验不限|无经验|应届生?|实习生?/)
    return m ? m[0] : '经验不限'
  }
  const m = t.match(/(\d+(?:\.\d+)?)\s*[-—~至]\s*(\d+(?:\.\d+)?)\s*年/)
  if (m) return `${m[1]}-${m[2]}年`
  const m2 = t.match(/(\d+(?:\.\d+)?)\s*年(?:以上)?(?:经验|工作)/)
  if (m2) return `${m2[1]}年`
  return ''
}

function computeJdHash(company, title, description) {
  return createHash('sha256').update([normalizeText(company), normalizeText(title), normalizeText(description)].join('\x1f')).digest('hex').slice(0, 32)
}

// ---------- 通用 ----------

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS resume (id INTEGER PRIMARY KEY, source_name TEXT, text TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY, data TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS profile_notes (kind TEXT, ref TEXT, note TEXT, updated_at TEXT, PRIMARY KEY (kind, ref));
    CREATE TABLE IF NOT EXISTS abilities (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, category TEXT, evidence TEXT, confidence TEXT, status TEXT, sort INTEGER);
    CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT, title TEXT, company TEXT, title_norm TEXT, company_norm TEXT, city TEXT, salary_min REAL, salary_max REAL, salary_text TEXT, exp_text TEXT, edu_text TEXT, recruiter_active TEXT, description TEXT, url TEXT, jd_hash TEXT, created_at TEXT, status TEXT);
    CREATE TABLE IF NOT EXISTS matches (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, score INTEGER, dims TEXT, reason TEXT, created_at TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_job ON matches (job_id);
    CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, action TEXT, created_at TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_job ON feedback (job_id);
    CREATE TABLE IF NOT EXISTS job_texts (job_id INTEGER PRIMARY KEY, tailor TEXT, greeting TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS resume_adjust (direction TEXT PRIMARY KEY, content TEXT, summary TEXT, job_ids TEXT, updated_at TEXT, examples TEXT);
  `)
  try {
    const cols = db.prepare('PRAGMA table_info(profile)').all().map((c) => c.name)
    if (!cols.includes('updated_at')) db.exec('ALTER TABLE profile ADD COLUMN updated_at TEXT')
  } catch { /* 旧库结构不可改时忽略 */ }
}

function openDb(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  ensureSchema(db)
  return db
}

function safeJson(s, fallback) {
  if (s == null) return fallback
  if (typeof s !== 'string') return s
  try { return JSON.parse(s) } catch { return fallback }
}

function stripJson(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = m ? m[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start >= 0 && end > start) return body.slice(start, end + 1)
  return body.trim()
}

function parseJsonLoose(text) {
  const s = stripJson(text)
  try { return JSON.parse(s) } catch (e0) {
    // 常见小毛病：对象/数组最后一个元素后多一个逗号
    const fixed = s.replace(/,\s*([}\]])/g, '$1')
    try { return JSON.parse(fixed) } catch { throw e0 }
  }
}

// 只用 DSH 里「登录账号」那条模型路由（与 DSH 对话一致），不碰 API-key 路由，
// 更不碰任何外部服务的 key。路由名默认 deepseek-account，可用 config.provider 覆盖。
const PROVIDER_AUTH_RE = /MISSING_CREDENTIAL|no API key|ACCOUNT_SIGN_IN_REQUIRED|unauthorized|invalid_api_key|not signed in|登录|401|403/i

let PLUGIN_CONFIG = {}
// 用户在面板里选定的模型设置（留空=跟随 DSH 默认）
let LLM_SETTINGS = { provider: '', model: '', effort: '' }

function pickProvider(ctx) {
  let ids = []
  try { ids = (ctx.llm.listProviders() || []).map(p => p && p.id).filter(Boolean) } catch { /* ignore */ }
  const preferred = PLUGIN_CONFIG.provider || ((readAgentDefaults() || {}).provider)
  if (preferred && ids.includes(preferred)) return preferred
  if (ids.includes('deepseek-account')) return 'deepseek-account'
  if (!ids.length) throw new Error('DSH 里没有可用的模型路由，请先在 DSH 中登录 DeepSeek 账号')
  return ids[0]
}

async function streamOnce(ctx, provider, model, messages, limit, temperature, signal, effort) {
  const assembler = new BlockAssembler()
  if (effort) {
    // 推理强度只能通过 prepareCall 的 configure 回调设置，且会被校验在模型支持的档位内
    const config = { provider, model, messages, maxTokens: limit }
    if (temperature !== undefined) config.temperature = temperature
    const prepared = await ctx.llm.prepareCall(config, signal, (controls) => ({ ...controls, reasoningEffort: effort }))
    for await (const chunk of prepared.stream(prepared.config)) assembler.push(chunk)
    return assembler
  }
  for await (const chunk of ctx.llm.stream({ provider, model, messages, maxTokens: limit, temperature, signal })) {
    assembler.push(chunk)
  }
  return assembler
}

async function chatJson(ctx, provider, model, system, user, maxTokens, temperature, signal) {
  const messages = []
  if (system) messages.push({ role: 'system', content: [{ type: 'text', text: system }] })
  messages.push({ role: 'user', content: [{ type: 'text', text: user }] })
  // 面板里显式选择的模型优先；否则用调用方传入（= DSH 默认/插件配置）
  const pid = (LLM_SETTINGS && LLM_SETTINGS.provider) || provider || pickProvider(ctx)
  const mid = (LLM_SETTINGS && LLM_SETTINGS.model) || model
  const effort = (LLM_SETTINGS && LLM_SETTINGS.effort) || ''
  let limit = Math.max(1000, Number(maxTokens) || 4000)
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt++) {
    let assembler
    try {
      assembler = await streamOnce(ctx, pid, mid, messages, limit, temperature, signal, effort)
    } catch (e) {
      const msg = String((e && e.message) || e)
      if (PROVIDER_AUTH_RE.test(msg)) {
        throw new Error('模型路由 ' + pid + ' 不可用（' + msg.slice(0, 200) + '）。请先在 DSH 中登录 DeepSeek 账号，或确认该路由已配置凭据。')
      }
      throw e
    }
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      const f = finish.failure
      const msg = 'LLM 调用失败: ' + (f ? f.message : finish.kind) + (f && f.code ? ' (' + f.code + ')' : '')
      if (PROVIDER_AUTH_RE.test(msg)) {
        throw new Error('模型路由 ' + pid + ' 不可用（' + msg.slice(0, 200) + '）。请先在 DSH 中登录 DeepSeek 账号，或确认该路由已配置凭据。')
      }
      throw new Error(msg)
    }
    const text = assembler.blocks().filter(b => b.type === 'text').map(b => b.text).join('')
    try {
      return parseJsonLoose(text)
    } catch (e) {
      lastError = e
      if (finish.kind === 'max-tokens' && limit < 200000) {
        limit = Math.min(limit * 4, 200000)
        continue
      }
      if (attempt === 0) {
        // 模型偶尔输出了非法 JSON（缺逗号/引号等）：带着纠正要求重试一次
        messages.push({ role: 'user', content: [{ type: 'text', text: '上一次输出不是合法 JSON（' + String(e && e.message || e).slice(0, 120) + '）。请重新只输出一个严格合法的 JSON 对象：字符串用双引号，元素之间用英文逗号，不要注释、不要多余文字。' }] })
        continue
      }
      throw new Error('模型输出不是合法 JSON：' + String(e && e.message || e).slice(0, 200) + (finish.kind === 'max-tokens' ? '（输出被截断：思考模式会消耗较多 token，可重试或换用更短的输入）' : ''))
    }
  }
  throw new Error('模型输出不是合法 JSON：' + String(lastError && lastError.message || lastError).slice(0, 200))
}

// ---------- 读库 ----------

function readSettings(db) {
  return Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]))
}

function readLlmSettings(db) {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('llm_provider','llm_model','llm_effort')").all()
  const m = Object.fromEntries(rows.map(r => [r.key, r.value]))
  return { provider: m.llm_provider || '', model: m.llm_model || '', effort: m.llm_effort || '' }
}

function saveSettingValue(db, key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value == null ? '' : value))
}

function readProfile(db) {
  const row = db.prepare('SELECT data FROM profile WHERE id = 1').get()
  if (row && row.data) { try { return JSON.parse(row.data) } catch { return {} } }
  return {}
}

function readAbilities(db) {
  return db.prepare("SELECT name, category, evidence, confidence FROM abilities WHERE status = 'confirmed' ORDER BY sort, id").all()
}

function readResume(db) {
  const row = db.prepare('SELECT text FROM resume WHERE id = 1').get()
  return row ? String(row.text || '') : ''
}

function readNotes(db) {
  const rows = db.prepare('SELECT kind, ref, note FROM profile_notes').all()
  const notes = { work: {}, project: {} }
  for (const r of rows) {
    if (r.note) (notes[r.kind] || (notes[r.kind] = {}))[r.ref] = r.note
  }
  return notes
}

function readJobs(db) {
  return db.prepare('SELECT id, platform, title, company, city, salary_text, salary_min, salary_max, exp_text, description, url FROM jobs ORDER BY id DESC').all()
}

function readJobsWithoutMatch(db) {
  return db.prepare('SELECT j.* FROM jobs j LEFT JOIN matches m ON m.job_id = j.id WHERE m.id IS NULL ORDER BY j.id DESC').all()
}

function readMatches(db) {
  return db.prepare(
    'SELECT m.job_id, m.score, m.dims, m.reason, j.title, j.company, j.city, j.salary_text, j.platform, j.url, j.description, j.exp_text FROM matches m JOIN jobs j ON j.id = m.job_id ORDER BY m.score DESC'
  ).all().map(r => ({
    job_id: r.job_id, score: r.score,
    dims: safeJson(r.dims, []),
    reason: safeJson(r.reason, {}),
    title: r.title, company: r.company, city: r.city, salary_text: r.salary_text,
    platform: r.platform, url: r.url, description: r.description, exp_text: r.exp_text,
  }))
}

function readFeedback(db) {
  return db.prepare('SELECT job_id, action FROM feedback').all()
}

function readJobById(db, id) {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) || null
}

function readMatchReason(db, jobId) {
  const row = db.prepare('SELECT reason FROM matches WHERE job_id = ?').get(jobId)
  return row ? safeJson(row.reason, {}) : null
}

function readResumeAdjust(db, direction) {
  return db.prepare('SELECT * FROM resume_adjust WHERE direction = ?').get(direction) || null
}

// ---------- 写库 ----------

function upsertMatch(db, jobId, score, dims, reason) {
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO matches (job_id, score, dims, reason, created_at) VALUES (?,?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET score=excluded.score, dims=excluded.dims, reason=excluded.reason, created_at=excluded.created_at'
  ).run(jobId, score, JSON.stringify(dims), JSON.stringify(reason), now)
}

function saveGreeting(db, jobId, greeting) {
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO job_texts (job_id, greeting, updated_at) VALUES (?,?,?) ON CONFLICT(job_id) DO UPDATE SET greeting=excluded.greeting, updated_at=excluded.updated_at'
  ).run(jobId, JSON.stringify(greeting), now)
}

function saveResumeAdjust(db, direction, content, summary, jobIds, examples) {
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO resume_adjust (direction, content, summary, job_ids, examples, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(direction) DO UPDATE SET content=excluded.content, summary=excluded.summary, job_ids=excluded.job_ids, examples=excluded.examples, updated_at=excluded.updated_at'
  ).run(direction, content, JSON.stringify(summary), JSON.stringify(jobIds), JSON.stringify(examples), now)
}

function saveProfileNote(db, kind, ref, note) {
  const now = new Date().toISOString()
  const k = kind === 'project' ? 'project' : 'work'
  const r = String(ref || '').trim()
  if (!r) return
  const n = String(note || '').trim()
  if (!n) {
    db.prepare('DELETE FROM profile_notes WHERE kind = ? AND ref = ?').run(k, r)
    return
  }
  db.prepare(
    'INSERT INTO profile_notes (kind, ref, note, updated_at) VALUES (?,?,?,?) ON CONFLICT(kind, ref) DO UPDATE SET note=excluded.note, updated_at=excluded.updated_at'
  ).run(k, r, n, now)
}

// ---------- 匹配打分（LLM） ----------

function buildMatchUser(job, abilities, profile) {
  const confirmed = abilities.map(a => ({ 能力: a.name, 证据: a.evidence || '', 置信度: a.confidence || '' }))
  const profileAbs = {
    当前职位: profile['当前职位'] || '',
    总工作年限: profile['总工作年限'] || '',
    工作经历: (profile['工作经历'] || []).map(e => ({ 公司: e.公司 || '', 职位: e.职位 || '', 职责与成果: e['职责与成果'] || '' })),
    意向岗位: profile['意向岗位'] || [],
  }
  const jobAbs = {
    岗位: job.title || '',
    公司: job.company || '',
    城市: job.city || '',
    薪资: job.salary_text || '',
    经验要求: job.exp_text || '',
    职责与要求: job.description || '',
  }
  return '已确认能力画像：\n' + JSON.stringify(confirmed, null, 2)
    + '\n\n履历摘要：\n' + JSON.stringify(profileAbs, null, 2)
    + '\n\n职位描述：\n' + JSON.stringify(jobAbs, null, 2)
}

function normalizeMatchResult(data) {
  const score = Math.max(0, Math.min(100, Number(data.score || 0) || 0))
  const dims = (data.dims || []).map(d => ({
    维度: String(d.维度 || d.name || '').trim(),
    分: Number(d.分 || d.score || 0) || 0,
    说明: String(d.说明 || d.note || '').trim(),
  }))
  const reasons = (data.reasons || []).map(r => String(r).trim()).filter(Boolean)
  const misses = (data.misses || []).map(m => String(m).trim()).filter(Boolean)
  return { score, dims, reasons, misses, suggestion: String(data.suggestion || '').trim() }
}

// ---------- 差距统计（纯规则） ----------

function referenceSet(matches, feedback) {
  const interested = new Set(feedback.filter(f => f.action === 'interested').map(f => f.job_id))
  const notInterested = new Set(feedback.filter(f => f.action === 'not_interested').map(f => f.job_id))
  return matches.filter(m => (interested.has(m.job_id) || (m.score || 0) >= 60) && !notInterested.has(m.job_id))
}

function gapStats(matches, feedback) {
  const ref = referenceSet(matches, feedback)
  const scores = ref.map(m => m.score || 0)
  const n = ref.length
  const interested = feedback.filter(f => f.action === 'interested').length
  const notInterested = feedback.filter(f => f.action === 'not_interested').length

  const dimBuckets = {}
  for (const m of ref) {
    for (const d of m.dims || []) {
      const key = String(d['维度'] || '其他').trim()
      const val = Number(d['分'] || 0) || 0
      ;(dimBuckets[key] || (dimBuckets[key] = [])).push(val)
    }
  }
  const dimSummary = Object.entries(dimBuckets).map(([k, v]) => ({
    维度: k, 平均分: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10, 样本: v.length,
  })).sort((a, b) => {
    const ia = _DIM_ORDER.indexOf(a['维度']); const ib = _DIM_ORDER.indexOf(b['维度'])
    const ka = ia === -1 ? _DIM_ORDER.length : ia; const kb = ib === -1 ? _DIM_ORDER.length : ib
    return ka - kb || (b['平均分'] - a['平均分'])
  })

  const missCounts = {}
  const missDetails = {}
  const missSeen = {}
  const missJobs = {}
  for (const m of ref) {
    for (const miss of (m.reason || {}).misses || []) {
      const text = String(miss).trim()
      if (!text) continue
      const label = _tagMiss(text)
      missCounts[label] = (missCounts[label] || 0) + 1
      ;(missJobs[label] || (missJobs[label] = new Set())).add(m.job_id)
      const key = text.toLowerCase().replace(/[\s，。；、,.;:：（）()]+/g, '')
      if (!missSeen[label]) missSeen[label] = new Set()
      if (!missSeen[label].has(key)) {
        missSeen[label].add(key)
        ;(missDetails[label] || (missDetails[label] = [])).push(text)
      }
    }
  }
  const topMisses = Object.entries(missCounts)
    .sort((a, b) => {
      const da = _TAG_DIM[a[0]] || '核心能力匹配'; const db = _TAG_DIM[b[0]] || '核心能力匹配'
      const ia = _DIM_ORDER.indexOf(da); const ib = _DIM_ORDER.indexOf(db)
      const ka = ia === -1 ? _DIM_ORDER.length : ia; const kb = ib === -1 ? _DIM_ORDER.length : ib
      return ka - kb || (b[1] - a[1])
    })
    .slice(0, 10)
    .map(([label, cnt]) => ({
      维度: _TAG_DIM[label] || '核心能力匹配',
      缺口: label,
      出现次数: cnt,
      明细: (missDetails[label] || []).slice(0, 10),
      职位: [...(missJobs[label] || [])],
    }))

  return {
    样本数: n,
    '60分以上': scores.filter(s => s >= 60).length,
    感兴趣: interested,
    不感兴趣: notInterested,
    维度均分: dimSummary,
    高频缺口: topMisses,
  }
}

// ---------- 参考集职位信息（简历调整用） ----------

function interestedJobsInfo(db) {
  const feedback = readFeedback(db)
  const interested = new Set(feedback.filter(f => f.action === 'interested').map(f => f.job_id))
  const notInterested = new Set(feedback.filter(f => f.action === 'not_interested').map(f => f.job_id))
  const matches = readMatches(db)
  const ids = matches.filter(m => (m.score || 0) >= 60 && !notInterested.has(m.job_id)).map(m => m.job_id)
  for (const jid of interested) {
    if (!notInterested.has(jid) && !ids.includes(jid)) ids.push(jid)
  }
  const jobsInfo = []
  const used = []
  for (const jid of ids) {
    const job = readJobById(db, jid)
    if (!job) continue
    const reason = readMatchReason(db, jid) || {}
    jobsInfo.push({
      岗位: job.title || '',
      公司: job.company || '',
      城市: job.city || '',
      薪资: job.salary_text || '',
      职责与要求: String(job.description || '').slice(0, 400),
      匹配理由: (reason.reasons || []).slice(0, 3),
      不匹配点: (reason.misses || []).slice(0, 3),
    })
    used.push(jid)
  }
  return { jobsInfo, used }
}

// ---------- 面板数据接口（浏览器端面板读取） ----------

function readGreeting(db, jobId) {
  const row = db.prepare('SELECT greeting FROM job_texts WHERE job_id = ?').get(jobId)
  return row ? safeJson(row.greeting, null) : null
}

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function buildPanelPayload(db) {
  const settings = readSettings(db)
  const profile = readProfile(db)
  const resumeRow = db.prepare('SELECT source_name, text, updated_at FROM resume WHERE id = 1').get()
  const resume = resumeRow
    ? { source_name: resumeRow.source_name || '', chars: String(resumeRow.text || '').length, updated_at: resumeRow.updated_at || '' }
    : null
  const notes = readNotes(db)
  const abilities = db.prepare('SELECT id, name, category, evidence, confidence, status FROM abilities ORDER BY sort, id').all()
  const jobRows = db.prepare('SELECT id, platform, title, company, title_norm, company_norm, city, salary_text, description, url FROM jobs ORDER BY id DESC').all()
  const dup = {}
  for (const j of jobRows) {
    const k = String(j.company_norm || '') + '\x1f' + String(j.title_norm || '')
    dup[k] = (dup[k] || 0) + 1
  }
  const feedback = readFeedback(db)
  const fbMap = Object.fromEntries(feedback.map(f => [f.job_id, f.action]))
  const matches = readMatches(db).map(m => ({
    job_id: m.job_id, score: m.score, dims: m.dims, reason: m.reason,
    title: m.title, company: m.company, city: m.city, salary_text: m.salary_text,
    platform: m.platform, url: m.url, description: String(m.description || ''),
    greeting: readGreeting(db, m.job_id),
    fb: fbMap[m.job_id] || '',
  }))
  const adjusts = db.prepare('SELECT direction, content, summary, job_ids, updated_at, examples FROM resume_adjust ORDER BY direction').all().map(r => ({
    direction: r.direction,
    content: r.content || '',
    summary: safeJson(r.summary, []),
    job_ids: safeJson(r.job_ids, []),
    examples: safeJson(r.examples, []),
    updated_at: r.updated_at || '',
  }))
  const scoreMap = Object.fromEntries(matches.map(m => [m.job_id, m.score]))
  let savedGapReport = null
  try { savedGapReport = JSON.parse(settings.gap_report || 'null') } catch {}
  return {
    ok: true,
    parse: { running: !!(JOBS.parse && JOBS.parse.running), ok: JOBS.parse ? JOBS.parse.ok : null, message: (JOBS.parse && JOBS.parse.message) || '' },
    llm: (() => {
      const ad = readAgentDefaults() || {}
      return {
        provider: (LLM_SETTINGS && LLM_SETTINGS.provider) || '',
        model: (LLM_SETTINGS && LLM_SETTINGS.model) || '',
        effort: (LLM_SETTINGS && LLM_SETTINGS.effort) || '',
        default_provider: ad.provider || '',
        default_model: ad.model || DEFAULT_MODEL,
        effective_provider: (LLM_SETTINGS && LLM_SETTINGS.provider) || (PLUGIN_CONFIG && PLUGIN_CONFIG.provider) || ad.provider || 'deepseek-account',
        effective_model: (LLM_SETTINGS && LLM_SETTINGS.model) || (PLUGIN_CONFIG && PLUGIN_CONFIG.model) || ad.model || DEFAULT_MODEL,
      }
    })(),
    adjusts,
    gap_report: savedGapReport || null,
    adjust_feedback: safeJson(settings.adjust_feedback, {}),
    state: {
      profile: {
        姓名: profile['姓名'] || '',
        当前职位: profile['当前职位'] || '',
        总工作年限: profile['总工作年限'] || '',
        工作经历: Array.isArray(profile['工作经历']) ? profile['工作经历'] : [],
        项目: Array.isArray(profile['项目']) ? profile['项目'] : [],
        教育: Array.isArray(profile['教育']) ? profile['教育'] : [],
      },
      notes,
      resume,
      intents: profile['意向岗位'] || [],
      abilities: abilities.map(a => ({ id: a.id, 能力: a.name, 类别: a.category, 证据: a.evidence, 置信度: a.confidence, 状态: a.status })),
      settings: { city: settings.city || '', salary_min: settings.salary_min || '' },
      counts: {
        职位: jobRows.length,
        已匹配: matches.length,
        已确认能力: abilities.filter(a => a.status === 'confirmed').length,
        感兴趣: feedback.filter(f => f.action === 'interested').length,
        不感兴趣: feedback.filter(f => f.action === 'not_interested').length,
      },
    },
    jobs: jobRows.map(j => {
      const k = String(j.company_norm || '') + '\x1f' + String(j.title_norm || '')
      return {
        id: j.id, 平台: j.platform, 岗位: j.title || '', 公司: j.company || '',
        城市: j.city || '', 薪资: j.salary_text || '', 分数: scoreMap[j.id] ?? null,
        链接: j.url || '', 重复数: dup[k] || 1, 重复键: dup[k] > 1 ? k : '',
      }
    }),
    matches,
    gap: gapStats(matches, feedback),
  }
}

async function handlePanelRequest(request, dbPath) {
  try {
    const db = openDb(dbPath)
    try {
      return json(200, buildPanelPayload(db))
    } finally {
      db.close()
    }
  } catch (e) {
    return json(400, { ok: false, message: String((e && e.message) || e) })
  }
}

// ---------- 面板操作层（浏览器按钮调用） ----------

const JOBS = {
  batch: { running: false, total: 0, done: 0, failed: 0, current: '', message: '' },
  parse: { running: false, message: '', ok: null },
}

const RESUME_PARSE_SYSTEM = `你是资深职业顾问。任务：从简历中提取结构化人才画像，并推断简历未明说、但基于经历合理具备的隐性能力。

规则：
1. 严格依据简历内容，绝不编造经历、技能、数字或能力。
2. 显性能力：简历中明确表达的能力（如"负责XX""擅长XX""搭建XX"直接对应的能力）。
3. 推断能力：简历未直接写、但基于经历可以合理推导的能力。每条必须给出"证据"，引用简历中的具体事实（可简写，保留关键词）。置信度只能是"高"或"中"。
4. 意向职位：根据履历推断求职方向（如"体验运营"），方向必须是简洁的职位名（不要带括号说明，如不要写"内容运营（短视频方向）"）。每个方向给出 3~5 个「真正不同」的职位名变体。变体要换核心职能词（运营/设计/管理/研究/策略/成功/增长），不要只换前缀修饰词（用户/客户/服务/商家/平台/在线 等）："用户体验运营""客户体验运营""服务体验运营"是同一个职位，最多保留一个。变体必须与求职方向相关。
5. 输出严格 JSON，不要输出 JSON 以外的任何内容。

JSON 结构：
{
  "姓名": str,
  "当前职位": str,
  "总工作年限": str,
  "工作经历": [{"公司": str, "职位": str, "时间": str, "行业": str, "职责与成果": str}],
  "项目": [{"名称": str, "角色": str, "内容": str}],
  "教育": [{"学校": str, "专业": str, "学历": str, "时间": str}],
  "显性能力": [{"能力": str, "类别": str, "证据": str}],
  "推断能力": [{"能力": str, "类别": str, "证据": str, "置信度": "高|中"}],
  "意向岗位": [{"方向": str, "变体": [str]}]
}`

function cleanVariants(variants, direction) {
  const dirCore = _variantCore(direction)
  const seen = new Set()
  const out = []
  for (const raw of variants || []) {
    const v = String(raw || '').trim()
    if (!v) continue
    const core = _variantCore(v)
    if (!core || core === dirCore || seen.has(core)) continue
    seen.add(core)
    out.push(v)
    if (out.length >= 5) break
  }
  return out
}

// 方向是职位名，去掉模型偶发的括号注释（如「内容运营（短视频方向）」→「内容运营」）。
function cleanDirection(raw) {
  let d = String(raw || '').trim()
  d = d.split(/[\/、,，]/)[0].trim()
  d = d.replace(/[（(].*?[)）]/g, '').trim()
  return d
}

function normalizeResumeParse(data) {
  const abilities = []
  let sort = 0
  for (const a of (data['显性能力'] || [])) {
    const name = String(a['能力'] || '').trim()
    if (!name) continue
    sort += 1
    abilities.push({ name, category: 'explicit', evidence: String(a['证据'] || '').trim(), confidence: '高', status: 'confirmed', sort })
  }
  for (const a of (data['推断能力'] || [])) {
    const name = String(a['能力'] || '').trim()
    if (!name) continue
    let conf = String(a['置信度'] || '高').trim()
    if (conf !== '高' && conf !== '中') conf = '中'
    sort += 1
    abilities.push({ name, category: 'inferred', evidence: String(a['证据'] || '').trim(), confidence: conf, status: 'pending', sort })
  }
  const intents = []
  for (const it of (data['意向岗位'] || [])) {
    const direction = cleanDirection(it['方向'])
    if (!direction) continue
    intents.push({ 方向: direction, 变体: cleanVariants(Array.isArray(it['变体']) ? it['变体'].map(String) : [], direction) })
  }
  const profile = {
    姓名: String(data['姓名'] || ''),
    当前职位: String(data['当前职位'] || ''),
    总工作年限: String(data['总工作年限'] || ''),
    工作经历: Array.isArray(data['工作经历']) ? data['工作经历'] : [],
    项目: Array.isArray(data['项目']) ? data['项目'] : [],
    教育: Array.isArray(data['教育']) ? data['教育'] : [],
    意向岗位: intents,
  }
  return { profile, abilities }
}

function readBody(request) {
  return (async () => {
    const reader = request.body?.getReader()
    if (!reader) return ''
    const chunks = []
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  })()
}

function parseBody(raw) {
  try {
    const b = raw ? JSON.parse(raw) : {}
    return b && typeof b === 'object' && !Array.isArray(b) ? b : null
  } catch {
    return null
  }
}

function saveSettingsValue(db, city, salaryMin) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('city', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(city ?? ''))
  db.prepare("INSERT INTO settings (key, value) VALUES ('salary_min', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(salaryMin ?? ''))
}

function saveSettingsValueJson(db, key, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(key), JSON.stringify(value ?? null))
}

function saveBasicProfile(db, name, currentTitle, years) {
  const row = db.prepare('SELECT data FROM profile WHERE id = 1').get()
  const profile = row ? safeJson(row.data, {}) : {}
  if (name != null) profile['姓名'] = String(name)
  if (currentTitle != null) profile['当前职位'] = String(currentTitle)
  if (years != null) profile['总工作年限'] = String(years)
  db.prepare('INSERT INTO profile (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .run(JSON.stringify(profile), new Date().toISOString())
}

function saveIntentsValue(db, intents) {
  const row = db.prepare('SELECT data FROM profile WHERE id = 1').get()
  const profile = row ? safeJson(row.data, {}) : {}
  profile['意向岗位'] = intents
  db.prepare('INSERT INTO profile (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .run(JSON.stringify(profile), new Date().toISOString())
}

function addAbilityRow(db, name, evidence) {
  const max = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM abilities').get()
  db.prepare('INSERT INTO abilities (name, category, evidence, confidence, status, sort) VALUES (?, ?, ?, ?, ?, ?)')
    .run(String(name || '').trim(), 'explicit', String(evidence || ''), '中', 'confirmed', Number(max.m) + 1)
}

function patchAbilityRow(db, id, patch) {
  const row = db.prepare('SELECT id FROM abilities WHERE id = ?').get(id)
  if (!row) return false
  const sets = []
  const vals = []
  if (patch.name != null) { sets.push('name = ?'); vals.push(String(patch.name).trim()) }
  if (patch.evidence != null) { sets.push('evidence = ?'); vals.push(String(patch.evidence)) }
  if (patch.status != null) { sets.push('status = ?'); vals.push(String(patch.status)) }
  if (!sets.length) return true
  vals.push(id)
  db.prepare('UPDATE abilities SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals)
  return true
}

function deleteJobCascade(db, jobId) {
  db.prepare('DELETE FROM matches WHERE job_id = ?').run(jobId)
  db.prepare('DELETE FROM feedback WHERE job_id = ?').run(jobId)
  db.prepare('DELETE FROM job_texts WHERE job_id = ?').run(jobId)
  db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId)
}

function upsertFeedback(db, jobId, fb) {
  db.prepare('INSERT INTO feedback (job_id, action, created_at) VALUES (?, ?, ?) ON CONFLICT(job_id) DO UPDATE SET action = excluded.action, created_at = excluded.created_at')
    .run(jobId, fb, new Date().toISOString())
}

function buildGreetingUser(job, reasons) {
  return '目标职位描述：\n' + JSON.stringify({
    岗位: job.title || '', 公司: job.company || '', 城市: job.city || '',
    薪资: job.salary_text || '', 职责与要求: job.description || '',
  }, null, 2) + '\n\n匹配理由：\n' + JSON.stringify(reasons || [], null, 2)
}

async function runBatchJob(ctx, dbPath, model, provider) {
  const st = JOBS.batch
  if (st.running) return { started: false, message: '已有批量打分任务在运行' }
  st.running = true
  st.total = 0
  st.done = 0
  st.failed = 0
  st.current = ''
  st.message = ''
  try {
    const db = openDb(dbPath)
    let jobs, abilities, profile, settings
    try {
      jobs = readJobsWithoutMatch(db)
      abilities = readAbilities(db)
      profile = readProfile(db)
      settings = readSettings(db)
    } finally { db.close() }
    st.total = jobs.length
    if (!jobs.length) { st.message = '没有未打分的职位'; return { started: false, message: st.message } }
    if (!abilities.length) { st.message = '还没有已确认的能力'; return { started: false, message: st.message } }
    for (const job of jobs) {
      st.current = job.title || job.company || ('#' + job.id)
      try {
        const db2 = openDb(dbPath)
        try {
          const reject = hardFilter(job, settings)
          if (reject) {
            upsertMatch(db2, job.id, 0, [], { reasons: ['硬条件不满足：' + reject], misses: [], suggestion: '' })
            st.done += 1
            continue
          }
          const data = await chatJson(ctx, provider, model, MATCH_SYSTEM, buildMatchUser(job, abilities, profile), 4000, 0.1)
          const r = normalizeMatchResult(data)
          upsertMatch(db2, job.id, r.score, r.dims, { reasons: r.reasons, misses: r.misses, suggestion: r.suggestion })
          if (r.score > 0) {
            try {
              const g = await chatJson(ctx, provider, model, GREETING_SYSTEM, buildGreetingUser(job, r.reasons), 2000, 0.4)
              saveGreeting(db2, job.id, g)
            } catch {}
          }
          st.done += 1
        } finally { db2.close() }
      } catch {
        st.failed += 1
        st.done += 1
      }
    }
    st.message = '完成'
    return { started: true, total: st.total }
  } finally {
    st.running = false
    st.current = ''
  }
}

async function runParseJob(ctx, dbPath, model, provider, text) {
  const st = JOBS.parse
  if (st.running) return { started: false, message: '已有履历解析任务在运行' }
  st.running = true
  st.ok = null
  st.message = '正在解析履历…'
  try {
    const data = await chatJson(ctx, provider, model, RESUME_PARSE_SYSTEM, '简历全文：\n\n' + text, 32768, 0.1)
    const { profile, abilities } = normalizeResumeParse(data)
    const db = openDb(dbPath)
    try {
      db.prepare('INSERT INTO resume (id, source_name, text, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET source_name = excluded.source_name, text = excluded.text, updated_at = excluded.updated_at')
        .run('面板上传', text, new Date().toISOString())
      db.prepare('INSERT INTO profile (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
        .run(JSON.stringify(profile), new Date().toISOString())
      db.prepare('DELETE FROM abilities').run()
      for (const a of abilities) {
        db.prepare('INSERT INTO abilities (name, category, evidence, confidence, status, sort) VALUES (?, ?, ?, ?, ?, ?)')
          .run(a.name, a.category, a.evidence, a.confidence, a.status, a.sort)
      }
    } finally { db.close() }
    const explicit = abilities.filter(a => a.category === 'explicit').length
    const inferred = abilities.filter(a => a.category === 'inferred').length
    const nameRaw = String(profile['姓名'] || '').trim()
    const name = (nameRaw && !/未提供|未知|未识别|待补充/.test(nameRaw)) ? nameRaw : ''
    st.ok = true
    st.message = '解析完成' + (name ? '：' + name : '') + '，显性 ' + explicit + ' 条，推断 ' + inferred + ' 条'
    return { started: true }
  } catch (e) {
    st.ok = false
    st.message = String((e && e.message) || e)
    return { started: false, message: st.message }
  } finally {
    st.running = false
  }
}

// ---------- 履历文件解析（纯 JS，无第三方依赖：md / txt / docx / pdf） ----------
function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
}

function docxXmlToText(xml) {
  const s = xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeXmlEntities(s).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

function extractDocx(buf) {
  let eocd = -1
  const min = Math.max(0, buf.length - 65557)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('docx 解析失败：不是有效的 zip 文件')
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break
    const method = buf.readUInt16LE(off + 10)
    const csize = buf.readUInt32LE(off + 20)
    const nlen = buf.readUInt16LE(off + 28)
    const elen = buf.readUInt16LE(off + 30)
    const clen = buf.readUInt16LE(off + 32)
    const lho = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nlen)
    if (name === 'word/document.xml') {
      const lnlen = buf.readUInt16LE(lho + 26)
      const lelen = buf.readUInt16LE(lho + 28)
      const start = lho + 30 + lnlen + lelen
      const data = buf.subarray(start, start + csize)
      const xml = method === 0 ? data.toString('utf8') : inflateRawSync(data).toString('utf8')
      return docxXmlToText(xml)
    }
    off += 46 + nlen + elen + clen
  }
  throw new Error('docx 解析失败：未找到正文（word/document.xml）')
}

function decodePdfString(s) {
  return s
    .replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[c] || c))
    .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
}

function buildCidMap(text) {
  const map = new Map()
  const charBlocks = text.match(/beginbfchar[\s\S]*?endbfchar/g) || []
  for (const block of charBlocks) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g
    let m
    while ((m = re.exec(block))) {
      const cid = parseInt(m[1], 16)
      let out = ''
      for (let i = 0; i + 4 <= m[2].length; i += 4) out += String.fromCharCode(parseInt(m[2].slice(i, i + 4), 16))
      if (!map.has(cid)) map.set(cid, out)
    }
  }
  const rangeBlocks = text.match(/beginbfrange[\s\S]*?endbfrange/g) || []
  for (const block of rangeBlocks) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g
    let m
    while ((m = re.exec(block))) {
      const lo = parseInt(m[1], 16)
      const hi = parseInt(m[2], 16)
      let base = ''
      for (let i = 0; i + 4 <= m[3].length; i += 4) base += String.fromCharCode(parseInt(m[3].slice(i, i + 4), 16))
      if (hi - lo > 4096) continue
      for (let i = 0; lo + i <= hi; i++) {
        const cid = lo + i
        if (map.has(cid)) continue
        map.set(cid, base ? base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + i) : '')
      }
    }
  }
  return map
}

function decodeHexCids(hex, cidMap) {
  const clean = hex.replace(/[^0-9A-Fa-f]/g, '')
  let out = ''
  if (clean.length % 4 === 0) {
    for (let i = 0; i < clean.length; i += 4) {
      const cid = parseInt(clean.slice(i, i + 4), 16)
      const ch = cidMap.get(cid)
      if (ch !== undefined) out += ch
      else if (cid >= 32 && cid < 127) out += String.fromCharCode(cid)
    }
    return out
  }
  for (let i = 0; i + 2 <= clean.length; i += 2) {
    const cid = parseInt(clean.slice(i, i + 2), 16)
    const ch = cidMap.get(cid)
    if (ch !== undefined) out += ch
    else if (cid >= 32 && cid < 127) out += String.fromCharCode(cid)
  }
  return out
}

function textOfPdfBlock(block, cidMap) {
  const tok = /<([0-9A-Fa-f\s]+)>|\(((?:\\.|[^\\()])*)\)/g
  let out = ''
  let m
  while ((m = tok.exec(block))) {
    if (m[1] !== undefined) out += decodeHexCids(m[1], cidMap)
    else out += decodePdfString(m[2])
  }
  return out
}

function extractPdfText(content, cidMap) {
  const blocks = content.match(/BT[\s\S]*?ET/g) || []
  const lines = new Map()
  for (const block of blocks) {
    let x = 0
    let y = 0
    const tm = /([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm/g
    let m
    while ((m = tm.exec(block))) { x = parseFloat(m[5]); y = parseFloat(m[6]) }
    const txt = textOfPdfBlock(block, cidMap)
    if (!txt.trim()) continue
    const key = Math.round(y)
    if (!lines.has(key)) lines.set(key, [])
    lines.get(key).push([x, txt])
  }
  const ys = [...lines.keys()].sort((a, b) => b - a)
  return ys.map((y) => lines.get(y).sort((a, b) => a[0] - b[0]).map((p) => p[1]).join('')).join('\n')
}

function extractPdf(buf) {
  const raw = buf.toString('latin1')
  const streams = []
  const re = /stream\r?\n/g
  let m
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length
    const end = raw.indexOf('endstream', start)
    if (end < 0) break
    const bin = Buffer.from(raw.slice(start, end), 'latin1')
    let dec = null
    for (const fn of [inflateSync, inflateRawSync]) {
      try { dec = fn(bin); break } catch { /* 尝试下一种 */ }
    }
    streams.push(dec ? dec.toString('latin1') : raw.slice(start, end))
  }
  const cidMap = buildCidMap(streams.join('\n'))
  const parts = []
  for (const st of streams) {
    if (!/BT[\s\S]*?ET/.test(st)) continue
    const t = extractPdfText(st, cidMap).trim()
    if (t) parts.push(t)
  }
  return parts.join('\n').trim()
}

function extractResumeFile(base64, filename) {
  const buf = Buffer.from(String(base64 || ''), 'base64')
  if (!buf.length) throw new Error('文件内容为空')
  const name = String(filename || '').toLowerCase()
  if (name.endsWith('.md') || name.endsWith('.txt')) return buf.toString('utf8')
  if (name.endsWith('.docx')) return extractDocx(buf)
  if (name.endsWith('.pdf')) {
    const text = extractPdf(buf)
    if (!text || text.length < 20) throw new Error('未能从 PDF 提取文字（可能是扫描件或加密 PDF），请改用 md / txt，或粘贴文字')
    return text
  }
  throw new Error('不支持的文件类型：' + (filename || '未知') + '（支持 md / txt / docx / pdf）')
}

function saveJobPayload(dbPath, body) {
  const text = String(body.text || '').trim()
  if (!text) return { ok: false, message: '职位原文为空' }
  const title = String(body.title || '').trim()
  const company = cleanCompany(body.company || '')
  const url = String(body.url || '').trim()
  const platform = ['boss', 'liepin', 'manual'].includes(String(body.platform || '')) ? String(body.platform) : 'manual'
  const fields = extractSalaryCity(text)
  const city = String(body.city || '').trim() || fields.city
  const salaryMin = fields.salary_min
  const salaryMax = fields.salary_max
  const rawSalaryText = String(body.salary_text || '').trim()
  const builtSalary = salaryMin != null
    ? (salaryMax != null ? `${salaryMin}-${salaryMax}K` : `${salaryMin}K`) + (fields.salary_suffix ? `·${fields.salary_suffix}` : '')
    : ''
  const salaryText = rawSalaryText || builtSalary
  const expText = extractExp(text)
  const jdHash = computeJdHash(company, title, text)
  const db = openDb(dbPath)
  try {
    const existing = db.prepare("SELECT id FROM jobs WHERE jd_hash = ? AND jd_hash != ''").get(jdHash)
    if (existing) return { ok: true, duplicate: true, job_id: Number(existing.id), message: '已存在相同职位（#' + Number(existing.id) + '），已自动去重' }
    const r = db.prepare('INSERT INTO jobs (platform, title, company, title_norm, company_norm, city, salary_min, salary_max, salary_text, exp_text, description, url, jd_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(platform, title, company, normalizeTitle(title), normalizeCompany(company), city, salaryMin, salaryMax, salaryText, expText, text, url, jdHash, new Date().toISOString())
    return { ok: true, duplicate: false, job_id: Number(r.lastInsertRowid), message: '已存入 #' + Number(r.lastInsertRowid), 提取: { 城市: city || null, 薪资: salaryText || null, 经验年限: expText || null } }
  } finally { db.close() }
}

function readNodeBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// Chrome 插件写入通道：仅监听 127.0.0.1:18999，供 BOSS直聘/猎聘 扩展直接存入职位。
function panelRev(dbPath) {
  try {
    const db = openDb(dbPath)
    const j = db.prepare('SELECT COUNT(*) AS c, IFNULL(MAX(id), 0) AS m FROM jobs').get()
    const m = db.prepare('SELECT COUNT(*) AS c FROM matches').get()
    const f = db.prepare('SELECT COUNT(*) AS c FROM feedback').get()
    const t = db.prepare('SELECT COUNT(*) AS c FROM job_texts').get()
    return [j.c, j.m, m.c, f.c, t.c].join('/')
  } catch {
    return ''
  }
}

function startJobServer(ctx, dbPath) {
  const PORT = 18999
  let server
  try {
    server = createServer(async (req, res) => {
      const origin = String(req.headers.origin || '')
      const allowed = !origin || origin.startsWith('chrome-extension://') || /^https?:\/\/([a-z0-9-]+\.)*(zhipin\.com|liepin\.com)$/.test(origin)
      const headers = {
        'access-control-allow-origin': origin && allowed ? origin : 'null',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-allow-private-network': 'true',
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      }
      if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return }
      if (!allowed) { res.writeHead(403, headers); res.end(JSON.stringify({ ok: false, message: 'origin not allowed' })); return }
      if (req.method !== 'POST' || req.url !== '/api/jobs') { res.writeHead(404, headers); res.end(JSON.stringify({ ok: false, message: 'not found' })); return }
      try {
        const body = parseBody(await readNodeBody(req))
        const result = saveJobPayload(dbPath, body)
        res.writeHead(200, headers); res.end(JSON.stringify(result))
      } catch (e) {
        res.writeHead(400, headers); res.end(JSON.stringify({ ok: false, message: String((e && e.message) || e) }))
      }
    })
    server.on('error', (e) => console.warn('[dsh-find-job] 本地写入端口 18999 启动失败：' + ((e && e.message) || e)))
    server.listen(PORT, '127.0.0.1', () => console.info('[dsh-find-job] Chrome 插件写入端口已就绪：http://127.0.0.1:' + PORT))
  } catch (e) {
    console.warn('[dsh-find-job] 无法启动本地写入端口：' + ((e && e.message) || e))
    return
  }
  const dispose = () => { try { server.close() } catch {} }
  if (typeof ctx.effect === 'function') {
    try { ctx.effect(() => dispose) } catch {}
  }
}

async function handleAction(ctx, dbPath, model, provider, body) {
  const action = String(body.action || '')
  const needProvider = () => {
    if (!provider) throw new Error('没有可用的模型 provider，请先在 DSH 中配置并登录模型')
    return provider
  }
  switch (action) {
    case 'settings': {
      const db = openDb(dbPath)
      try { saveSettingsValue(db, body.city, body.salary_min) } finally { db.close() }
      return { ok: true }
    }
    case 'basic': {
      const db = openDb(dbPath)
      try { saveBasicProfile(db, body.name, body.current_title, body.years) } finally { db.close() }
      return { ok: true }
    }
    case 'note': {
      const db = openDb(dbPath)
      try { saveProfileNote(db, body.kind, body.ref, body.note) } finally { db.close() }
      return { ok: true }
    }
    case 'save_job': {
      return saveJobPayload(dbPath, body)
    }
    case 'delete_job': {
      const db = openDb(dbPath)
      try { deleteJobCascade(db, Number(body.job_id)) } finally { db.close() }
      return { ok: true, message: '已删除职位' }
    }
    case 'feedback': {
      const fb = String(body.fb || '')
      if (!['interested', 'not_interested', 'skip'].includes(fb)) return { ok: false, message: '反馈类型无效' }
      const db = openDb(dbPath)
      try {
        if (fb === 'skip') db.prepare('DELETE FROM feedback WHERE job_id = ?').run(Number(body.job_id))
        else upsertFeedback(db, Number(body.job_id), fb)
      } finally { db.close() }
      return { ok: true, message: fb === 'interested' ? '已记录：感兴趣' : fb === 'not_interested' ? '已记录：不感兴趣' : '已取消标记' }
    }
    case 'adjust_feedback': {
      const direction = String(body.direction || '').trim()
      if (!direction) return { ok: false, message: '缺少方向' }
      const db = openDb(dbPath)
      let map = {}
      try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'adjust_feedback'").get()
        map = row ? safeJson(row.value, {}) : {}
        map[direction] = String(body.feedback || '')
        saveSettingsValueJson(db, 'adjust_feedback', map)
      } finally { db.close() }
      return { ok: true }
    }
    case 'match': {
      const db = openDb(dbPath)
      let job, abilities, profile, settings
      try {
        job = readJobById(db, Number(body.job_id))
        abilities = readAbilities(db)
        profile = readProfile(db)
        settings = readSettings(db)
      } finally { db.close() }
      if (!job) return { ok: false, message: '职位不存在' }
      if (!abilities.length) return { ok: false, message: '还没有已确认的能力：请先解析履历并确认能力' }
      const reject = hardFilter(job, settings)
      if (reject) {
        const db2 = openDb(dbPath)
        try { upsertMatch(db2, job.id, 0, [], { reasons: ['硬条件不满足：' + reject], misses: [], suggestion: '' }) } finally { db2.close() }
        return { ok: true, hard_rejected: true, score: 0, message: '硬条件不满足：' + reject }
      }
      const p = needProvider()
      const data = await chatJson(ctx, p, model, MATCH_SYSTEM, buildMatchUser(job, abilities, profile), 4000, 0.1)
      const r = normalizeMatchResult(data)
      const db2 = openDb(dbPath)
      try { upsertMatch(db2, job.id, r.score, r.dims, { reasons: r.reasons, misses: r.misses, suggestion: r.suggestion }) } finally { db2.close() }
      let greeting = null
      if (r.score > 0) {
        try {
          const g = await chatJson(ctx, p, model, GREETING_SYSTEM, buildGreetingUser(job, r.reasons), 2000, 0.4)
          const db3 = openDb(dbPath)
          try { saveGreeting(db3, job.id, g) } finally { db3.close() }
          greeting = g
        } catch {}
      }
      return { ok: true, hard_rejected: false, score: r.score, dims: r.dims, reason: { reasons: r.reasons, misses: r.misses, suggestion: r.suggestion }, greeting, message: '匹配打分完成：' + r.score + ' 分' }
    }
    case 'batch_match': {
      if (JOBS.batch.running) return { ok: false, message: '已有批量打分任务在运行' }
      void runBatchJob(ctx, dbPath, model, needProvider()).catch(() => {})
      return { ok: true, started: true, message: '批量打分已开始（后台执行中…）' }
    }
    case 'parse_resume': {
      let text = String(body.text || '').trim()
      if (!text && body.file_base64) {
        try { text = String(extractResumeFile(body.file_base64, body.filename) || '').trim() }
        catch (e) { return { ok: false, message: String((e && e.message) || e) } }
      }
      if (!text) return { ok: false, message: '简历内容为空' }
      if (JOBS.parse.running) return { ok: false, message: '已有履历解析任务在运行' }
      void runParseJob(ctx, dbPath, model, needProvider(), text).catch(() => {})
      return { ok: true, started: true, message: '解析已开始' }
    }
    case 'greeting': {
      const db = openDb(dbPath)
      let job, reason
      try {
        job = readJobById(db, Number(body.job_id))
        reason = job ? readMatchReason(db, Number(body.job_id)) : null
      } finally { db.close() }
      if (!job) return { ok: false, message: '职位不存在' }
      if (!job || !reason) return { ok: false, message: '该职位还没有匹配记录：请先打分' }
      const p = needProvider()
      const g = await chatJson(ctx, p, model, GREETING_SYSTEM, buildGreetingUser(job, reason.reasons || []), 2000, 0.4)
      const db2 = openDb(dbPath)
      try { saveGreeting(db2, job.id, g) } finally { db2.close() }
      return { ok: true, message: '打招呼语已生成', greeting: g }
    }
    case 'ability_add': {
      const name = String(body.name || '').trim()
      if (!name) return { ok: false, message: '能力名为空' }
      const db = openDb(dbPath)
      try { addAbilityRow(db, name, body.evidence) } finally { db.close() }
      return { ok: true, message: '已新增能力' }
    }
    case 'ability_edit': {
      const db = openDb(dbPath)
      try {
        if (!patchAbilityRow(db, Number(body.id), { name: body.name, evidence: body.evidence })) return { ok: false, message: '能力不存在' }
      } finally { db.close() }
      return { ok: true, message: '能力已保存' }
    }
    case 'ability_status': {
      const status = body.status === 'confirmed' ? 'confirmed' : 'pending'
      const db = openDb(dbPath)
      try {
        if (!patchAbilityRow(db, Number(body.id), { status })) return { ok: false, message: '能力不存在' }
      } finally { db.close() }
      return { ok: true, message: status === 'confirmed' ? '已确认' : '已撤销确认' }
    }
    case 'ability_delete': {
      const db = openDb(dbPath)
      try { db.prepare('DELETE FROM abilities WHERE id = ?').run(Number(body.id)) } finally { db.close() }
      return { ok: true, message: '能力已删除' }
    }
    case 'intents': {
      const arr = Array.isArray(body.intents) ? body.intents : []
      const clean = []
      for (const it of arr) {
        const direction = cleanDirection(it['方向'])
        if (!direction) continue
        const variants = Array.isArray(it['变体']) ? it['变体'].map(String) : []
        clean.push({ 方向: direction, 变体: cleanVariants(variants, direction) })
      }
      const db = openDb(dbPath)
      try { saveIntentsValue(db, clean) } finally { db.close() }
      return { ok: true, message: '意向职位已保存', intents: clean }
    }
    case 'regen_intent': {
      const direction = String(body.direction || '').trim()
      if (!direction) return { ok: false, message: '缺少方向' }
      const db = openDb(dbPath)
      let resumeText, profile
      try { resumeText = readResume(db); profile = readProfile(db) } finally { db.close() }
      if (!resumeText) return { ok: false, message: '请先上传并解析履历' }
      const intents = Array.isArray(profile['意向岗位']) ? profile['意向岗位'] : []
      const exclude = intents.map(it => String((it && it['方向']) || '')).filter(d => d && _variantCore(d) !== _variantCore(direction))
      const p = needProvider()
      const user = '已有方向（不得重复）：\n' + JSON.stringify(exclude, null, 2)
        + '\n\n需要替换的当前方向：' + direction
        + '\n\n简历原文：\n' + resumeText.slice(0, 6000)
      const data = await chatJson(ctx, p, model, INTENT_REGEN_SYSTEM, user, 1200, 0.7)
      const newDir = cleanDirection(data['方向'] || data.direction)
      if (!newDir) return { ok: false, message: '模型没有返回方向，请重试' }
      const variants = cleanVariants(Array.isArray(data['变体']) ? data['变体'].map(String) : [], newDir)
      const next = intents.map(it => (String((it && it['方向']) || '') === direction ? { 方向: newDir, 变体: variants } : it))
      const db2 = openDb(dbPath)
      try { saveIntentsValue(db2, next) } finally { db2.close() }
      return { ok: true, 方向: newDir, 变体: variants, intents: next }
    }
    case 'gap_report': {
      const db = openDb(dbPath)
      let stats, abilities, profile
      try {
        stats = gapStats(readMatches(db), readFeedback(db))
        abilities = readAbilities(db)
        profile = readProfile(db)
      } finally { db.close() }
      if (!stats['样本数']) return { ok: false, message: '还没有匹配记录：请先打分' }
      const p = needProvider()
      const user = '匹配统计：\n' + JSON.stringify(stats, null, 2)
        + '\n\n已确认能力：\n' + JSON.stringify(abilities.map(a => ({ 能力: a.name, 证据: a.evidence })), null, 2)
        + '\n\n画像摘要：\n' + JSON.stringify({ 当前职位: profile['当前职位'] || '', 总工作年限: profile['总工作年限'] || '', 意向岗位: profile['意向岗位'] || [] }, null, 2)
      const report = await chatJson(ctx, p, model, GAP_SYSTEM, user, 3000, 0.2)
      const saveDb = openDb(dbPath)
      try { saveSettingsValueJson(saveDb, 'gap_report', report) } finally { saveDb.close() }
      return { ok: true, message: '差距分析报告已生成', report }
    }
    case 'adjust': {
      const direction = String(body.direction || '').trim()
      if (!direction) return { ok: false, message: '请选择方向' }
      const db = openDb(dbPath)
      let resumeText, profile, abilities, notes, prev
      try {
        resumeText = readResume(db)
        profile = readProfile(db)
        abilities = readAbilities(db)
        notes = readNotes(db)
        prev = readResumeAdjust(db, direction)
      } finally { db.close() }
      if (!resumeText) return { ok: false, message: '请先上传并解析履历' }
      const refDb = openDb(dbPath)
      let ref
      try { ref = interestedJobsInfo(refDb) } finally { refDb.close() }
      const p = needProvider()
      const user = '目标方向：' + direction
        + (body.feedback && prev ? '\n\n【本次任务：在上一版基础上按反馈继续调整】\n用户反馈：' + String(body.feedback) + '\n\n上一版简历正文：\n' + String(prev.content || '') : '')
        + '\n\n简历原文：\n' + resumeText.slice(0, 6000)
        + '\n\n已确认能力：\n' + JSON.stringify(abilities.map(a => ({ 能力: a.name, 证据: a.evidence })), null, 2)
        + '\n\n经历补充说明：\n' + JSON.stringify(notes, null, 2)
        + '\n\n参考集职位（共 ' + ref.used.length + ' 个）：\n' + JSON.stringify(ref.jobsInfo.slice(0, 12), null, 2)
      const data = await chatJson(ctx, p, model, REWRITE_SYSTEM, user, 8000, 0.2)
      const content = String(data['简历正文'] || '')
      const summary = Array.isArray(data['调整说明']) ? data['调整说明'] : []
      const examples = Array.isArray(data['改写示例']) ? data['改写示例'] : []
      const db2 = openDb(dbPath)
      try { saveResumeAdjust(db2, direction, content, summary, ref.used, examples) } finally { db2.close() }
      return { ok: true, message: '简历调整已生成（基于参考集 ' + ref.used.length + ' 个职位）', direction, 基于参考职位数: ref.used.length, 调整说明: summary, 改写示例: examples, 简历正文: content }
    }
    case 'llm_catalog': {
      const providers = []
      try {
        for (const p of ctx.llm.listProviders() || []) providers.push({ id: p.id, name: p.name || p.id })
      } catch (e) {
        return { ok: false, message: '读取模型服务失败：' + String((e && e.message) || e) }
      }
      const models = {}
      for (const p of providers) {
        try {
          const list = await ctx.llm.listModels(p.id)
          models[p.id] = list.map(m => ({
            id: m.id,
            name: m.name || m.id,
            efforts: (m.reasoning && Array.isArray(m.reasoning.efforts) ? m.reasoning.efforts : []).map(e => ({ id: e.id, name: e.name || e.id })),
          }))
        } catch {
          models[p.id] = []
        }
      }
      const ad = readAgentDefaults() || {}
      const cfg = PLUGIN_CONFIG || {}
      return {
        ok: true,
        providers,
        models,
        current: {
          provider: (LLM_SETTINGS && LLM_SETTINGS.provider) || '',
          model: (LLM_SETTINGS && LLM_SETTINGS.model) || '',
          effort: (LLM_SETTINGS && LLM_SETTINGS.effort) || '',
          effective_provider: (LLM_SETTINGS && LLM_SETTINGS.provider) || cfg.provider || provider || ad.provider || 'deepseek-account',
          effective_model: (LLM_SETTINGS && LLM_SETTINGS.model) || cfg.model || model || DEFAULT_MODEL,
        },
      }
    }
    case 'save_llm_settings': {
      const providerId = String(body.provider || '').trim()
      const modelId = String(body.model || '').trim()
      const effortId = String(body.effort || '').trim()
      if (!providerId || !modelId) return { ok: false, message: '请选择模型服务和模型' }
      let list
      try {
        list = await ctx.llm.listModels(providerId)
      } catch (e) {
        return { ok: false, message: '模型服务不可用：' + String((e && e.message) || e).slice(0, 160) }
      }
      const hit = list.find(m => m.id === modelId)
      if (!hit) return { ok: false, message: '该模型不在所选服务的可用列表中' }
      const efforts = (hit.reasoning && Array.isArray(hit.reasoning.efforts) ? hit.reasoning.efforts : []).map(e => e.id)
      if (effortId && !efforts.includes(effortId)) return { ok: false, message: '该模型不支持所选推理强度' }
      const db = openDb(dbPath)
      try {
        saveSettingValue(db, 'llm_provider', providerId)
        saveSettingValue(db, 'llm_model', modelId)
        saveSettingValue(db, 'llm_effort', effortId)
      } finally { db.close() }
      LLM_SETTINGS = { provider: providerId, model: modelId, effort: effortId }
      return { ok: true, message: '模型设置已保存：' + modelId + (effortId ? ' · ' + effortId : ''), llm: LLM_SETTINGS }
    }
    case 'reset_llm_settings': {
      const db = openDb(dbPath)
      try {
        for (const k of ['llm_provider', 'llm_model', 'llm_effort']) db.prepare('DELETE FROM settings WHERE key = ?').run(k)
      } finally { db.close() }
      LLM_SETTINGS = { provider: '', model: '', effort: '' }
      return { ok: true, message: '已恢复为 DSH 默认模型' }
    }
    case 'status': {
      return { ok: true, batch: JOBS.batch, parse: JOBS.parse }
    }
    case 'open_ext_dir': {
      return openExtensionDir()
    }
    default:
      return { ok: false, message: '未知操作：' + action }
  }
}

// ---------- 插件入口 ----------

export function apply(ctx, config = {}) {
  PLUGIN_CONFIG = config
  const dbPath = config.dbPath || DEFAULT_DB_PATH
  const agentDefaults = readAgentDefaults()
  const model = config.model || (agentDefaults && agentDefaults.model) || DEFAULT_MODEL
  try {
    const db0 = openDb(dbPath)
    try { LLM_SETTINGS = readLlmSettings(db0) } finally { db0.close() }
  } catch (e) {
    console.warn('[dsh-find-job] 读取模型设置失败：' + ((e && e.message) || e))
  }

  function resolveProvider() {
    return pickProvider(ctx)
  }

  // 1. 读取求职画像与硬条件
  ctx.tools.register(defineTool({
    name: 'find_job_read',
    description: '读取求职画像与硬条件：已确认能力、意向职位、期望城市、最低月薪，以及职位库、匹配、反馈计数。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute() {
      const db = openDb(dbPath)
      try {
        const settings = readSettings(db)
        const profile = readProfile(db)
        const abilities = readAbilities(db)
        const pending = db.prepare("SELECT COUNT(*) AS c FROM abilities WHERE status = 'pending'").get().c
        const jobCount = db.prepare('SELECT COUNT(*) AS c FROM jobs').get().c
        const matchCount = db.prepare('SELECT COUNT(*) AS c FROM matches').get().c
        const interested = db.prepare("SELECT COUNT(*) AS c FROM feedback WHERE action='interested'").get().c
        const notInterested = db.prepare("SELECT COUNT(*) AS c FROM feedback WHERE action='not_interested'").get().c
        return {
          已确认能力: abilities.map(a => ({ 能力: a.name, 证据: a.evidence || '', 置信度: a.confidence || '' })),
          待确认推断能力数: pending,
          意向岗位: profile['意向岗位'] || [],
          硬条件: { 期望城市: settings.city || '不限', 最低月薪K: settings.salary_min || '不限' },
          计数: { 职位库: jobCount, 已匹配: matchCount, 感兴趣: interested, 不感兴趣: notInterested },
        }
      } finally {
        db.close()
      }
    },
  }))

  // 2. 职位库列表
  ctx.tools.register(defineTool({
    name: 'find_job_list',
    description: '列出职位库中的职位（职位名/公司/城市/薪资/分数/是否已有打招呼语），可按关键词过滤职位名或公司名。',
    parameters: {
      query: { type: 'string', description: '可选关键词，按职位名或公司名模糊匹配；留空返回全部。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute(args) {
      const db = openDb(dbPath)
      try {
        const jobs = readJobs(db)
        const matches = readMatches(db)
        const scoreMap = Object.fromEntries(matches.map(m => [m.job_id, m.score]))
        const greetRows = db.prepare("SELECT job_id FROM job_texts WHERE greeting IS NOT NULL AND greeting != ''").all()
        const greeted = new Set(greetRows.map(r => r.job_id))
        const q = String(args.query || '').trim().toLowerCase()
        const rows = jobs
          .filter(j => !q || String(j.title || '').toLowerCase().includes(q) || String(j.company || '').toLowerCase().includes(q))
          .map(j => ({
            id: j.id, 岗位: j.title || '', 公司: j.company || '', 城市: j.city || '',
            薪资: j.salary_text || '', 分数: scoreMap[j.id] ?? null, 已打招呼: greeted.has(j.id),
          }))
        return { 职位: rows, 总数: rows.length }
      } finally {
        db.close()
      }
    },
  }))

  // 2c. 职位反馈：感兴趣 / 不感兴趣 / 清除
  ctx.tools.register(defineTool({
    name: 'find_job_feedback',
    description: '给某个职位打「感兴趣 / 不感兴趣 / 清除」标记。感兴趣=加入参考集（即使低于 60 分），不感兴趣=从参考集剔除，清除=恢复默认。参考集影响差距分析与简历调整的结果。',
    parameters: {
      job_id: { type: 'integer', required: true, description: '职位 id（见 find_job_list）。' },
      action: { type: 'string', required: true, description: 'interested（感兴趣）/ not_interested（不感兴趣）/ skip（清除标记）。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute(args) {
      const jobId = Number(args.job_id)
      const action = String(args.action || '').trim()
      if (!Number.isInteger(jobId) || jobId <= 0) return { error: 'job_id 必须是正整数。' }
      if (!['interested', 'not_interested', 'skip'].includes(action)) {
        return { error: 'action 只能是 interested / not_interested / skip。' }
      }
      const db = openDb(dbPath)
      try {
        const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(jobId)
        if (!job) return { error: `职位 #${jobId} 不存在。` }
        if (action === 'skip') {
          db.prepare('DELETE FROM feedback WHERE job_id = ?').run(jobId)
        } else {
          upsertFeedback(db, jobId, action)
        }
        const interested = db.prepare("SELECT COUNT(*) AS c FROM feedback WHERE action='interested'").get().c
        const notInterested = db.prepare("SELECT COUNT(*) AS c FROM feedback WHERE action='not_interested'").get().c
        const label = action === 'interested' ? '已标记感兴趣（加入参考集）' : action === 'not_interested' ? '已标记不感兴趣（从参考集剔除）' : '已清除标记（恢复默认）'
        return { ok: true, job_id: jobId, action, message: label, 计数: { 感兴趣: interested, 不感兴趣: notInterested } }
      } finally {
        db.close()
      }
    },
  }))

  // 2b. 手动存职位（纯规则，去重）
  ctx.tools.register(defineTool({
    name: 'find_job_save',
    description: '手动把一个职位存进本地职位库：粘贴职位原文，用纯规则提取城市/薪资/经验年限，并按「公司 + 职位名 + 职位描述」规范化后做去重。也可选填职位名、公司、城市、薪资、链接、平台（默认 manual）。',
    parameters: {
      text: { type: 'string', required: true, description: '职位描述（职位原文）的完整原文。' },
      title: { type: 'string', description: '可选：职位名，不填则留空。' },
      company: { type: 'string', description: '可选：公司名，不填则留空（可手填修正脏数据）。' },
      city: { type: 'string', description: '可选：城市，不填则从职位原文自动识别。' },
      salary_text: { type: 'string', description: '可选：薪资原文（如 20-35K·14薪），不填则从职位原文自动识别。' },
      url: { type: 'string', description: '可选：职位链接。' },
      platform: { type: 'string', description: '可选：boss / liepin / manual，默认 manual。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute(args) {
      const text = String(args.text || '').trim()
      if (!text) return { error: '职位原文为空：请粘贴职位描述全文。' }
      const title = String(args.title || '').trim()
      const company = cleanCompany(args.company || '')
      const platform = ['boss', 'liepin', 'manual'].includes(String(args.platform || '')) ? String(args.platform).trim() : 'manual'
      const url = String(args.url || '').trim()
      const salaryText = String(args.salary_text || '').trim()
      const fields = extractSalaryCity((salaryText ? salaryText + '\n' : '') + text)
      const city = String(args.city || '').trim() || fields.city
      let salaryMin = fields.salary_min
      let salaryMax = fields.salary_max
      let finalSalaryText = salaryText
      if (!finalSalaryText && salaryMin != null) {
        finalSalaryText = (salaryMax != null ? `${salaryMin}-${salaryMax}K` : `${salaryMin}K`) + (fields.salary_suffix ? `·${fields.salary_suffix}` : '')
      }
      const expText = extractExp(text)
      const jdHash = computeJdHash(company, title, text)
      const db = openDb(dbPath)
      try {
        const existing = db.prepare("SELECT id FROM jobs WHERE jd_hash = ? AND jd_hash != ''").get(jdHash)
        if (existing) {
          return { ok: true, duplicate: true, job_id: Number(existing.id), message: '已存在相同职位（#' + Number(existing.id) + '），已自动去重', 提取: { 城市: city || null, 薪资: finalSalaryText || null, 经验年限: expText || null } }
        }
        const now = new Date().toISOString()
        const r = db.prepare(
          'INSERT INTO jobs (platform, title, company, title_norm, company_norm, city, salary_min, salary_max, salary_text, exp_text, description, url, jd_hash, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        ).run(platform, title, company, normalizeTitle(title), normalizeCompany(company), city, salaryMin, salaryMax, finalSalaryText, expText, text, url, jdHash, now)
        return { ok: true, duplicate: false, job_id: Number(r.lastInsertRowid), 提取: { 城市: city || null, 薪资: finalSalaryText || null, 经验年限: expText || null } }
      } finally {
        db.close()
      }
    },
  }))

  // 3. 粘贴 JD 打分（不落库）
  ctx.tools.register(defineTool({
    name: 'find_job_match',
    description: '给一段职位描述（职位原文）打分：先用纯规则做城市/薪资硬过滤，再用 DSH 中配置的模型生成 0~100 匹配分、四个维度分、匹配理由、缺口与一句话建议。不写入数据库。',
    parameters: {
      jd: { type: 'string', required: true, description: '职位描述（职位原文）的完整原文。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const db = openDb(dbPath)
      let settings, abilities, profile
      try {
        settings = readSettings(db)
        abilities = readAbilities(db)
        profile = readProfile(db)
      } finally {
        db.close()
      }
      if (!abilities.length) {
        return { error: '还没有已确认的能力：请先解析履历并确认能力，再打分。' }
      }
      const fields = extractSalaryCity(args.jd)
      const reject = hardFilter({ city: fields.city, salary_max: fields.salary_max }, settings)
      if (reject) {
        return { hard_rejected: true, score: 0, reason: { reasons: [`硬条件不满足：${reject}`], misses: [], suggestion: '' } }
      }
      const job = {
        title: '', company: '', city: fields.city, salary_text: '',
        salary_min: fields.salary_min, salary_max: fields.salary_max,
        exp_text: '', description: args.jd,
      }
      const provider = resolveProvider()
      const data = await chatJson(ctx, provider, model, MATCH_SYSTEM, buildMatchUser(job, abilities, profile), 4000, 0.1, exec.signal)
      const r = normalizeMatchResult(data)
      return { hard_rejected: false, score: r.score, dims: r.dims, reason: { reasons: r.reasons, misses: r.misses, suggestion: r.suggestion } }
    },
  }))

  // 4. 批量打分（只处理未打分职位，落库 + 打招呼）
  ctx.tools.register(defineTool({
    name: 'find_job_batch_match',
    description: '对职位库中所有「未打分」的职位批量打分：逐条做硬过滤与 LLM 打分，得分>0 的职位一并生成打招呼语，结果写入数据库。只处理还没有匹配记录的职位；可能耗时数分钟。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, exec) {
      const db = openDb(dbPath)
      let abilities, profile, settings
      try {
        abilities = readAbilities(db)
        profile = readProfile(db)
        settings = readSettings(db)
      } finally {
        db.close()
      }
      if (!abilities.length) {
        return { error: '还没有已确认的能力：请先解析履历并确认能力，再批量打分。' }
      }
      const db2 = openDb(dbPath)
      const jobs = readJobsWithoutMatch(db2)
      if (!jobs.length) {
        db2.close()
        return { started: false, message: '没有未打分的职位', 总数: 0, 完成: 0, 失败: 0, 结果: [] }
      }
      const provider = resolveProvider()
      const results = []
      let failed = 0
      for (const job of jobs) {
        const item = { job_id: job.id, title: job.title || '', company: job.company || '' }
        try {
          const reject = hardFilter(job, settings)
          if (reject) {
            const reason = { reasons: [`硬条件不满足：${reject}`], misses: [], suggestion: '' }
            upsertMatch(db2, job.id, 0, [], reason)
            item.score = 0; item.hard_rejected = true
          } else {
            const data = await chatJson(ctx, provider, model, MATCH_SYSTEM, buildMatchUser(job, abilities, profile), 4000, 0.1, exec.signal)
            const r = normalizeMatchResult(data)
            const reason = { reasons: r.reasons, misses: r.misses, suggestion: r.suggestion }
            upsertMatch(db2, job.id, r.score, r.dims, reason)
            item.score = r.score; item.hard_rejected = false
            if (r.score > 0) {
              try {
                const gUser = '目标职位描述：\n' + JSON.stringify({
                  岗位: job.title || '', 公司: job.company || '', 城市: job.city || '',
                  薪资: job.salary_text || '', 职责与要求: job.description || '',
                }, null, 2) + '\n\n匹配理由：\n' + JSON.stringify(r.reasons, null, 2)
                const g = await chatJson(ctx, provider, model, GREETING_SYSTEM, gUser, 2000, 0.4, exec.signal)
                saveGreeting(db2, job.id, g)
                item.greeting = true
              } catch { item.greeting = false }
            }
          }
        } catch (e) {
          failed += 1
          item.error = String(e && e.message || e)
        }
        results.push(item)
      }
      db2.close()
      return { started: true, 总数: jobs.length, 完成: results.length, 失败: failed, 结果: results }
    },
  }))

  // 5. 差距统计（纯规则）
  ctx.tools.register(defineTool({
    name: 'find_job_gap',
    description: '计算差距统计（纯规则，不调模型）：样本数、60 分以上、感兴趣/不感兴趣计数、各维度均分、高频能力缺口（按能力标签聚合 + 明细）。统计口径=参考集（≥60 分默认纳入 − 不感兴趣 + 感兴趣）。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute() {
      const db = openDb(dbPath)
      try {
        return gapStats(readMatches(db), readFeedback(db))
      } finally {
        db.close()
      }
    },
  }))

  // 6. 差距分析报告（LLM）
  ctx.tools.register(defineTool({
    name: 'find_job_gap_report',
    description: '用 DSH 模型生成差距分析报告：基于匹配统计、已确认能力与画像摘要，输出总体判断、能力短板、提升建议与简历呈现建议。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, exec) {
      const db = openDb(dbPath)
      let stats, abilities, profile
      try {
        stats = gapStats(readMatches(db), readFeedback(db))
        abilities = readAbilities(db)
        profile = readProfile(db)
      } finally {
        db.close()
      }
      if (!stats['样本数']) {
        return { error: '还没有匹配记录：请先对职位执行匹配打分。' }
      }
      const user = '匹配统计：\n' + JSON.stringify(stats, null, 2)
        + '\n\n已确认能力：\n' + JSON.stringify(abilities.map(a => ({ 能力: a.name, 证据: a.evidence })), null, 2)
        + '\n\n画像摘要：\n' + JSON.stringify({
          当前职位: profile['当前职位'] || '', 总工作年限: profile['总工作年限'] || '', 意向岗位: profile['意向岗位'] || [],
        }, null, 2)
      const provider = resolveProvider()
      return await chatJson(ctx, provider, model, GAP_SYSTEM, user, 3000, 0.2, exec.signal)
    },
  }))

  // 7. 单职位打招呼语（落库）
  ctx.tools.register(defineTool({
    name: 'find_job_greeting',
    description: '为某个已打分的职位生成打招呼文案（开场白 + 备用话术 + 要点），并保存到数据库。输入只有该职位描述 + 匹配理由。职位必须已有匹配记录（先打分）。',
    parameters: {
      job_id: { type: 'integer', required: true, description: '职位库中的职位 id（见 find_job_list）。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const db = openDb(dbPath)
      let job, reason
      try {
        job = readJobById(db, args.job_id)
        reason = job ? readMatchReason(db, args.job_id) : null
      } finally {
        db.close()
      }
      if (!job) return { error: `职位 #${args.job_id} 不存在。` }
      if (!reason) return { error: '该职位还没有匹配记录：请先打分，再生成打招呼文案。' }
      const user = '目标职位描述：\n' + JSON.stringify({
        岗位: job.title || '', 公司: job.company || '', 城市: job.city || '',
        薪资: job.salary_text || '', 职责与要求: job.description || '',
      }, null, 2) + '\n\n匹配理由：\n' + JSON.stringify((reason || {}).reasons || [], null, 2)
      const provider = resolveProvider()
      const g = await chatJson(ctx, provider, model, GREETING_SYSTEM, user, 2000, 0.4, exec.signal)
      const db2 = openDb(dbPath)
      try { saveGreeting(db2, args.job_id, g) } finally { db2.close() }
      return { ok: true, message: '打招呼语已生成', job_id: args.job_id, greeting: g }
    },
  }))

  // 8. 简历调整（分方向，落库）
  ctx.tools.register(defineTool({
    name: 'find_job_adjust',
    description: '为某个求职方向生成一份完整、可投递、结果导向的调整后简历（含调整说明与改写示例），写入数据库。方向来自画像的意向职位；带反馈再次生成时基于上一版增量修改。',
    parameters: {
      direction: { type: 'string', required: true, description: '目标求职方向（如「体验运营」），应为画像意向职位中的某个方向。' },
      feedback: { type: 'string', description: '可选：对上一版的修改意见。提供时基于上一版增量修改，未提到的内容尽量保持。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const db = openDb(dbPath)
      let resume, profile, abilities, notes, ref, prev
      try {
        resume = readResume(db)
        profile = readProfile(db)
        abilities = readAbilities(db)
        notes = readNotes(db)
        ref = interestedJobsInfo(db)
        prev = readResumeAdjust(db, String(args.direction || '').trim())
      } finally {
        db.close()
      }
      if (!resume) return { error: '还没有履历：请先在「能力画像」上传并解析履历。' }
      const direction = String(args.direction || '').trim()
      if (!direction) return { error: '请提供目标方向（direction）。' }
      const feedback = String(args.feedback || '').trim()
      const previousContent = prev ? String(prev.content || '') : ''

      let notesText = ''
      const noteLines = []
      for (const [company, note] of Object.entries(notes.work || {})) noteLines.push(`- ${company}：${note}`)
      for (const [name, note] of Object.entries(notes.project || {})) noteLines.push(`- 项目「${name}」：${note}`)
      if (noteLines.length) {
        notesText = '\n\n经历补充说明（用户本人补充的背景/细节/想强调的点，必须综合进对应经历；只使用补充说明里的事实，不要编造）：\n' + noteLines.join('\n')
      }
      const tail = '已确认能力：\n' + JSON.stringify(abilities.map(a => ({ 能力: a.name, 证据: a.evidence })), null, 2)
        + '\n\n画像摘要：\n' + JSON.stringify({
          姓名: profile['姓名'] || '', 当前职位: profile['当前职位'] || '', 总工作年限: profile['总工作年限'] || '',
          工作经历: profile['工作经历'] || [], 项目: profile['项目'] || [], 教育: profile['教育'] || [],
        }, null, 2)
        + notesText
        + '\n\n感兴趣职位（共性要求参考）：\n' + JSON.stringify(ref.jobsInfo, null, 2)

      let user
      if (feedback && previousContent) {
        user = `目标方向：${direction}\n\n【本次任务：在上一版基础上按反馈继续调整】\n用户反馈：${feedback}\n\n上一版简历正文（以此为唯一基础：只修改反馈提到的部分，未提到的内容必须与上一版保持一致，不要从头重写）：\n${previousContent.slice(0, 6000)}\n\n简历原文（仅用于核对事实，不要据此重写）：\n${resume.slice(0, 6000)}\n\n` + tail
      } else {
        user = `目标方向：${direction}\n\n简历原文：\n\n${resume.slice(0, 6000)}\n\n` + tail
        if (feedback) user += '\n\n用户对上一版的反馈（必须据此修改，未提到的部分尽量保持）：\n' + feedback
      }

      const provider = resolveProvider()
      const data = await chatJson(ctx, provider, model, REWRITE_SYSTEM, user, 8000, 0.2, exec.signal)
      const content = String(data['简历正文'] || '')
      const summary = Array.isArray(data['调整说明']) ? data['调整说明'].map(String) : []
      const examples = Array.isArray(data['改写示例']) ? data['改写示例'].map(e => ({ 原表述: String(e['原表述'] || ''), 建议改写: String(e['建议改写'] || '') })) : []

      const db2 = openDb(dbPath)
      try { saveResumeAdjust(db2, direction, content, summary, ref.used, examples) } finally { db2.close() }

      return { ok: true, message: '简历调整已生成（基于参考集 ' + ref.used.length + ' 个职位）', direction, 基于参考职位数: ref.used.length, 调整说明: summary, 改写示例: examples, 简历正文: content }
    },
  }))

  // 9. 面板接口（浏览器端读取 + 操作按钮；面板 UI 在 client.js）
  try {
    ctx.inject?.(['connection'], (host) => {
      if (typeof host?.connection?.fetch?.register !== 'function') {
        console.warn('[dsh-find-job] connection 服务不可用，面板接口未注册')
        return
      }
      const register = (path, methods, fetch) => host.connection.fetch.register({ path, methods, requestBody: 'buffered', fetch })
      register('/api/find-job/data', ['POST'], (request) => handlePanelRequest(request, dbPath))
      register('/api/find-job/action', ['POST'], async (request) => {
        try {
          const body = parseBody(await readBody(request))
          if (!body) return json(400, { ok: false, message: '请求体必须是 JSON 对象' })
          let provider = null
          try { provider = pickProvider(ctx) } catch { provider = null }
          return json(200, await handleAction(ctx, dbPath, model, provider, body))
        } catch (e) {
          return json(400, { ok: false, message: String((e && e.message) || e) })
        }
      })
      register('/api/find-job/status', ['GET'], async () => json(200, { ok: true, batch: JOBS.batch, parse: JOBS.parse, rev: panelRev(dbPath) }))
    })
  } catch (e) {
    console.warn('[dsh-find-job] 面板路由注册失败：' + ((e && e.message) || e))
  }

  startJobServer(ctx, dbPath)
}
