# dsh-find-job · 求职助手

给 DeepSeek Harness 用的求职助手：剖析自我能力、批量匹配职位、生成打招呼语、调整简历、分析职位差距。

- 本地运行、本地存储：数据在 `~/.find-job/job_matcher.db`，首次使用自动创建。
- LLM 使用 DSH 中已配置的模型，插件本身不需要 API key。
- 提供 GUI 面板（侧栏「求职助手」）与 10 个对话工具，两者共用同一个本地库。

## 安装

```sh
dsh plugin add dsh-find-job
```

或从源码安装：DSH 插件管理 → 安装 bundle → 选择本仓库目录（`find-job-bundle`）。

## 功能

| 面板 | 说明 |
|---|---|
| 能力画像 | 上传并解析履历（md / txt / docx / pdf），生成显性能力与推断能力（推断需确认），维护意向职位与硬条件 |
| 职位库 | 手动粘贴职位原文存入，或由 Chrome 插件一键存入；批量打分 |
| 匹配结果 | 0~100 匹配分、四维度分、匹配理由、能力缺口、打招呼语，可按平台筛选 |
| 求职建议 | 差距统计（参考集口径）、差距分析报告、按意向职位生成调整后简历 |

## 对话工具（10 个）

`find_job_read` / `find_job_list` / `find_job_save` / `find_job_match` / `find_job_batch_match` / `find_job_feedback` / `find_job_gap` / `find_job_gap_report` / `find_job_greeting` / `find_job_adjust`

规则类工具（read / list / save / gap）不调模型；模型类工具（match / batch_match / gap_report / greeting / adjust）使用 DSH 中配置的模型。

## Chrome 插件（可选）

`find-job/` 目录是配套的 Chrome 扩展：在 BOSS直聘 / 猎聘 的职位详情页点「存入职位库」，职位会直接写入本地 find-job（插件运行时在 `127.0.0.1:18999` 提供写入端口）。

安装：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择 `find-job` 文件夹。详见 [find-job/README.md](find-job/README.md)。

## 数据与隐私

- 所有数据只存在本机 `~/.find-job/job_matcher.db`，不上传到任何服务器。
- 模型调用只发送完成当前任务所需的内容：
  - 解析履历 / 重新生成意向职位：履历原文
  - 职位匹配 / 打招呼语：职位描述、已确认能力、画像摘要、硬条件、匹配理由
  - 简历调整：履历原文、已确认能力、画像摘要、经历补充说明、参考集职位的职位描述与匹配理由
  - 差距分析报告：差距统计（样本数、维度均分、能力缺口）
- Chrome 插件只提取当前打开的职位页面，不做自动抓取；写入端口 `127.0.0.1:18999` 仅监听本机，并只接受来自本扩展的跨域请求。

## License

MIT
