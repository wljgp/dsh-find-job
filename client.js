// 求职助手（dsh-find-job）面板：按 Web 版（app/static）的布局与样式实现。
// 数据接口由宿主 index.js 注册：api/find-job/data（读）、api/find-job/action（写）、api/find-job/status（轮询）。
window.__ModuleLoader__.load({
  id: 'dsh-find-job',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState, useCallback } = React

    const ROUTE_DATA = 'api/find-job/data'
    const ROUTE_ACTION = 'api/find-job/action'
    const ROUTE_STATUS = 'api/find-job/status'

    const CSS = `
.fj-root { background: #f5f6f8; color: #1f2329; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif; font-size: 14px; line-height: 1.6; height: 100%; min-height: 0; display: flex; flex-direction: column; }
.fj-root * { box-sizing: border-box; }
.fj-root .topbar { display: flex; align-items: center; justify-content: space-between; padding: 12px 24px; background: #fff; border-bottom: 1px solid #e3e6ea; flex-wrap: wrap; gap: 8px; }
.fj-root .brand { font-size: 16px; font-weight: 700; }
.fj-root .brand .sub { font-size: 12.5px; color: #6b7280; font-weight: 400; margin-left: 8px; }
.fj-root .tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.fj-root .tab { border: none; background: transparent; padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 14px; color: #6b7280; }
.fj-root .tab:hover { background: #eef1f5; }
.fj-root .tab.active { background: #2563eb; color: #fff; }
.fj-root .topbar-right { display: flex; align-items: center; gap: 8px; }
.fj-root .llm-ctl { position: relative; }
.fj-root .llm-btn { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fj-root .llm-backdrop { position: fixed; inset: 0; z-index: 59; background: transparent; }
.fj-root .llm-panel { position: absolute; right: 0; top: calc(100% + 6px); z-index: 60; width: 340px; background: #fff; border: 1px solid #e3e6ea; border-radius: 10px; box-shadow: 0 10px 28px rgba(15,23,42,.14); padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.fj-root .llm-panel label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: #6b7280; }
.fj-root .llm-panel select { height: 34px; }
.fj-root .llm-panel .row { justify-content: flex-end; gap: 8px; margin-top: 2px; }
.fj-root .llm-hint { font-size: 12px; color: #6b7280; margin: 0; }
.fj-root .llm-err { color: #dc2626; }
.fj-root main { max-width: 1100px; margin: 0 auto; padding: 20px 24px 60px; width: 100%; flex: 1; overflow: auto; min-height: 0; }
.fj-root .card { background: #fff; border: 1px solid #e3e6ea; border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; }
.fj-root .card h2 { margin: 0 0 8px; font-size: 15px; }
.fj-root .muted { color: #6b7280; }
.fj-root .hint { color: #6b7280; font-size: 13px; margin: 0 0 10px; }
.fj-root .usage-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; }
.fj-root .usage-line .btn.small { margin-left: auto; }
.fj-root .status { font-size: 12px; color: #6b7280; }
.fj-root .status.status-ok { color: #16a34a; }
.fj-root .status.status-err { color: #dc2626; }
.fj-root .note-status { font-size: 12px; color: #16a34a; }
.fj-root .note-status.err { color: #dc2626; }
.fj-root .save-hint { font-size: 12px; color: #16a34a; margin-left: 4px; }
.fj-root .save-hint.err { color: #dc2626; }
.fj-root .save-tip { display: block; margin-top: 3px; font-size: 11.5px; font-weight: 400; color: #16a34a; }
.fj-root .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.fj-root .row.right { justify-content: flex-end; }
.fj-root .row.job-align { margin-right: 15px; }
.fj-root .btn { display: inline-flex; align-items: center; justify-content: center; min-height: 34px; border: 1px solid #e3e6ea; background: #fff; padding: 7px 14px; border-radius: 8px; cursor: pointer; font-size: 13.5px; line-height: 1.35; color: #1f2329; transition: background .15s, border-color .15s; font-family: inherit; }
.fj-root .btn:hover { background: #f2f4f7; }
.fj-root .btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.fj-root .btn.primary:hover { background: #1d4ed8; }
.fj-root .btn:disabled { opacity: .55; cursor: not-allowed; }
.fj-root .btn.small { display: inline-flex; align-items: center; justify-content: center; min-height: 26px; padding: 3px 10px; font-size: 12.5px; border-radius: 6px; }
.fj-root .btn.primary:not(.small) { width: 140px; }
.fj-root .job-actions .btn.small { width: 72px; }
.fj-root .intent-acts .btn.small { width: 72px; }
.fj-root .ability-row .btn.small { width: 72px; }
.fj-root .match-actions .btn.small { width: 72px; }
.fj-root .greet-head .btn.small { width: 72px; }
.fj-root .tag.dup { min-width: 88px; }
.fj-root .btn.ok { color: #16a34a; border-color: #b7dfc3; }
.fj-root .btn.danger { color: #dc2626; border-color: #f0c4c4; }
.fj-root .btn.danger:hover { background: #fdf2f2; border-color: #e8a3a3; }
.fj-root a.btn, .fj-root a.btn:hover { text-decoration: none; }
.fj-root .banner-ok, .fj-root .banner-err, .fj-root .banner-warn { padding: 10px 14px; border-radius: 10px; margin-bottom: 16px; }
.fj-root .banner-ok { background: #e8f7ee; border: 1px solid #bfe3c8; color: #16a34a; }
.fj-root .banner-err { background: #fdecec; border: 1px solid #f3c1c1; color: #dc2626; }
.fj-root .banner-warn { background: #fdf3e2; border: 1px solid #f0d9a8; color: #b45309; }
.fj-root input[type="text"], .fj-root input[type="number"], .fj-root input[type="url"], .fj-root textarea, .fj-root select { min-height: 34px; border: 1px solid #e3e6ea; border-radius: 8px; padding: 7px 10px; font-size: 13.5px; line-height: 1.35; font-family: inherit; min-width: 220px; background: #fff; color: #1f2329; }
.fj-root input[type="text"]:focus, .fj-root input[type="number"]:focus, .fj-root input[type="url"]:focus, .fj-root textarea:focus, .fj-root select:focus { outline: 2px solid #bfd3f7; border-color: #2563eb; }
.fj-root .form { display: flex; flex-direction: column; gap: 12px; max-width: 420px; }
.fj-root .form.wide { max-width: none; }
.fj-root .form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #6b7280; }
.fj-root .form .btn { align-self: flex-start; }
.fj-root #jd-text, .fj-root #jd-url { width: 100%; box-sizing: border-box; min-width: 0; }
.fj-root #jd-text { resize: vertical; }
.fj-root .card-head { display: flex; align-items: center; justify-content: flex-start; gap: 10px 16px; margin-bottom: 10px; flex-wrap: wrap; }
.fj-root .card-head h2 { margin: 0; }
.fj-root .card-head .resume-meta { flex: 1; min-width: 0; }
.fj-root .card-head .btn.upload-resume { min-width: 140px; flex: none; text-align: center; }
.fj-root .card-head .batch-row { margin-left: auto; margin-right: 15px; }
.fj-root .job-filter { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.fj-root .pf-btn { display: inline-flex; align-items: center; border: 1px solid transparent; background: transparent; padding: 5px 11px; border-radius: 999px; cursor: pointer; font-size: 13px; color: #475569; font-family: inherit; }
.fj-root .pf-btn:hover { background: #f1f5f9; }
.fj-root .pf-btn.active { background: #2563eb; color: #fff; }
.fj-root .basic-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; align-items: center; }
.fj-root .form .basic-field { display: inline-flex; flex-direction: row; align-items: center; gap: 6px; }
.fj-root .basic-row .basic-field { display: flex; width: 100%; flex-direction: column; align-items: stretch; gap: 2px; }
.fj-root .basic-label { font-size: 12.5px; color: #6b7280; white-space: nowrap; }
.fj-root .basic-row .basic-input { flex: 1; min-width: 150px; border: 1px solid transparent; border-bottom: 1px dashed #cbd5e1; border-radius: 0; background: transparent; padding: 4px 6px; }
.fj-root .basic-row .basic-input:hover { background: #f8fafc; }
.fj-root .basic-row .basic-input:focus { border-color: #2563eb; outline: none; background: #fff; border-radius: 6px; }
.fj-root .chip { display: inline-flex; align-items: center; gap: 6px; background: #eef2f9; border: 1px solid #dbe4f3; border-radius: 8px; padding: 4px 12px; margin: 3px 4px 3px 0; font-size: 13px; position: relative; }
.fj-root .chip.copied::after { content: "已复制"; position: absolute; left: 2px; top: 100%; margin-top: 1px; color: #16a34a; font-size: 11.5px; line-height: 1.3; white-space: nowrap; pointer-events: none; z-index: 10; }
.fj-root .chip .x { cursor: pointer; color: #6b7280; font-weight: 700; }
.fj-root .detail-block { margin-bottom: 12px; }
.fj-root .detail-block h3 { font-size: 13.5px; margin: 0 0 6px; color: #374151; }
.fj-root .detail-item { border-left: 3px solid #dbe4f3; padding: 6px 12px; margin-bottom: 6px; background: #fafbfd; border-radius: 0 8px 8px 0; }
.fj-root .detail-item .head { font-weight: 600; }
.fj-root .detail-item .sub { color: #6b7280; font-size: 12.5px; }
.fj-root .detail-item.with-note { display: flex; gap: 14px; align-items: stretch; }
.fj-root .detail-item.with-note .detail-main { flex: 1; min-width: 0; }
.fj-root .detail-note { width: 300px; flex-shrink: 0; display: flex; flex-direction: column; }
.fj-root .detail-note textarea { width: 100%; flex: 1; min-height: 62px; resize: none; font-size: 12.5px; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 7px 9px; background: #fff; color: #1f2937; font-family: inherit; line-height: 1.5; }
.fj-root .detail-note textarea:focus { border-color: #3b5fd9; border-style: solid; outline: none; }
.fj-root .detail-note .note-status { font-size: 11px; color: #16a34a; margin-left: 4px; }
.fj-root .ability-row { display: flex; align-items: flex-start; gap: 10px; border: 1px solid #e3e6ea; border-radius: 10px; padding: 10px 14px; margin-bottom: 8px; }
.fj-root .ability-row.pending { background: #fffdf7; }
.fj-root .ability-row .main { flex: 1; min-width: 0; }
.fj-root .ability-row .name { font-weight: 600; }
.fj-root .ability-row .evidence { color: #6b7280; font-size: 13px; margin-top: 2px; }
.fj-root .ability-row .actions { display: flex; gap: 6px; flex-wrap: wrap; }
.fj-root .ability-row.ghost { border-style: dashed; color: #6b7280; cursor: pointer; justify-content: center; }
.fj-root .ability-row.ghost:hover { border-color: #2563eb; color: #2563eb; }
.fj-root .ability-row .edit-inline { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.fj-root .ability-row .edit-inline input, .fj-root .ability-row .edit-inline textarea { width: 100%; min-width: 0; }
.fj-root .tag { display: inline-block; font-size: 11.5px; border-radius: 6px; padding: 1px 7px; margin-left: 6px; vertical-align: 1px; border: none; }
.fj-root .tag.pending { background: #fdf3e2; color: #b45309; }
.fj-root .tag.confirmed { background: #e8f7ee; color: #16a34a; }
.fj-root .tag.conf { background: #f0f4fe; color: #3b5fd9; }
.fj-root .tag.dup { background: #fdecec; color: #dc2626; cursor: pointer; font-family: inherit; }
.fj-root .intent-item { border: 1px solid #e3e6ea; border-radius: 10px; padding: 10px 14px; margin-bottom: 8px; }
.fj-root .intent-item.with-note { display: flex; gap: 14px; align-items: flex-start; }
.fj-root .intent-item.with-note .detail-main { flex: 1; min-width: 0; }
.fj-root .intent-item .head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fj-root .intent-item .head .btn { padding: 2px 8px; font-size: 12px; }
.fj-root .intent-acts { display: flex; flex-direction: row; gap: 6px; flex-shrink: 0; align-self: flex-start; }
.fj-root .vars-label { color: #6b7280; font-size: 12.5px; }
.fj-root .vars-line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.fj-root .intent-item .head .intent-acts { margin-left: auto; }
.fj-root .dir-chip { background: #e8f0fe; border-color: #b9cdf3; font-weight: 600; cursor: copy; }
.fj-root .intent-chip { cursor: copy; }
.fj-root .intent-chip:hover { border-color: #3b5fd9; }
.fj-root .intent-item.ghost { border-style: dashed; color: #6b7280; cursor: pointer; text-align: center; }
.fj-root .intent-item.ghost:hover { border-color: #2563eb; color: #2563eb; }
.fj-root .intent-item .edit-inline { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.fj-root .intent-item .edit-inline input { width: 100%; }
.fj-root .job-row { display: flex; align-items: center; gap: 12px; border: 1px solid #e3e6ea; border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; }
.fj-root .job-row .job-main { flex: 1; min-width: 0; }
.fj-root .job-title { font-weight: 600; font-size: 14.5px; }
.fj-root .job-company { color: #374151; }
.fj-root .job-actions { display: flex; gap: 8px; flex-shrink: 0; align-items: center; justify-content: flex-end; align-self: center; }
.fj-root .small { font-size: 13px; }
.fj-root .job-row.flash { animation: fjJobFlash 1.6s ease; }
@keyframes fjJobFlash { 0%, 100% { box-shadow: 0 0 0 0 rgba(37,99,235,0); border-color: #e3e6ea; } 15%, 60% { box-shadow: 0 0 0 3px rgba(37,99,235,.35); border-color: #2563eb; } }
.fj-root .match-card { border: 1px solid #e3e6ea; border-radius: 12px; padding: 16px 18px; margin-bottom: 14px; background: #fff; }
.fj-root .match-head { display: flex; gap: 0; align-items: flex-start; }
.fj-root .match-side { width: 118px; flex: none; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.fj-root .score { min-width: 64px; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 800; line-height: 1.1; padding: 6px; border-radius: 10px; flex-shrink: 0; }
.fj-root .score-num { display: inline-flex; align-items: flex-end; gap: 1px; line-height: 1; }
.fj-root .score .score-unit { font-size: 11.5px; font-weight: 500; padding-bottom: 2px; }
.fj-root .score-good { background: #e8f7ee; color: #16a34a; }
.fj-root .score-mid { background: #fdf3e2; color: #b45309; }
.fj-root .score-bad { background: #fdecec; color: #dc2626; }
.fj-root .match-info { flex: 1; min-width: 0; }
.fj-root .match-title { font-weight: 700; font-size: 15px; }
.fj-root .match-company { color: #374151; }
.fj-root .match-actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; align-items: center; align-self: flex-start; padding-top: 2px; }
.fj-root .match-badge { display: block; min-width: 64px; font-size: 12.5px; text-align: center; white-space: nowrap; background: #e8f7ee; color: #16a34a; border-radius: 6px; padding: 2px 4px; }
.fj-root .match-badge.no { background: #fdecec; color: #dc2626; }
.fj-root .match-dims { margin-top: 10px; }
.fj-root .dim-row { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
.fj-root .dim-name { width: 110px; font-size: 13px; color: #374151; flex-shrink: 0; }
.fj-root .dim-bar { flex: 1; height: 8px; background: #eef1f5; border-radius: 4px; overflow: hidden; }
.fj-root .dim-fill { display: block; height: 100%; border-radius: 4px; }
.fj-root .dim-score { width: 30px; font-size: 13px; text-align: right; font-weight: 600; }
.fj-root .dim-desc { font-size: 12.5px; color: #6b7280; margin: 0 0 8px 118px; }
.fj-root .match-reasons, .fj-root .match-misses { margin-top: 10px; }
.fj-root .match-reasons h4, .fj-root .match-misses h4 { margin: 0 0 4px; font-size: 13px; }
.fj-root .match-reasons ul, .fj-root .match-misses ul { margin: 0; padding-left: 20px; }
.fj-root .match-reasons li { margin-bottom: 3px; }
.fj-root .match-misses li { color: #b45309; margin-bottom: 3px; }
.fj-root .match-suggestion { margin-top: 10px; background: #f0f4fe; border: 1px solid #dbe4f3; color: #3b5fd9; border-radius: 8px; padding: 8px 12px; font-size: 13px; }
.fj-root .match-desc { margin-top: 12px; }
.fj-root .match-desc h4 { margin: 0 0 4px; font-size: 13px; }
.fj-root .desc-body { white-space: pre-wrap; word-break: break-word; max-height: 96px; overflow: hidden; position: relative; cursor: pointer; font-size: 13px; color: #374151; border: 1px solid #eef1f5; border-radius: 8px; padding: 8px 12px; background: #fafbfd; margin-bottom: 6px; }
.fj-root .desc-body.expanded { max-height: 320px; overflow-y: auto; }
.fj-root .desc-body:not(.expanded)::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 32px; background: linear-gradient(transparent, #fafbfd); }
.fj-root .match-greeting { margin-top: 12px; border-top: 1px dashed #e3e6ea; padding-top: 10px; font-size: 13.5px; }
.fj-root .greet-head { display: flex; justify-content: space-between; align-items: center; padding-right: 0; }
.fj-root .greet-head h4 { margin: 0; font-size: 13px; }
.fj-root .greet-block { display: flex; gap: 10px; align-items: center; margin: 8px 0; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; }
.fj-root .greet-text { flex: 1; white-space: pre-wrap; line-height: 1.6; }
.fj-root .copy-btn { flex: none; display: inline-flex; align-items: center; justify-content: center; line-height: 1.35; padding: 3px 9px; border: 1px solid #e3e6ea; border-radius: 6px; background: #fff; color: #1f2329; font-size: 12px; cursor: pointer; font-family: inherit; }
.fj-root .copy-btn:hover { background: #f2f4f7; }
.fj-root .miss-dim { margin: 12px 0 4px; font-size: 13px; font-weight: 600; }
.fj-root .miss-list { margin: 6px 0; padding-left: 20px; }
.fj-root .miss-item { padding: 3px 0; margin-bottom: 4px; }
.fj-root .miss-details { margin: 4px 0 2px; padding-left: 18px; }
.fj-root .miss-details li { color: #6b7280; font-size: 12.5px; line-height: 1.55; margin-bottom: 2px; }
.fj-root .adjust-summary { margin: 6px 0; padding-left: 20px; }
.fj-root .adjust-examples { margin: 6px 0; padding-left: 20px; }
.fj-root .adjust-examples li { margin-bottom: 8px; }
.fj-root .adjust-meta { margin: 6px 0 10px; }
.fj-root .adjust-body-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 14px 0 6px; }
.fj-root .adjust-body-head h4 { margin: 0; }
.fj-root .adjust-content { margin: 0 0 10px; padding: 14px 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 13.5px; line-height: 1.7; max-height: 520px; overflow: auto; }
.fj-root .batch-progress { width: 160px; height: 6px; background: #e8edf5; border-radius: 3px; overflow: hidden; flex: none; }
.fj-root .save-grid { display: grid; grid-template-columns: 1fr 280px; gap: 16px; align-items: stretch; }
.fj-root .save-left { display: flex; flex-direction: column; }
.fj-root .save-left textarea { width: 100%; min-width: 0; box-sizing: border-box; flex: 1; height: 100%; min-height: 200px; }
.fj-root .save-right { display: flex; flex-direction: column; justify-content: space-between; gap: 8px; }
.fj-root .save-right label { min-width: 0; margin: 0; }
.fj-root .save-right input { min-width: 0; width: 100%; box-sizing: border-box; }
.fj-root .doc-box { margin: 0 0 10px; padding: 14px 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; white-space: pre-wrap; word-break: break-word; font-size: 13.5px; line-height: 1.7; max-height: 520px; overflow: auto; }
.fj-root .doc-box h4 { margin: 10px 0 4px; font-size: 13.5px; }
.fj-root .doc-box h4:first-child { margin-top: 0; }
.fj-root main::-webkit-scrollbar, .fj-root .doc-box::-webkit-scrollbar, .fj-root .desc-body.expanded::-webkit-scrollbar { width: 16px; }
.fj-root main::-webkit-scrollbar-thumb, .fj-root .doc-box::-webkit-scrollbar-thumb, .fj-root .desc-body.expanded::-webkit-scrollbar-thumb { background: #c3ccd8; border-radius: 8px; border: 4px solid transparent; background-clip: content-box; }
.fj-root main::-webkit-scrollbar-thumb:hover, .fj-root .doc-box::-webkit-scrollbar-thumb:hover { background: #9aa7b8; background-clip: content-box; }
.fj-root main::-webkit-scrollbar-track, .fj-root .doc-box::-webkit-scrollbar-track { background: transparent; }
.fj-root .batch-progress i { display: block; height: 100%; width: 0; background: #2563eb; transition: width .3s ease; }
.fj-root .batch-progress[hidden] { display: none; }
.fj-root .match-filter-bar { border: 1px solid #dbe4f3; background: #f0f4fe; color: #3b5fd9; border-radius: 8px; padding: 6px 12px; font-size: 13px; }
@media (max-width: 1100px) { .fj-root .detail-item.with-note { flex-direction: column; } .fj-root .detail-note { width: 100%; } }
@media (max-width: 900px) { .fj-root .basic-row { grid-template-columns: 1fr; } .fj-root .intent-item.with-note { flex-direction: column; } }
/* ---------- 面板容器适配（DSH 侧栏内更窄）：窄时自动换行、按钮不换行 ---------- */
.fj-root .btn { white-space: nowrap; line-height: 1.4; }
.fj-root input[type="text"], .fj-root input[type="number"], .fj-root input[type="url"], .fj-root textarea, .fj-root select { line-height: 1.4; }
.fj-root .card-head .btn { flex: none; }
.fj-root .job-row { flex-wrap: wrap; }
.fj-root .job-actions { margin-left: auto; }
.fj-root .match-head { flex-wrap: wrap; }
@media (max-width: 820px) {
  .fj-root .save-grid { grid-template-columns: 1fr; }
  .fj-root .match-head { flex-direction: column; align-items: stretch; }
  .fj-root .match-side { width: auto; flex-direction: row; align-items: center; }
  .fj-root .match-actions { align-self: flex-end; }
  .fj-root .detail-item.with-note { flex-direction: column; }
  .fj-root .detail-note { width: 100%; }
}

`

    function ensureCss() {
      if (typeof document === 'undefined' || document.getElementById('find-job-css')) return
      const el = document.createElement('style')
      el.id = 'find-job-css'
      el.textContent = CSS
      document.head.appendChild(el)
    }

    const PLATFORM_LABEL = { boss: 'BOSS直聘', liepin: '猎聘', manual: '手动', '': '手动' }
    const platformLabel = (p) => PLATFORM_LABEL[p] || p || '手动'

    function fmtTime(v) {
      if (!v) return ''
      const t = Date.parse(String(v))
      if (isNaN(t)) return String(v)
      const d = new Date(t)
      const p = (n) => (n < 10 ? '0' + n : '' + n)
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    }

    function scoreClass(score) {
      if (score >= 70) return 'score-good'
      if (score >= 50) return 'score-mid'
      return 'score-bad'
    }

    async function post(route, body) {
      const res = await fetch(new URL(route, document.baseURI), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
      })
      const text = await res.text()
      let d = null
      try { d = text ? JSON.parse(text) : null } catch { throw new Error('服务返回非 JSON：' + String(text).slice(0, 120)) }
      if (!d) throw new Error('空响应（HTTP ' + res.status + '）')
      if (!d.ok) throw new Error(d.message || ('HTTP ' + res.status))
      return d
    }

    async function getStatus() {
      const res = await fetch(new URL(ROUTE_STATUS, document.baseURI))
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    }

    /* ---------------- 视图 ---------------- */

    function GreetingBlock({ text }) {
      return h('div', { className: 'greet-block' },
        h('div', { className: 'greet-text' }, text),
        h('button', { className: 'copy-btn', type: 'button', onClick: () => { if (navigator.clipboard) navigator.clipboard.writeText(text) } }, '复制'))
    }

    function ProfileView({ data, act, notice }) {
      const st = data.state
      const p = st.profile || {}
      const notes = st.notes || { work: {}, project: {} }
      const abilities = st.abilities || []
      const intents = st.intents || []
      const explicit = abilities.filter(a => a['类别'] !== 'inferred')
      const inferred = abilities.filter(a => a['类别'] === 'inferred')
      const [basic, setBasic] = useState({ name: p['姓名'] || '', title: p['当前职位'] || '', years: p['总工作年限'] || '' })
      const [filters, setFilters] = useState({ city: st.settings.city || '', salary: st.settings.salary_min || '' })
      const [resumeText, setResumeText] = useState('')
      const [parseMsg, setParseMsg] = useState('')
      const [pasteOpen, setPasteOpen] = useState(false)
      const [editAb, setEditAb] = useState(null)
      const [addAb, setAddAb] = useState(null)
      const [editIntent, setEditIntent] = useState(null)
      const [addIntent, setAddIntent] = useState(null)
      const [intentMsg, setIntentMsg] = useState('')

      useEffect(() => {
        setBasic({ name: p['姓名'] || '', title: p['当前职位'] || '', years: p['总工作年限'] || '' })
        setFilters({ city: st.settings.city || '', salary: st.settings.salary_min || '' })
      }, [st])

      const [saved, setSaved] = useState({})
      const markSaved = (k) => {
        setSaved((s) => ({ ...s, [k]: true }))
        setTimeout(() => setSaved((s) => ({ ...s, [k]: false })), 500)
      }
      const saveBasicField = (k) => { act('basic', { name: basic.name, current_title: basic.title, years: basic.years }).then(() => markSaved('basic-' + k)).catch(() => {}) }
      const saveFiltersField = (k) => { act('settings', { city: filters.city, salary_min: filters.salary }).then(() => markSaved('filter-' + k)).catch(() => {}) }

      const onFile = async (e) => {
        const file = e.target.files && e.target.files[0]
        e.target.value = ''
        if (!file) return
        const ok = window.confirm('将用「' + file.name + '」解析履历：\n· 会覆盖当前能力画像\n· 已确认的推断能力会重置为「待确认」\n\n继续？')
        if (!ok) return
        const buf = await new Promise((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(new Uint8Array(r.result))
          r.onerror = () => reject(new Error('读取文件失败'))
          r.readAsArrayBuffer(file)
        })
        let bin = ''
        for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
        setParseMsg('解析中…')
        try { await act('parse_resume', { file_base64: btoa(bin), filename: file.name }) } catch (err) { setParseMsg(err.message || err) }
      }

      const parseText = async () => {
        if (!resumeText.trim()) return
        setParseMsg('解析中…')
        try { await act('parse_resume', { text: resumeText }); setResumeText('') } catch (err) { setParseMsg(err.message || err) }
      }

      const copyChip = async (text, el) => {
        try {
          await navigator.clipboard.writeText(text)
          el.classList.remove('copied'); void el.offsetWidth; el.classList.add('copied')
          clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('copied'), 900)
        } catch {}
      }

      return h('div', null,
        h(ResumeCard, { st, parseMsg, parse: data.parse, onFile, pasteOpen, setPasteOpen, resumeText, setResumeText, onParseText: parseText }),
        h(FiltersCard, { filters, setFilters, saveField: saveFiltersField, saved }),
        h(BasicCard, { basic, setBasic, saveField: saveBasicField, saved }),
        h(DetailCard, { p, notes, act, saved, markSaved }),
        h(AbilitiesCard, { explicit, inferred, editAb, setEditAb, addAb, setAddAb, act }),
        h(IntentsCard, { intents, editIntent, setEditIntent, addIntent, setAddIntent, act, copyChip, intentMsg, setIntentMsg }),
      )
    }

    function ResumeCard({ st, parseMsg, parse, onFile, pasteOpen, setPasteOpen, resumeText, setResumeText, onParseText }) {
      const resume = st.resume
      const meta = resume
        ? '当前履历：' + (resume.source_name || '') + '（' + resume.chars + ' 字，更新于 ' + fmtTime(resume.updated_at) + '）'
        : '尚未上传履历。上传后自动解析能力与意向职位。'
      const parseState = (parse && parse.running) ? '解析中…'
        : (parse && parse.ok === false) ? '上次解析失败：' + (parse.message || '未知原因')
          : (parse && parse.ok) ? (parse.message || '解析完成')
            : ''
      const busyParse = !!(parse && parse.running)
      return h('div', { className: 'card' },
        h('div', { className: 'card-head' },
          h('h2', null, '履历'),
          h('div', { className: 'muted resume-meta' }, meta),
          busyParse
            ? h('button', { className: 'btn primary upload-resume', disabled: true }, '解析中…')
            : h('label', { className: 'btn primary upload-resume' }, '上传并解析履历',
              h('input', { type: 'file', accept: '.md,.txt,.docx,.pdf', hidden: true, onChange: onFile }))),
        (parseState || parseMsg)
          ? h('p', { className: (parse && parse.ok === false) ? 'status status-err' : 'muted', style: { margin: '0 0 8px' } }, parseState || parseMsg)
          : null,
        h('p', { className: 'hint' }, '支持 md / txt / docx / pdf。',
          h('a', { className: 'btn small', style: { marginLeft: 8 }, onClick: () => setPasteOpen(!pasteOpen) }, pasteOpen ? '收起粘贴框' : '无法上传？点击粘贴')),
        pasteOpen ? h('div', null,
          h('textarea', { style: { width: '100%', minHeight: 70 }, value: resumeText, placeholder: '粘贴履历全文', onChange: (e) => setResumeText(e.target.value) }),
          h('div', { className: 'row right' },
            h('button', { className: 'btn primary', disabled: !resumeText.trim() || busyParse, onClick: onParseText }, '解析粘贴内容'))) : null)
    }

    function FiltersCard({ filters, setFilters, saveField, saved }) {
      return h('div', { className: 'card' },
        h('h2', null, '硬条件'),
        h('div', { className: 'row basic-row' },
          h('label', { className: 'basic-field', style: { gridColumn: 'span 2' } },
            h('span', { className: 'basic-label' }, '期望城市'),
            h('input', { className: 'basic-input', type: 'text', value: filters.city, placeholder: '如：深圳, 杭州（多个用逗号分隔）', onChange: (e) => setFilters({ ...filters, city: e.target.value }), onBlur: () => saveField('city') }),
            saved['filter-city'] ? h('span', { className: 'save-tip' }, '已保存') : null),
          h('label', { className: 'basic-field' },
            h('span', { className: 'basic-label' }, '最低月薪（K）'),
            h('input', { className: 'basic-input', type: 'number', value: filters.salary, placeholder: '如：20', onChange: (e) => setFilters({ ...filters, salary: e.target.value }), onBlur: () => saveField('salary') }),
            saved['filter-salary'] ? h('span', { className: 'save-tip' }, '已保存') : null)))
    }

    function BasicCard({ basic, setBasic, saveField, saved }) {
      return h('div', { className: 'card' },
        h('h2', null, '基本信息'),
        h('div', { className: 'row basic-row' },
          h('label', { className: 'basic-field' },
            h('span', { className: 'basic-label' }, '姓名'),
            h('input', { className: 'basic-input', type: 'text', value: basic.name, placeholder: '姓名', onChange: (e) => setBasic({ ...basic, name: e.target.value }), onBlur: () => saveField('name') }),
            saved['basic-name'] ? h('span', { className: 'save-tip' }, '已保存') : null),
          h('label', { className: 'basic-field' },
            h('span', { className: 'basic-label' }, '当前职位'),
            h('input', { className: 'basic-input', type: 'text', value: basic.title, placeholder: '当前职位', onChange: (e) => setBasic({ ...basic, title: e.target.value }), onBlur: () => saveField('title') }),
            saved['basic-title'] ? h('span', { className: 'save-tip' }, '已保存') : null),
          h('label', { className: 'basic-field' },
            h('span', { className: 'basic-label' }, '工作年限'),
            h('input', { className: 'basic-input', type: 'text', value: basic.years, placeholder: '总工作年限', onChange: (e) => setBasic({ ...basic, years: e.target.value }), onBlur: () => saveField('years') }),
            saved['basic-years'] ? h('span', { className: 'save-tip' }, '已保存') : null)))
    }

    function DetailCard({ p, notes, act, saved, markSaved }) {
      const work = (p['工作经历'] || []).map((e, i) => [
        h('div', { key: 'w' + i, className: 'detail-item with-note' },
          h('div', { className: 'detail-main' },
            h('div', { className: 'head' }, (e['公司'] || '') + ' · ' + (e['职位'] || ''),
              h('span', { className: 'sub' }, ' ' + (e['时间'] || '') + ' · ' + (e['行业'] || ''))),
            h('div', { className: 'sub' }, e['职责与成果'] || '')),
          h('div', { className: 'detail-note' },
            h('textarea', { defaultValue: (notes.work || {})[e['公司'] || ''] || '', placeholder: '补充背景/细节，将整合进简历调整', onBlur: (ev) => { act('note', { kind: 'work', ref: e['公司'] || '', note: ev.target.value }).then(() => markSaved('note-work-' + (e['公司'] || ''))).catch(() => {}) } }))),
        saved['note-work-' + (e['公司'] || '')] ? h('div', { key: 'w' + i + 'tip', className: 'save-tip', style: { margin: '0 0 8px' } }, '已保存') : null,
      ].filter(Boolean))
      const projects = (p['项目'] || []).map((e, i) => [
        h('div', { key: 'p' + i, className: 'detail-item with-note' },
          h('div', { className: 'detail-main' },
            h('div', { className: 'head' }, e['名称'] || '', h('span', { className: 'sub' }, ' ' + (e['角色'] || ''))),
            h('div', { className: 'sub' }, e['内容'] || '')),
          h('div', { className: 'detail-note' },
            h('textarea', { defaultValue: (notes.project || {})[e['名称'] || ''] || '', placeholder: '补充背景/细节，将整合进简历调整', onBlur: (ev) => { act('note', { kind: 'project', ref: e['名称'] || '', note: ev.target.value }).then(() => markSaved('note-project-' + (e['名称'] || ''))).catch(() => {}) } }))),
        saved['note-project-' + (e['名称'] || '')] ? h('div', { key: 'p' + i + 'tip', className: 'save-tip', style: { margin: '0 0 8px' } }, '已保存') : null,
      ].filter(Boolean))
      const edu = (p['教育'] || []).map((e, i) => h('div', { key: 'e' + i, className: 'detail-item' },
        h('div', { className: 'head' }, (e['学校'] || '') + ' · ' + (e['专业'] || '') + ' · ' + (e['学历'] || ''),
          h('span', { className: 'sub' }, ' ' + (e['时间'] || '')))))
      const empty = !work.length && !projects.length && !edu.length
      return h('div', { className: 'card' },
        h('h2', null, '工作经历 / 项目 / 教育'),
                work.length ? h('div', { className: 'detail-block' }, h('h3', null, '工作经历'), work) : null,
        projects.length ? h('div', { className: 'detail-block' }, h('h3', null, '项目'), projects) : null,
        edu.length ? h('div', { className: 'detail-block' }, h('h3', null, '教育'), edu) : null,
        empty ? h('p', { className: 'muted' }, '尚未解析。上传履历后自动生成。') : null)
    }

    function AbilitiesCard({ explicit, inferred, editAb, setEditAb, addAb, setAddAb, act }) {
      const explicitRows = explicit.map((a) => abilityRow(a, editAb, setEditAb, act))
      const inferredRows = inferred.map((a) => abilityRow(a, editAb, setEditAb, act))
      const addForm = () => h('div', { className: 'ability-row' },
        h('div', { className: 'edit-inline' },
          h('input', { type: 'text', placeholder: '能力名称，如：SQL 数据分析', value: addAb.name, onChange: (e) => setAddAb({ ...addAb, name: e.target.value }) }),
          h('textarea', { rows: 2, placeholder: '证据（可选）', value: addAb.evidence, onChange: (e) => setAddAb({ ...addAb, evidence: e.target.value }) }),
          h('div', { className: 'row' },
            h('button', { className: 'btn small primary', onClick: () => { if (!addAb.name.trim()) return setAddAb({ ...addAb, err: '请填能力名称' }); act('ability_add', { name: addAb.name, evidence: addAb.evidence }).then(() => setAddAb(null)).catch((err) => setAddAb({ ...addAb, err: err.message })) } }, '确认新增'),
            h('button', { className: 'btn small', onClick: () => setAddAb(null) }, '取消'),
            h('span', { className: 'save-hint err' }, addAb.err || ''))))
      return h('div', { className: 'card' },
        h('h2', null, '能力标签'),
                explicit.length ? h('h3', { style: { fontSize: '13.5px', color: '#374151' } }, '显性能力（' + explicit.length + '）') : null,
        explicitRows,
        inferred.length ? h('h3', { style: { fontSize: '13.5px', color: '#374151' } }, '推断能力（' + inferred.length + '，确认后参与匹配）') : h('p', { className: 'muted' }, '尚未解析。上传履历后自动生成。'),
        inferredRows,
        addAb ? addForm() : h('div', { className: 'ability-row ghost', onClick: () => setAddAb({ name: '', evidence: '' }) }, '＋ 新增能力'))
    }

    function IntentsCard({ intents, editIntent, setEditIntent, addIntent, setAddIntent, act, copyChip, intentMsg, setIntentMsg }) {
      const [regenIdx, setRegenIdx] = useState(-1)
      const rows = intents.map((it, i) => {
        if (editIntent && editIntent.idx === i) {
          return h('div', { key: i, className: 'intent-item' },
            h('div', { className: 'edit-inline' },
              h('input', { type: 'text', value: editIntent.dir, onChange: (e) => setEditIntent({ ...editIntent, dir: e.target.value }), placeholder: '方向' }),
              h('input', { type: 'text', value: editIntent.vars, onChange: (e) => setEditIntent({ ...editIntent, vars: e.target.value }), placeholder: '职位名变体（用 / 分隔，可选）' }),
              h('div', { className: 'row' },
                h('button', { className: 'btn small primary', onClick: () => saveIntentEdit(i, intents, editIntent, act, setEditIntent, setIntentMsg) }, '保存'),
                h('button', { className: 'btn small', onClick: () => setEditIntent(null) }, '取消'),
                h('span', { className: 'save-hint err' }, intentMsg || ''))))
        }
        const variants = (it['变体'] || []).length
          ? (it['变体'] || []).map((v, k) => h('span', { key: k, className: 'chip intent-chip', onClick: (e) => copyChip(v, e.currentTarget) }, v))
          : h('span', { className: 'muted' }, '（无）')
        return h('div', { key: i, className: 'intent-item with-note' },
          h('div', { className: 'detail-main' },
            h('div', { className: 'head' },
              h('span', { className: 'chip dir-chip', onClick: (e) => copyChip(it['方向'] || '', e.currentTarget) }, it['方向'] || ''),
              h('span', { className: 'vars-label' }, '职位名变体：'),
              variants)),
          h('div', { className: 'intent-acts' },
            h('button', { className: 'btn small', disabled: regenIdx === i, onClick: async () => { setRegenIdx(i); try { await act('regen_intent', { direction: it['方向'] }) } catch (err) { setIntentMsg(err.message) } finally { setRegenIdx(-1) } } }, regenIdx === i ? '生成中…' : '重新生成'),
            h('button', { className: 'btn small', onClick: () => setEditIntent({ idx: i, dir: it['方向'] || '', vars: (it['变体'] || []).join(' / ') }) }, '编辑'),
            h('button', { className: 'btn small danger', onClick: () => { if (!window.confirm('删除方向「' + (it['方向'] || '') + '」？')) return; act('intents', { intents: intents.filter((_, k) => k !== i) }).catch((err) => setIntentMsg(err.message)) } }, '删除')))
      })
      const addForm = () => h('div', { className: 'intent-item' },
        h('div', { className: 'edit-inline' },
          h('input', { type: 'text', placeholder: '职位名称，如：数据产品', value: addIntent.dir, onChange: (e) => setAddIntent({ ...addIntent, dir: e.target.value }) }),
          h('input', { type: 'text', placeholder: '职位名变体（用 / 分隔，可选）', value: addIntent.vars, onChange: (e) => setAddIntent({ ...addIntent, vars: e.target.value }) }),
          h('div', { className: 'row' },
            h('button', { className: 'btn small primary', onClick: () => { if (!addIntent.dir.trim()) return; const next = intents.concat([{ 方向: addIntent.dir.trim(), 变体: addIntent.vars.split(/[\/／,，]/).map((v) => v.trim()).filter(Boolean) }]); act('intents', { intents: next }).then(() => setAddIntent(null)).catch((err) => setIntentMsg(err.message)) } }, '确认新增'),
            h('button', { className: 'btn small', onClick: () => setAddIntent(null) }, '取消'),
            h('span', { className: 'save-hint err' }, intentMsg || ''))))
      return h('div', { className: 'card' },
        h('h2', null, '意向职位'),
                intents.length ? rows : h('p', { className: 'muted' }, '尚未解析。上传履历后自动生成。'),
        addIntent ? addForm() : h('div', { className: 'intent-item ghost', onClick: () => setAddIntent({ dir: '', vars: '' }) }, '＋ 新增方向'))
    }

    function saveIntentEdit(i, intents, editIntent, act, setEditIntent, setIntentMsg) {
      if (!editIntent.dir.trim()) return
      const next = intents.map((x, k) => k === i ? { 方向: editIntent.dir.trim(), 变体: editIntent.vars.split(/[\/／,，]/).map((v) => v.trim()).filter(Boolean) } : x)
      act('intents', { intents: next }).then(() => setEditIntent(null)).catch((err) => setIntentMsg(err.message))
    }

    function abilityRow(a, editAb, setEditAb, act) {
      const confirmed = a['状态'] === 'confirmed'
      if (editAb && editAb.id === a.id) {
        return h('div', { key: a.id, className: 'ability-row' },
          h('div', { className: 'edit-inline' },
            h('input', { type: 'text', value: editAb.name, onChange: (e) => setEditAb({ ...editAb, name: e.target.value }) }),
            h('textarea', { rows: 2, value: editAb.evidence, onChange: (e) => setEditAb({ ...editAb, evidence: e.target.value }) }),
            h('div', { className: 'row' },
              h('button', { className: 'btn small primary', onClick: () => { if (!editAb.name.trim()) return; act('ability_edit', { id: a.id, name: editAb.name, evidence: editAb.evidence }).then(() => setEditAb(null)).catch(() => {}) } }, '保存'),
              h('button', { className: 'btn small', onClick: () => setEditAb(null) }, '取消'))))
      }
      return h('div', { key: a.id, className: 'ability-row' + (confirmed ? '' : ' pending') },
        h('div', { className: 'main' },
          h('div', { className: 'name' }, a['能力'],
            h('span', { className: 'tag ' + (confirmed ? 'confirmed' : 'pending') }, confirmed ? '已确认' : '待确认'),
            a['置信度'] ? h('span', { className: 'tag conf' }, '置信度 ' + a['置信度']) : null),
          h('div', { className: 'evidence' }, h('span', { style: { color: '#6b7280' } }, '证据：'), a['证据'] || h('span', { className: 'muted' }, '（无，点「编辑」补充）'))),
        h('div', { className: 'actions' },
          !confirmed ? h('button', { className: 'btn small ok', onClick: () => { act('ability_status', { id: a.id, status: 'confirmed' }).catch(() => {}) } }, '确认') : null,
          h('button', { className: 'btn small', onClick: () => setEditAb({ id: a.id, name: a['能力'] || '', evidence: a['证据'] || '' }) }, '编辑'),
          h('button', { className: 'btn small danger', onClick: () => { if (!window.confirm('删除这条能力？删除后不再参与匹配。')) return; act('ability_delete', { id: a.id }).catch(() => {}) } }, '删除')))
    }

    function JobsView({ data, act, notice, busyAction, jobPlatform, setJobPlatform, status, onMatched }) {
      const jobs = data.jobs || []
      const [jd, setJd] = useState('')
      const [url, setUrl] = useState('')
      const [title, setTitle] = useState('')
      const [company, setCompany] = useState('')
      const [saveMsg, setSaveMsg] = useState('')
      const [saveKind, setSaveKind] = useState('')
      const [matchingId, setMatchingId] = useState(-1)
      const [localMsg, setLocalMsg] = useState('')
      const allJobsRef = useRef(jobs)
      allJobsRef.current = jobs
      const list = jobPlatform ? jobs.filter(j => (j['平台'] || 'manual') === jobPlatform) : jobs
      const counts = {}
      for (const j of jobs) { const k = j['平台'] || 'manual'; counts[k] = (counts[k] || 0) + 1 }
      const tabs = [['', '全部'], ['boss', 'BOSS直聘'], ['liepin', '猎聘'], ['manual', '手动']]
      const batch = status && status.batch ? status.batch : null
      useEffect(() => { if (batch && batch.running) setLocalMsg('') }, [batch])
      const unmatched = jobs.filter(j => j['分数'] == null).length
      const dupJump = (j) => {
        const key = j['重复键']
        if (!key) return
        const enc = encodeURIComponent(key)
        const rows = Array.from(document.querySelectorAll('.fj-root .job-row[data-dup-key="' + enc + '"]'))
        const idx = rows.findIndex((r) => r.getAttribute('data-id') === String(j.id))
        const next = rows[(idx + 1) % rows.length]
        if (next) {
          next.scrollIntoView({ behavior: 'smooth', block: 'center' })
          next.classList.remove('flash'); void next.offsetWidth; next.classList.add('flash')
          setTimeout(() => next.classList.remove('flash'), 1600)
        }
      }
      return h('div', null,
        h('div', { className: 'card' },
          h('h2', null, '存入职位'),
          h('p', { className: 'hint' }, '使用浏览器插件一键存入，或在此处手动存入。'),
          h('p', { className: 'hint' }, '如何使用浏览器插件：Chrome 浏览器 → 扩展程序 → 打开开发者模式 → 加载（', h('button', { className: 'btn small', onClick: () => act('open_ext_dir').catch(() => {}) }, 'find-job 文件夹'), '），在职位详情页即可一键存入。'),
          h('div', { className: 'form wide save-grid' },
            h('label', { className: 'save-left' }, h('textarea', { rows: 6, value: jd, placeholder: '职位原文（职位描述全文）', onChange: (e) => setJd(e.target.value) })),
            h('div', { className: 'save-right' },
              h('label', null, '公司名称（可选）', h('input', { type: 'text', value: company, placeholder: '如：某科技公司', onChange: (e) => setCompany(e.target.value) })),
              h('label', null, '职位名称（可选）', h('input', { type: 'text', value: title, placeholder: '如：运营', onChange: (e) => setTitle(e.target.value) })),
              h('label', null, '职位链接（可选）', h('input', { type: 'text', value: url, placeholder: 'https://www.zhipin.com/job_detail/…', onChange: (e) => setUrl(e.target.value) })))),
          h('div', { className: 'row right job-align', style: { marginTop: 14 } },
            h('span', { className: 'muted' }, saveMsg),
            h('button', { className: 'btn primary', disabled: busyAction === 'save_job', onClick: async () => { if (!jd.trim()) { setSaveMsg('职位原文为空'); setSaveKind('err'); return } setSaveMsg('保存中…'); setSaveKind(''); try { const r = await act('save_job', { text: jd, url, title, company }); setSaveMsg(r && r.duplicate ? '已存在相同职位' : '已存入职位库'); setSaveKind('ok'); setJd(''); setUrl(''); setTitle(''); setCompany('') } catch (err) { setSaveMsg(err.message); setSaveKind('err') } } }, '存入职位库'))),
        h('div', { className: 'card' },
          h('div', { className: 'card-head' },
            h('h2', null, '职位库'),
            h('div', { className: 'job-filter' },
              tabs.map(([k, label]) => h('button', { key: k, className: 'pf-btn' + (jobPlatform === k ? ' active' : ''), onClick: () => setJobPlatform(k) }, label + '（' + (k ? (counts[k] || 0) : jobs.length) + '）'))),
            h('div', { className: 'row batch-row' },
              h('span', { className: 'muted' }, (matchingId >= 0) ? ('正在打分：' + (((jobs.find((x) => x.id === matchingId) || {})['岗位']) || '职位') + '（约 20~40 秒…）') : (batch && batch.running) ? ('打分中 ' + ((batch.done || 0)) + '/' + ((batch.total || 0)) + (batch.failed ? ('（失败 ' + batch.failed + '）') : '')) : (localMsg || ('未打分 ' + unmatched + ' 个'))),
              h('button', { className: 'btn primary batch-btn', disabled: !!(batch && batch.running) || unmatched === 0 || matchingId >= 0, onClick: async () => { setLocalMsg('批量打分启动中…'); try { await act('batch_match', {}) } catch (err) { setLocalMsg(String((err && err.message) || err)) } } }, batch && batch.running ? '打分中' : '批量打分'))),
          list.length === 0 ? h('p', { className: 'muted' }, jobs.length ? '当前筛选下没有职位。' : '尚无职位，请先用浏览器插件一键存入，或在上方手动存入。') : list.map((j) => h('div', { key: j.id, className: 'job-row', 'data-id': String(j.id), 'data-dup-key': j['重复数'] > 1 ? encodeURIComponent(j['重复键']) : undefined },
            h('div', { className: 'job-main' },
              h('div', { className: 'job-title' }, j['岗位'] || '（无职位名）',
                h('span', { className: 'tag conf' }, platformLabel(j['平台'])),
                j['重复数'] > 1 ? h('button', { className: 'tag dup', onClick: () => dupJump(j) }, '疑似重复 ×' + j['重复数']) : null),
              h('div', { className: 'job-company' }, j['公司'] ? j['公司'] : h('span', { className: 'muted' }, '（公司名未知）')),
              h('div', { className: 'muted small' }, [j['城市'], j['薪资'], j['存入时间'] ? ('存入 ' + fmtTime(j['存入时间'])) : ''].filter(Boolean).join(' · '))),
            h('div', { className: 'job-actions' },
              j['链接'] ? h('a', { className: 'btn small', href: j['链接'], target: '_blank', rel: 'noopener' }, '职位链接') : null,
              h('button', { className: 'btn small' + (j['分数'] == null ? ' primary' : ''), disabled: j['分数'] != null || matchingId === j.id || !!(batch && batch.running), onClick: async () => { setMatchingId(j.id); try { await act('match', { job_id: j.id }); if (onMatched) onMatched(j.id) } catch {} finally { setMatchingId(-1) } } }, matchingId === j.id ? '打分中…' : (j['分数'] != null ? '已打分' : '匹配打分')),
              h('button', { className: 'btn small danger', onClick: async () => { if (!window.confirm('删除该职位？它的匹配结果与打招呼语会一并删除。')) return; try { await act('delete_job', { job_id: j.id }) } catch {} } }, '删除')))),
        ),
      )
    }

    function MatchesView({ data, act, notice, busyAction, matchPlatform, setMatchPlatform, jobFilter, clearJobFilter, focusJob }) {
      const matches = data.matches || []
      const counts = {}
      for (const m of matches) { const k = m.platform || 'manual'; counts[k] = (counts[k] || 0) + 1 }
      const tabs = [['', '全部'], ['boss', 'BOSS直聘'], ['liepin', '猎聘'], ['manual', '手动']]
      let list = matchPlatform ? matches.filter(m => (m.platform || 'manual') === matchPlatform) : matches
      if (jobFilter && jobFilter.length) list = list.filter(m => jobFilter.includes(m.job_id))
      useEffect(() => {
        if (!focusJob) return
        const el = document.querySelector('.match-card[data-job-id="' + focusJob + '"]')
        if (el) setTimeout(() => el.scrollIntoView({ block: 'center' }), 60)
      }, [focusJob, list.length])
      return h('div', null,
        h('div', { className: 'card' },
          h('div', { className: 'card-head' },
            h('h2', null, '匹配结果'),
            h('div', { className: 'job-filter' },
              tabs.map(([k, label]) => h('button', { key: k, className: 'pf-btn' + (matchPlatform === k ? ' active' : ''), onClick: () => setMatchPlatform(k) }, label + '（' + (k ? (counts[k] || 0) : matches.length) + '）')))),
          h('p', { className: 'hint' }, '60分以上纳入参考集，可通过感兴趣、不感兴趣调整。求职建议将基于参考集处理。'),
          (jobFilter && jobFilter.length)
            ? h('div', { className: 'match-filter-bar', style: { marginBottom: 10 } },
              '已按「能力缺口」筛选出 ' + list.length + ' 个职位 ',
              h('button', { className: 'btn small', style: { marginLeft: 8 }, onClick: clearJobFilter }, '清除'))
            : null,
          list.length === 0 ? h('p', { className: 'muted' }, '尚无结果，职位库打分后自动生成。') : list.map((m) => {
            const reason = m.reason || {}
            const dims = (m.dims || []).map((d, i) => h('div', { key: i },
              h('div', { className: 'dim-row' },
                h('span', { className: 'dim-name' }, d['维度'] || ''),
                h('span', { className: 'dim-bar' }, h('span', { className: 'dim-fill ' + scoreClass(d['分']), style: { width: Math.max(2, Math.min(100, d['分'] || 0)) + '%' } })),
                h('span', { className: 'dim-score' }, d['分'])),
              h('div', { className: 'dim-desc' }, d['说明'] || '')))
            return h('div', { key: m.job_id, className: 'match-card', 'data-job-id': String(m.job_id) },
              h('div', { className: 'match-head' },
                h('div', { className: 'match-side' },
                  h('div', { className: 'score ' + scoreClass(m.score) }, h('span', { className: 'score-num' }, m.score, h('span', { className: 'score-unit' }, '分'))),
                  h('div', { className: 'match-badge' + (m.score >= 60 ? '' : ' no') }, m.score >= 60 ? '建议投递' : '不建议投递')),
                h('div', { className: 'match-info' },
                  h('div', { className: 'match-title' }, m.title || '', h('span', { className: 'tag conf' }, platformLabel(m.platform))),
                  h('div', { className: 'match-company' }, m.company || '（公司名未知）'),
                  h('div', { className: 'muted small' }, [m.city, m.salary_text].filter(Boolean).join(' · '))),
                h('div', { className: 'match-actions' },
                  (m.fb || '')
                    ? h('button', { className: 'btn small', disabled: busyAction === 'feedback', onClick: async () => { try { await act('feedback', { job_id: m.job_id, fb: 'skip' }) } catch {} } }, m.fb === 'interested' ? '取消感兴趣' : '取消不感兴趣')
                    : (m.score >= 60
                      ? h('button', { className: 'btn small danger', disabled: busyAction === 'feedback', onClick: async () => { try { await act('feedback', { job_id: m.job_id, fb: 'not_interested' }) } catch {} } }, '不感兴趣')
                      : h('button', { className: 'btn small ok', disabled: busyAction === 'feedback', onClick: async () => { try { await act('feedback', { job_id: m.job_id, fb: 'interested' }) } catch {} } }, '感兴趣')))),
              dims.length ? h('div', { className: 'match-dims' }, dims) : null,
              (reason.reasons || []).length ? h('div', { className: 'match-reasons' }, h('h4', null, '匹配理由'), h('ul', null, reason.reasons.map((r, i) => h('li', { key: i }, r)))) : null,
              (reason.misses || []).length ? h('div', { className: 'match-misses' }, h('h4', null, '不匹配点'), h('ul', null, reason.misses.map((r, i) => h('li', { key: i }, r)))) : null,
              reason.suggestion ? h('div', { className: 'match-suggestion' }, reason.suggestion) : null,
              m.description ? h('div', { className: 'match-desc' }, h('h4', null, '职位描述'), h('div', { className: 'desc-body', onClick: (e) => e.currentTarget.classList.toggle('expanded') }, m.description)) : null,
              h('div', { className: 'match-greeting' },
                h('div', { className: 'greet-head' }, h('h4', null, '打招呼语'), m.url ? h('a', { className: 'btn small', href: m.url, target: '_blank', rel: 'noopener' }, '职位链接') : null),
                m.greeting ? h('div', null,
                  h(GreetingBlock, { text: m.greeting['开场白'] || '—' }),
                  m.greeting['备用话术'] ? h(GreetingBlock, { text: m.greeting['备用话术'] }) : null)
                  : h('p', { className: 'muted' }, '暂无（重新打分时自动生成）')))
          })),
      )
    }

    function DimBar({ label, value }) {
      const v = Math.max(2, Math.min(100, Number(value) || 0))
      return h('div', { className: 'dim-row' },
        h('span', { className: 'dim-name' }, label),
        h('span', { className: 'dim-bar' }, h('span', { className: 'dim-fill ' + scoreClass(v), style: { width: v + '%' } })),
        h('span', { className: 'dim-score' }, value))
    }

    function MissItem({ m, onClick }) {
      const details = (m['明细'] || []).map((t, k) => h('li', { key: k }, t))
      return h('li', { className: 'miss-item' },
        h('b', { onClick, style: { cursor: 'pointer', color: '#2563eb' } }, m['缺口']),
        h('span', { className: 'tag conf' }, '出现 ' + m['出现次数'] + ' 次'),
        details.length ? h('ul', { className: 'miss-details' }, details) : null)
    }

    function TipsView({ data, act, notice, busyAction, onMissClick }) {
      const g = data.gap || {}
      const intents = (data.state.intents || []).map(it => it['方向']).filter(Boolean)
      const adjusts = data.adjusts || []
      const [direction, setDirection] = useState(intents[0] || '')
      const fbSavedMap = data.adjust_feedback || {}
      const [feedback, setFeedback] = useState(fbSavedMap[intents[0] || ''] || '')
      const [fbSaved, setFbSaved] = useState(false)
      const [report, setReport] = useState(data.gap_report || null)
      const [reportMsg, setReportMsg] = useState('')
      const [adjustMsg, setAdjustMsg] = useState('')
      const adjust = adjusts.find(a => a.direction === direction) || null

      const byDim = {}
      for (const m of (g['高频缺口'] || [])) {
        const d = m['维度'] || '核心能力匹配'
        if (!byDim[d]) byDim[d] = []
        byDim[d].push(m)
      }
      const dimRows = (g['维度均分'] || []).map((d, i) => h(DimBar, { key: i, label: d['维度'] || '', value: d['平均分'] }))
      const missGroups = Object.keys(byDim).map((dim) => h('div', { key: dim },
        h('h5', { className: 'miss-dim' }, dim),
        h('ul', { className: 'miss-list' }, byDim[dim].map((m, i) => h(MissItem, { key: i, m })))))

      const gapBlock = g['样本数']
        ? h('div', null,
          dimRows.length ? h('div', null, h('h4', null, '维度均分（参考集）'), h('div', { className: 'match-dims' }, dimRows)) : null,
          missGroups.length ? h('div', null, h('h4', null, '能力缺口（按维度）'), missGroups) : null)
        : h('p', { className: 'muted' }, '尚无结果，职位库打分后自动生成。')

      const reportBlock = report
        ? h('div', null,
          h('div', { className: 'doc-box', style: { marginTop: 14 } },
            h('h4', null, '差距分析报告'),
            h('p', { style: { margin: '0 0 8px' } }, report['总体判断'] || ''),
            (report['能力短板'] || []).length ? h('div', null, h('h4', null, '能力缺口'), h('ul', null, report['能力短板'].map((x, i) => h('li', { key: i }, x)))) : null,
            (report['提升建议'] || []).length ? h('div', null, h('h4', null, '提升建议'), h('ul', null, report['提升建议'].map((x, i) => h('li', { key: i }, x)))) : null,
            (report['简历呈现建议'] || []).length ? h('div', null, h('h4', null, '简历呈现建议'), h('ul', null, report['简历呈现建议'].map((x, i) => h('li', { key: i }, x)))) : null))
        : null

      const adjustBody = adjust && adjust.content
        ? h('div', { style: { marginTop: 10 } },
          (adjust.summary || []).length ? h('div', null, h('h4', null, '调整说明'), h('ul', { className: 'adjust-summary' }, adjust.summary.map((s, i) => h('li', { key: i }, s)))) : null,
          (adjust.examples || []).length ? h('div', null, h('h4', null, '改写示例'), h('ul', { className: 'adjust-examples' }, adjust.examples.map((ex, i) => h('li', { key: i },
            h('span', { className: 'muted small' }, '原表述：' + (ex['原表述'] || '')), h('br'), '建议改写：' + (ex['建议改写'] || ''))))) : null,
          h('div', { className: 'muted small adjust-meta' }, '基于参考集 ' + ((adjust.job_ids && adjust.job_ids.length) || 0) + ' 个职位 · 更新于 ' + fmtTime(adjust.updated_at)),
          h('div', { className: 'adjust-body-head' },
            h('h4', null, '简历正文'),
            h('button', { className: 'btn small', onClick: () => { if (navigator.clipboard) navigator.clipboard.writeText(adjust.content || '') } }, '复制全文')),
          h('pre', { className: 'doc-box adjust-content', style: { marginBottom: 0 } }, adjust.content || ''))
        : h('p', { className: 'muted', style: { marginTop: 10 } }, '尚未生成。')

      return h('div', null,
        h('div', { className: 'card' },
          h('div', { className: 'card-head' },
            h('h2', null, '差距分析'),
            h('div', { className: 'row batch-row' },
              h('span', { className: 'muted' }, reportMsg),
              h('button', { className: 'btn primary', disabled: busyAction === 'gap_report', onClick: async () => { setReportMsg('生成中（约 20~60 秒）…'); try { const r = await act('gap_report', {}); setReport(r.report || null); setReportMsg('') } catch (err) { setReportMsg(err.message) } } }, '生成差距分析报告'))),
                    gapBlock,
          reportBlock),
        h('div', { className: 'card' },
          h('div', { className: 'card-head' },
            h('h2', null, '简历调整'),
            h('div', { className: 'row batch-row' },
              h('span', { className: 'muted' }, adjustMsg),
              h('button', { className: 'btn primary', disabled: busyAction === 'adjust' || !direction, onClick: async () => { setAdjustMsg('生成中…'); try { await act('adjust', { direction, feedback }); setAdjustMsg(''); setFeedback(''); act('adjust_feedback', { direction, feedback: '' }).catch(() => {}) } catch (err) { setAdjustMsg(err.message) } } }, '生成调整后的简历'))),
          h('p', { className: 'hint' }, '依据意向职位、简历原文及补充说明、已确认能力、参考集中的职位描述及匹配理由进行简历调整。'),
          h('div', { className: 'row' },
            h('label', { style: { flex: 1 } }, '意向职位',
              h('select', { value: direction, onChange: (e) => { const d = e.target.value; setDirection(d); setFeedback(fbSavedMap[d] || '') } },
                intents.length
                  ? intents.map((d) => h('option', { key: d, value: d }, d))
                  : h('option', { value: '' }, '（先解析履历生成意向职位）')))),
          h('textarea', { rows: 3, style: { marginTop: 8, width: '100%' }, value: feedback, placeholder: '对上一版哪里不满意，如：概述太长，压到两句话', onChange: (e) => setFeedback(e.target.value), onBlur: () => { act('adjust_feedback', { direction, feedback }).then(() => { setFbSaved(true); setTimeout(() => setFbSaved(false), 500) }).catch(() => {}) } }),
          fbSaved ? h('span', { className: 'save-tip' }, '已保存') : null,
          adjustBody))
    }

    // 顶栏模型设置：模型服务 / 模型 / 推理强度（只影响插件自身的解析、打分与生成）
    function LlmPanel({ onClose, onSaved }) {
      const [catalog, setCatalog] = useState(null)
      const [err, setErr] = useState('')
      const [saving, setSaving] = useState(false)
      const [provider, setProvider] = useState('')
      const [model, setModel] = useState('')
      const [effort, setEffort] = useState('')

      useEffect(() => {
        post(ROUTE_ACTION, { action: 'llm_catalog' }).then((c) => {
          setCatalog(c)
          const cur = (c && c.current) || {}
          const provs = (c && c.providers) || []
          const p0 = cur.provider || cur.effective_provider || (provs[0] ? provs[0].id : '')
          const list0 = (c && c.models && c.models[p0]) || []
          const want = cur.model || cur.effective_model || ''
          const m0 = list0.some((m) => m.id === want) ? want : (list0[0] ? list0[0].id : '')
          setProvider(p0)
          setModel(m0)
          setEffort(cur.effort || '')
        }).catch((e) => setErr(String((e && e.message) || e)))
      }, [])

      const models = (catalog && catalog.models && catalog.models[provider]) || []
      const curModel = models.find((m) => m.id === model) || null
      const efforts = curModel ? curModel.efforts : []

      const apply = async () => {
        setSaving(true); setErr('')
        try {
          await post(ROUTE_ACTION, { action: 'save_llm_settings', provider, model, effort })
          if (onSaved) await onSaved()
          onClose()
        } catch (e) { setErr(String((e && e.message) || e)) } finally { setSaving(false) }
      }
      const reset = async () => {
        setSaving(true); setErr('')
        try {
          await post(ROUTE_ACTION, { action: 'reset_llm_settings' })
          if (onSaved) await onSaved()
          onClose()
        } catch (e) { setErr(String((e && e.message) || e)) } finally { setSaving(false) }
      }

      return [
        h('div', { key: 'bd', className: 'llm-backdrop', onClick: onClose }),
        h('div', { key: 'p', className: 'llm-panel' },
          h('label', null, '模型服务',
            h('select', {
              value: provider,
              onChange: (e) => {
                const v = e.target.value
                const list = (catalog && catalog.models && catalog.models[v]) || []
                setProvider(v); setModel(list[0] ? list[0].id : ''); setEffort('')
              },
            }, (catalog ? catalog.providers : []).map((p) => h('option', { key: p.id, value: p.id }, p.name + '（' + p.id + '）')))),
          h('label', null, '模型',
            h('select', {
              value: model,
              onChange: (e) => { setModel(e.target.value); setEffort('') },
              disabled: !models.length,
            },
              h('option', { value: '' }, models.length ? '请选择模型' : '该服务暂无可用模型'),
              models.map((m) => h('option', { key: m.id, value: m.id }, m.name)))),
          h('label', null, '推理强度',
            h('select', {
              value: effort,
              onChange: (e) => setEffort(e.target.value),
              disabled: !efforts.length,
            },
              h('option', { value: '' }, efforts.length ? '默认（不指定）' : '该模型不支持推理强度'),
              efforts.map((x) => h('option', { key: x.id, value: x.id }, x.name)))),
          err ? h('p', { className: 'llm-hint llm-err' }, err) : null,
          h('p', { className: 'llm-hint' }, '当前：' + ((catalog && catalog.current && (catalog.current.effective_provider || '—') + ' · ' + (catalog.current.effective_model || '—')) || '读取中…')),
          h('p', { className: 'llm-hint' }, '只影响插件的解析、打分与生成，不影响 DSH 对话。'),
          h('div', { className: 'row' },
            h('button', { className: 'btn small', type: 'button', onClick: reset, disabled: saving }, '恢复默认'),
            h('button', { className: 'btn small', type: 'button', onClick: onClose, disabled: saving }, '取消'),
            h('button', { className: 'btn small primary', type: 'button', onClick: apply, disabled: saving || !provider || !model }, saving ? '保存中…' : '应用'))),
      ]
    }

    function App() {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(true)
      const [tab, setTab] = useState('profile')
      const [notice, setNotice] = useState(null)
      const [busy, setBusy] = useState(false)
      const [busyAction, setBusyAction] = useState('')
      const [status, setStatus] = useState(null)
      const [jobPlatform, setJobPlatform] = useState('')
      const [matchPlatform, setMatchPlatform] = useState('')
      const [jobFilter, setJobFilter] = useState(null)
      const [focusJob, setFocusJob] = useState(null)
      const [llmOpen, setLlmOpen] = useState(false)
      const pollRef = useRef({ wasRunning: false })
      const revRef = useRef('')
      const mainRef = useRef(null)
      const scrollPos = useRef({})

      const switchTab = (k) => {
        if (mainRef.current) scrollPos.current[tab] = mainRef.current.scrollTop
        setTab(k)
        requestAnimationFrame(() => { if (mainRef.current) mainRef.current.scrollTop = scrollPos.current[k] || 0 })
      }

      const load = useCallback(async () => {
        try {
          const d = await post(ROUTE_DATA, {})
          setData(d); setError('')
        } catch (e) { setError(String((e && e.message) || e)) }
        finally { setLoading(false) }
      }, [])

      const act = useCallback(async (action, body) => {
        setBusy(true)
        setBusyAction(action)
        try {
          const r = await post(ROUTE_ACTION, { action, ...(body || {}) })
          setNotice({ kind: 'ok', text: (r && r.message) || '完成' })
          await load()
          setTimeout(() => setNotice((n) => (n && n.kind === 'ok' ? null : n)), 2500)
          return r
        } catch (e) {
          setNotice({ kind: 'err', text: String((e && e.message) || e) })
          throw e
        } finally { setBusy(false); setBusyAction('') }
      }, [load])

      useEffect(() => { ensureCss(); load() }, [load])

      useEffect(() => {
        const onFocus = () => { load() }
        const onVisible = () => { if (!document.hidden) load() }
        window.addEventListener('focus', onFocus)
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          window.removeEventListener('focus', onFocus)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [load])

      useEffect(() => {
        const tick = async () => {
          try {
            const st = await getStatus()
            setStatus(st)
            if (st.rev) {
              if (revRef.current && st.rev !== revRef.current) load()
              revRef.current = st.rev
            }
            const running = (st.batch && st.batch.running) || (st.parse && st.parse.running)
            if (running) {
              pollRef.current.wasRunning = true
              pollRef.current.lastBatch = st.batch
            } else if (pollRef.current.wasRunning) {
              pollRef.current.wasRunning = false
              const b = st.batch || pollRef.current.lastBatch || {}
              if (b.total > 0 && (b.done || 0) >= b.total) {
                scrollPos.current['matches'] = 0
                setFocusJob(null)
                setTab('matches')
                requestAnimationFrame(() => { if (mainRef.current) mainRef.current.scrollTop = 0 })
                setTimeout(() => { if (mainRef.current) mainRef.current.scrollTop = 0 }, 80)
                load()
              }
              load()
            }
          } catch {}
        }
        tick()
        const t = setInterval(tick, 3000)
        return () => clearInterval(t)
      }, [load])

      const tabs = [['profile', '能力画像'], ['jobs', '职位库'], ['matches', '匹配结果'], ['tips', '求职建议']]
      const llm = (data && data.llm) || {}
      const llmText = llm.provider
        ? llm.provider + ' · ' + llm.model + (llm.effort ? ' · ' + llm.effort : '')
        : '默认模型 · ' + (llm.effective_model || llm.default_model || 'deepseek-v4-pro')
      return h('div', { className: 'fj-root' },
        h('header', { className: 'topbar' },
          h('div', { className: 'brand' }, '求职助手 ', h('span', { className: 'sub' }, 'DSH 插件 · 本地')),
          h('nav', { className: 'tabs' }, tabs.map(([k, label]) => h('button', { key: k, className: 'tab' + (tab === k ? ' active' : ''), onClick: () => switchTab(k) }, label))),
          h('div', { className: 'topbar-right' },
            h('div', { className: 'llm-ctl' },
              h('button', {
                className: 'btn small llm-btn', type: 'button', title: '模型设置：' + llmText,
                onClick: () => setLlmOpen((v) => !v),
              }, llmText),
              llmOpen ? h(LlmPanel, { key: 'llmpanel', onClose: () => setLlmOpen(false), onSaved: load }) : null))),
        h('main', { ref: mainRef },
          loading && !data ? h('p', { className: 'muted' }, '读取中…') : null,
          error && !data ? h('div', { className: 'banner-err' }, '读取失败：' + error) : null,
          data ? (tab === 'profile' ? h(ProfileView, { data, act, notice: busy, busyAction })
            : tab === 'jobs' ? h(JobsView, { data, act, notice: busy, busyAction, jobPlatform, setJobPlatform, status, onMatched: (id) => { scrollPos.current['matches'] = 0; setFocusJob(id); switchTab('matches') } })
            : tab === 'matches' ? h(MatchesView, { data, act, notice: busy, busyAction, matchPlatform, setMatchPlatform, jobFilter, clearJobFilter: () => setJobFilter(null), focusJob })
            : h(TipsView, { data, act, notice: busy, busyAction, onMissClick: (ids) => { setJobFilter(ids); switchTab('matches') } })) : null))
    }

    function SidebarIcon({ size = 20 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': true },
        h('circle', { cx: 9, cy: 9, r: 5.2 }),
        h('path', { d: 'M13 13l4 4' }),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'dsh-find-job', inject: () => ({}) }, App))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'dsh-find-job', order: 60, label: () => '求职助手' }, SidebarIcon))
      },
    }
  },
})
