/* 内容脚本：BOSS直聘 / 猎聘职位详情页 → 提取 JD → 发送到本地服务。 */
(() => {
  "use strict";

  const API_BASE = "http://127.0.0.1:18999";

  const host = location.hostname;
  const platform = host.includes("zhipin") ? "boss" : host.includes("liepin") ? "liepin" : "unknown";

  /* 首个非空选择器结果 */
  function pick(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.innerText && el.innerText.trim()) return el.innerText.trim();
      } catch (_) { /* 非法选择器跳过 */ }
    }
    return "";
  }

  function textOf(selectors) {
    let out = "";
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.innerText && el.innerText.trim()) {
          out = el.innerText.trim();
          break;
        }
      } catch (_) { /* 跳过 */ }
    }
    return out.replace(/\n{3,}/g, "\n\n").slice(0, 3000);
  }

  /* 公司名清洗：取首行、剔除简介/薪资噪声；「公司简介\nXX成立于…」可救回公司名 */
  function cleanCompany(raw, title, salary) {
    const s0 = (raw || "").trim();
    if (!s0) return "";
    const m = s0.match(/公司简介\s*\n?\s*([^\s，,。]{2,10}?)成立于/);
    if (m) return m[1];
    const first = s0.split("\n")[0].trim().replace(/^[·•\-–—\s]+/, "").replace(/\s*[·•]\s*$/, "");
    if (!first) return "";
    const t = (title || "").trim();
    if (t && (first === t || first.startsWith(t))) return "";
    if (/公司简介|公司信息|公司介绍|公司地址|公司规模|所属行业|职位描述|职位介绍|聊一聊|查看全部|已认证|当前在线|招聘/.test(first)) return "";
    if (/\d+\s*[-—~]\s*\d+\s*[kK]|[·*\s]\d+\s*薪/.test(first)) return "";
    if (first.length > 30) return "";
    return first;
  }

  /* 公司名链接兜底（BOSS 用 /gongsi/，猎聘用 /company/） */
  const GENERIC_COMPANY = /^(公司|首页|查看所有职位|查看更多|更多职位|职位|招聘|登录|注册)$/;
  function companyFromAnchor() {
    const sels = platform === "boss"
      ? ['.sider-company .company-info a', ".company-info a[title]", 'a[href*="/gongsi/"]', ".sider-company a", ".job-sec.company a"]
      : ['.job-detail-company-box a', 'a[href*="/company/"]', ".company-info a", ".title-info h3 a"];
    for (const sel of sels) {
      for (const a of document.querySelectorAll(sel)) {
        const t = ((a.innerText || "").trim().split("\n")[0] || a.getAttribute("title") || "").trim();
        if (t && t.length >= 2 && t.length <= 30 && !GENERIC_COMPANY.test(t)) return t;
      }
    }
    return "";
  }

  /* BOSS 侧栏「公司基本信息」：跳过标题/规模/行业行取公司名 */
  function bossCompanyFromSider() {
    const box = document.querySelector(".sider-company");
    if (!box) return "";
    for (const raw of (box.innerText || "").split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      if (/公司基本信息|查看全部职位|已上市|未上市|已融资|不需要融资|天使轮|\d+\s*人以上|\d+-\d+人|互联网|电子商务|货运|生活服务|文化传媒|计算机软件|招聘|职位/.test(line)) continue;
      if (line.length >= 2 && line.length <= 30) return line;
    }
    return "";
  }

  /* JSON-LD 里的公司名（BOSS 详情页常带 hiringOrganization） */
  function companyFromLd() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const j = JSON.parse(s.textContent || "");
        const list = Array.isArray(j) ? j : [j];
        for (const item of list) {
          const org = item && item.hiringOrganization;
          if (org && org.name) return String(org.name).trim();
        }
      } catch (_) { /* 非 JSON 跳过 */ }
    }
    return "";
  }

  /* 按标题文字取相邻区块（猎聘「职位介绍」常是标题 + 兄弟节点） */
  function sectionByHeading(names) {
    const nodes = document.querySelectorAll("h1,h2,h3,h4,h5,div,span,p");
    for (const n of nodes) {
      if (n.children.length) continue;
      const t = (n.innerText || "").trim();
      if (!names.includes(t)) continue;
      let text = "";
      let el = n.nextElementSibling;
      while (el && text.length < 80) {
        text += "\n" + (el.innerText || "");
        el = el.nextElementSibling;
      }
      if (text.trim().length < 40 && n.parentElement) text += "\n" + (n.parentElement.innerText || "");
      const cut = cutDesc(text);
      if (cut.length > 20) return cut;
    }
    return "";
  }

  function cleanDesc(d) {
    let s = (d || "").trim();
    if (!s) return "";
    let i = s.indexOf("职位描述");
    if (i > 0 && i < 400) { s = s.slice(i); i = 0; }
    const j = s.indexOf("公司简介");
    if (j > 0 && (i >= 0 || j > 500)) s = s.slice(0, j);
    return s.trim();
  }

  const DESC_STOP = /公司信息|公司介绍|公司地址|工作地址|相似职位|举报|竞争优势|工商信息|职位发布者|其他职位|其他信息|行业要求/;
  function cutDesc(t) {
    let s2 = (t || "").trim();
    /* 只去掉「职位介绍 / 职位描述」这类区块标题；「工作职责：」「岗位职责：」属于正文首行，保留 */
    s2 = s2.replace(/^(职位介绍|职位描述)\s*[:：]?\s*\n?/, "");
    const j = s2.search(DESC_STOP);
    if (j > 80) s2 = s2.slice(0, j);
    return s2.trim();
  }
  function descSection(selectors) {
    for (const sel of selectors) {
      let el = null;
      try { el = document.querySelector(sel); } catch (_) { el = null; }
      if (!el) continue;
      const t = cutDesc(el.innerText || "");
      if (t.length > 20) return t;
    }
    return "";
  }
  function findSectionText(heading) {
    const nodes = document.querySelectorAll("h1,h2,h3,h4,h5,dt,span,p,div");
    for (const n of nodes) {
      if (n.children.length) continue;
      if ((n.innerText || "").trim() !== heading) continue;
      let box = n.parentElement;
      for (let k = 0; k < 4 && box; k++) {
        const raw = (box.innerText || "").trim();
        if (raw.length > heading.length + 50) {
          const t = cutDesc(raw.replace(heading, ""));
          if (t.length > 20) return t;
        }
        box = box.parentElement;
      }
    }
    return "";
  }

  /* 是否职位详情页（仅按 URL 形态判断） */
  function looksLikeJobPage() {
    if (platform === "boss") {
      return /\/job_detail\//.test(location.pathname) || /[?&]jobId=/.test(location.search);
    }
    if (platform === "liepin") {
      return /\/job\/[^/]*\.shtml|\/a\/\d+/.test(location.pathname);
    }
    return false;
  }

  function extract() {
    let title = "", company = "", city = "", salary = "", description = "";

    if (platform === "boss") {
      title = pick([
        ".job-title", ".job-title h1", "h1.job-title", ".name h1",
        ".info-primary .name", "[class*='job-title'] h1", "h1",
      ]);
      salary = pick([".salary", ".job-salary", "[class*='salary']"]);
      company = [
        companyFromLd(),
        companyFromAnchor(),
        bossCompanyFromSider(),
        pick([".sider-company .company-name", ".company-info .company-name", ".job-sec.company-info .name", "[class*='company-name']"]),
        pick([".sider-company h3", ".company-info h3", ".job-sec.company h3", ".job-sec.company"]),
      ].map((c) => cleanCompany(c, title, salary)).find((c) => c) || "";
      const meta = pick([".job-primary .info-primary p", "[class*='info-primary']", ".job-info"]);
      const m = meta.match(/([\u4e00-\u9fa5]{2,10}?)[·\s]?([\u4e00-\u9fa5]{1,6})[\u4e00-\u9fa5]*经验/);
      if (m) city = m[1];
      else {
        const cm = meta.match(/(北京|上海|广州|深圳|杭州|南京|成都|武汉|西安|重庆|长沙|苏州|天津|郑州|青岛|济南|合肥|福州|厦门|东莞|佛山|宁波|无锡|大连|昆明|南昌|贵阳|南宁|哈尔滨|长春|沈阳|石家庄|太原|呼和浩特|乌鲁木齐|兰州|银川|西宁|拉萨|海口|三亚|珠海|惠州|中山|嘉兴|绍兴|金华|台州|温州|泉州|常州|南通|徐州|扬州|盐城|泰州|镇江|淮安|连云港|宿迁)/);
        if (cm) city = cm[1];
      }
      description = cutDesc(textOf([
        ".job-sec-text", ".job-sec .text", "[class*='job-sec'] .text",
        ".job-detail", "[class*='job-detail']", ".job-card .job-info",
      ]));
    } else if (platform === "liepin") {
      title = pick([".title-info h1", "h1", ".job-title", "[class*='title-info'] h1"]);
      salary = pick(["p.job-item-title", "[class*='salary']", ".job-item .job-salary"]);
      company = companyFromAnchor() || pick([
        ".title-info h3 a", ".title-info h3", ".company-name", "[class*='company-name']",
      ]);
      const meta = pick([".basic-infor", "[class*='basic-infor']", ".job-qualifications"]);
      const cm = meta.match(/(北京|上海|广州|深圳|杭州|南京|成都|武汉|西安|重庆|长沙|苏州|天津|郑州|青岛|济南|合肥|福州|厦门|东莞|佛山|宁波|无锡|大连|昆明|南昌|贵阳|南宁|哈尔滨|长春|沈阳|石家庄|太原|呼和浩特|乌鲁木齐|兰州|银川|西宁|拉萨|海口|三亚|珠海|惠州|中山|嘉兴|绍兴|金华|台州|温州|泉州|常州|南通|徐州|扬州|盐城|泰州|镇江|淮安|连云港|宿迁)/);
      if (cm) city = cm[1];
      description = descSection([
        ".job-intro-container", ".job-description", "[class*='job-intro']",
        "dd.job-item", "[class*='job-description']",
      ]) || sectionByHeading(["职位介绍", "职位描述", "岗位职责"]) || findSectionText("职位介绍") || findSectionText("职位描述") || descSection([".content-word"]);
    }

    if (!title && document.title) {
      title = document.title.replace(/-[^-]*$/, "").replace(/招聘.*$/, "").trim();
    }
    if (!description) {
      description = textOf(["article", "main"]).slice(0, 3000);
    }
    company = cleanCompany(company, title, salary);
    description = cleanDesc(description);
    return {
      platform,
      url: location.href,
      title,
      company,
      text: description,
      city,
      salary_text: salary,
    };
  }

  /* 浮动「存入职位库」按钮 */
  const btn = document.createElement("button");
  btn.id = "jobmatcher-save-btn";
  btn.textContent = "存入职位库";
  btn.title = "find-job · 存入本地职位库（v0.1.27）";
  btn.type = "button";
  Object.assign(btn.style, {
    position: "fixed",
    right: "16px",
    top: "72px",
    zIndex: "2147483646",
    padding: "14px 26px",
    border: "none",
    borderRadius: "999px",
    background: "#2563eb",
    color: "#fff",
    fontSize: "16px",
    fontWeight: "700",
    letterSpacing: "1px",
    cursor: "pointer",
    boxShadow: "0 4px 14px rgba(37,99,235,.45)",
  });

  let savedHref = "";
  function resetBtn() {
    savedHref = "";
    btn.textContent = "存入职位库";
    btn.style.background = "#2563eb";
    btn.style.boxShadow = "0 4px 14px rgba(37,99,235,.45)";
  }
  function flashText(text, color, ok) {
    btn.textContent = text;
    btn.style.background = color;
    btn.style.boxShadow = "0 4px 14px rgba(0,0,0,.25)";
    setTimeout(() => { if (btn.textContent === text) resetBtn(); }, 2500);
  }
  function markFailed(msg) {
    btn.textContent = "存入失败";
    btn.style.background = "#dc2626";
    btn.style.boxShadow = "0 4px 14px rgba(220,38,38,.45)";
    btn.title = "find-job v0.1.27 · 失败原因：" + msg;
    setTimeout(() => { if (btn.textContent === "存入失败") { btn.textContent = "存入职位库"; btn.style.background = "#2563eb"; btn.style.boxShadow = "0 4px 14px rgba(37,99,235,.45)"; btn.title = "find-job · 存入本地职位库（v0.1.27）"; } }, 4000);
  }
  function markSaved(kind) {
    savedHref = location.href;
    btn.textContent = kind === "exists" ? "已存在 ✓" : "已存入 ✓";
    btn.style.background = kind === "exists" ? "#b45309" : "#16a34a";
    btn.style.boxShadow = kind === "exists"
      ? "0 4px 14px rgba(180,83,9,.45)"
      : "0 4px 14px rgba(22,163,74,.45)";
    const href = savedHref;
    setTimeout(() => { if (savedHref === href) resetBtn(); }, 4000);
  }

  btn.addEventListener("click", () => {
    if (!looksLikeJobPage()) {
      flashText("不在职位详情页", "#b45309");
      return;
    }
    const payload = extract();
    if (!payload.text) {
      flashText("未识别到职位内容", "#dc2626");
      return;
    }
    if (!chrome.runtime || !chrome.runtime.id) {
      btn.textContent = "请刷新页面";
      btn.style.background = "#b45309";
      btn.style.boxShadow = "0 4px 14px rgba(180,83,9,.45)";
      setTimeout(() => { if (btn.textContent === "请刷新页面") { btn.textContent = "存入职位库"; btn.style.background = "#2563eb"; btn.style.boxShadow = "0 4px 14px rgba(37,99,235,.45)"; } }, 3000);
      return;
    }
    btn.disabled = true;
    btn.textContent = "保存中…";
    let done = false;
    let timer = 0;
    const finish = (resp, err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      btn.disabled = false;
      btn.textContent = "存入职位库";
      if (err) { markFailed(String(err.message || err)); return; }
      if (!resp) { markFailed("插件后台无响应"); return; }
      const savedId = resp.data && resp.data.job_id;
      if (resp.ok && resp.data && resp.data.duplicate) {
        markSaved("exists");
      } else if (resp.ok) {
        markSaved("saved");
      } else {
        const why = resp.error || (resp.data && resp.data.message) || resp.data?.detail || resp.status;
        markFailed(String(why));
      }
    };
    timer = setTimeout(() => finish(null, new Error("超时（10 秒），请确认 DSH 应用正在运行")), 10000);
    try {
      chrome.runtime.sendMessage({ type: "save_job", payload }, (resp) => {
        const le = chrome.runtime && chrome.runtime.lastError;
        if (le) finish(null, new Error(le.message));
        else finish(resp);
      });
    } catch (e) {
      finish(null, e);
    }
  });

  /* 只在职位详情页显示（SPA 切页时自动出现/消失） */
  function syncButton() {
    if (savedHref && location.href !== savedHref) resetBtn();
    if (looksLikeJobPage()) {
      if (!btn.isConnected) document.documentElement.appendChild(btn);
    } else if (btn.isConnected) {
      btn.remove();
    }
  }
  syncButton();
  setInterval(syncButton, 600);
})();
