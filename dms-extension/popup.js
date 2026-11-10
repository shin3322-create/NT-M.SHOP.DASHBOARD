const DEF = { url: "https://nt-server.tail55a6d4.ts.net", anon: "" };
const $ = (id) => document.getElementById(id);
async function load(){
  const c = await chrome.storage.local.get(["url","anon","token","status"]);
  $("url").value = c.url || DEF.url;
  $("anon").value = c.anon || "";
  $("anon").placeholder = "(기본값 사용)";
  $("token").value = c.token || "";
  show(c.status);
}
function show(st){
  if (!st) { $("st").textContent = "아직 실행 기록이 없습니다.\nDMS에 로그인해 두면 5분마다 자동으로 가져옵니다."; return; }
  const t = new Date(st.at).toLocaleString("ko-KR");
  $("st").textContent = (st.ok ? "✅ 정상" : "⚠️ 확인 필요") + "  (" + t + ")\n" + (st.msg || "");
}
$("save").onclick = async () => {
  const v = { url: $("url").value.trim() || DEF.url, token: $("token").value.trim() };
  if ($("anon").value.trim()) v.anon = $("anon").value.trim(); else await chrome.storage.local.remove("anon");
  await chrome.storage.local.set(v);
  $("st").textContent = "저장했습니다. '지금 가져오기'로 확인해 보세요.";
};
$("run").onclick = async () => {
  const tabs = await chrome.tabs.query({ url: "https://www.bmwdms.co.kr/*" });
  if (!tabs.length) { $("st").textContent = "열려 있는 DMS 탭이 없습니다. DMS에 로그인한 뒤 다시 눌러 주세요."; return; }
  for (const t of tabs) { try { await chrome.tabs.sendMessage(t.id, { kind: "run-now" }); } catch(e){} }
  $("st").textContent = "가져오는 중… 10초 뒤 이 창을 다시 열어 결과를 확인하세요.";
};
chrome.storage.onChanged.addListener((ch) => { if (ch.status) show(ch.status.newValue); });
load();
