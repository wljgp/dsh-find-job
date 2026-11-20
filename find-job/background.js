/* 后台服务：把内容脚本提取的职位转发到本地 find-job 插件的写入端口。 */
const API_BASE = "http://127.0.0.1:18999";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "save_job") return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  fetch(`${API_BASE}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(msg.payload || {}),
    signal: controller.signal,
  })
    .then(async (resp) => {
      clearTimeout(timer);
      const data = await resp.json().catch(() => ({}));
      sendResponse({ ok: resp.ok, status: resp.status, data });
    })
    .catch((err) => {
      clearTimeout(timer);
      const msg2 = err && err.name === "AbortError"
        ? "请求超时：DSH 应用可能没有运行（未监听 127.0.0.1:18999）"
        : String(err && err.message ? err.message : err);
      sendResponse({ ok: false, error: msg2 });
    });
  return true;
});
