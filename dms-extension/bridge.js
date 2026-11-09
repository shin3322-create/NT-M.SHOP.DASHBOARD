/* page.js(DMS 페이지) <-> background.js(확장 프로그램) 연결 */
window.addEventListener("message", (ev) => {
  if (ev.source !== window || !ev.data || ev.data.source !== "nt-dms") return;
  try { chrome.runtime.sendMessage({ kind: "dms", payload: ev.data }); } catch (e) {}
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.kind === "run-now") window.postMessage({ source: "nt-dms-cmd", cmd: "run" }, location.origin);
});
