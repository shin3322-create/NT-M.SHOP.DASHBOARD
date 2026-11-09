/* NT DMS 확장팩 - DMS 페이지 안에서 실행 (로그인된 세션으로 리포트 데이터 조회) */
(function(){
  "use strict";
  if (window.__ntDmsLoaded) return; window.__ntDmsLoaded = true;
  const INTERVAL_MS = 10 * 60 * 1000;          // 10분마다
  const DEALER = "001632";                      // 내쇼날 모터스
  const BRANCHES = ["38", "36", "35"];          // AS 지점 3곳 (서산/목포/군산)
  const RO_URL = "/rpt/raw/selectRawRoRptList.do", RO_VIEW = "VIEW-D-23765";
  const RV_URL = "/rpt/raw/selectRawRptByResvStat.do", RV_VIEW = "VIEW-D-23775";
  const RO_DAYS_BACK = 7;                       // RO: RO발행일 기준 최근 7일
  const RV_DAYS_BACK = 3, RV_DAYS_FWD = 7;      // 예약: 예약일 기준 -3일 ~ +7일
  const PAGE = 1000;
  let running = false;

  const ymd = (d) => new Date(d.getTime() + 9*3600e3).toISOString().slice(0,10);
  const addDays = (n) => new Date(Date.now() + n*86400e3);
  const startIso = (s) => new Date(s + "T00:00:00+09:00").toISOString();
  const endIso = (s) => new Date(s + "T23:59:59+09:00").toISOString();
  const post = (msg) => window.postMessage(Object.assign({ source: "nt-dms" }, msg), location.origin);

  function ajaxToken(){
    try { return window.jQuery && window.jQuery.ajaxSettings.headers && window.jQuery.ajaxSettings.headers["X-AjaxRequest"]; }
    catch(e){ return null; }
  }
  async function fetchAll(url, view, base){
    const out = [];
    for (let page = 1; page <= 20; page++){
      const body = Object.assign({}, base, { recordCountPerPage: PAGE, pageIndex: page, firstIndex: (page-1)*PAGE, lastIndex: page*PAGE, sort: [] });
      const r = await fetch(url, { method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-AjaxRequest": ajaxToken(), "Client-TimeZone-Offset": "540", "Client-Frame-Viewid": view },
        body: JSON.stringify(body) });
      const t = await r.text();
      if (!t.trim().startsWith("{")) throw new Error("DMS 응답 오류(로그아웃 또는 권한 문제)");
      const j = JSON.parse(t);
      const rows = j.data || [];
      out.push(...rows);
      if (out.length >= Number(j.total || 0) || rows.length < PAGE) break;
    }
    // 개인정보 최소화: 전화번호 등은 전달하지 않음
    return out.map(r => { const c = Object.assign({}, r); delete c.custPhone; delete c.resvPhone; delete c.resvNm; delete c.custOpi; delete c.roNote; delete c.ordDlrOpinionMtr; delete c.inDlrOpinionMtr; return c; });
  }
  async function run(reason){
    if (running) return; running = true;
    try {
      if (!ajaxToken()) { post({ type: "status", ok: false, msg: "DMS 로그인 대기 중" }); return; }
      const today = ymd(new Date());
      const ro = await fetchAll(RO_URL, RO_VIEW, {
        sSelectDt: "csltEndDt", sSearchStartDt: startIso(ymd(addDays(-RO_DAYS_BACK))), sSearchEndDt: endIso(today),
        sBrands: [], sVinNo: "", sCarNo: "", sSeriesList: [], sCustTp: "", sCustNo: "", sCustNm: "", sDlrCd: DEALER,
        sBrchCdList: BRANCHES, sSaList: [], sTechNms: [], sRoNo: "", sRoStat: "", sSvcTypes: [], sCustCarYn: "", sDqRcrNoti: "",
        sCalcTpCd: "", sCalcTpCds: [], sRclTcApply: "", sCampnApply: "", sCupnApply: "", sSvcTp: "", sExcludeCaseTargetYn: "N", sLeadTimeUnit: "HOURS" });
      const resv = await fetchAll(RV_URL, RV_VIEW, {
        sSelectDt: "resvDt", sSearchStartDt: startIso(ymd(addDays(-RV_DAYS_BACK))), sSearchEndDt: endIso(ymd(addDays(RV_DAYS_FWD))),
        sBrands: [], sSeriesList: [], sCarNo: "", sVinNo: "", sCustNm: "", sResvCustNm: "", sRoNo: "", sResvNo: "", sCustTp: "",
        sExcellence: "", sVocRcv: "", sDlrCd: DEALER, sBrchCdList: BRANCHES, sSalDlrCd: "", sSalBrchCdList: [], sAcepters: [],
        sSaList: [], sRcptType: "", sResvType: "", sSvcTypes: [], sDqRcrNoti: "", sResvMobility: "", sRclTcResv: "",
        sRclTcTarget: "", sRclTcCampnNm: "", sResvCampn: "", sCampnNm: "" });
      post({ type: "data", reason, ro, resv, at: new Date().toISOString() });
    } catch (e) {
      post({ type: "status", ok: false, msg: String(e.message || e) });
    } finally { running = false; }
  }
  window.addEventListener("message", (ev) => {
    if (ev.source === window && ev.data && ev.data.source === "nt-dms-cmd" && ev.data.cmd === "run") run("manual");
  });
  setTimeout(() => run("start"), 20 * 1000);
  setInterval(() => run("timer"), INTERVAL_MS);
})();
