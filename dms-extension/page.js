/* NT DMS 확장팩 - DMS 페이지 안에서 실행 (로그인된 세션으로 리포트 데이터 조회) */
(function(){
  "use strict";
  if (window.__ntDmsLoaded) return; window.__ntDmsLoaded = true;
  const INTERVAL_MS = 5 * 60 * 1000;           // 5분마다
  const DEALER = "001632";                      // 내쇼날 모터스
  const BRANCHES = ["38", "36", "35"];          // AS 지점 3곳 (서산/목포/군산)
  const RO_URL = "/rpt/raw/selectRawRoRptList.do", RO_VIEW = "VIEW-D-23765";
  const RV_URL = "/rpt/raw/selectRawRptByResvStat.do", RV_VIEW = "VIEW-D-23775";
  const RO_DAYS_BACK = 7;                       // RO: RO발행일 기준 최근 7일
  const RV_DAYS_BACK = 3, RV_DAYS_FWD = 7;      // 예약: 예약일 기준 -3일 ~ +7일
  const PAGE = 1000;
  const OPEN_DAYS_BACK = 180;                   // 미종료 RO: 최근 180일 발행분 중 인보이스 미완료
  const OPEN_EVERY_MS = 30 * 60 * 1000;         // 미종료 RO 조회는 30분마다 (DMS 부담 줄이기)
  let running = false, lastOpenAt = 0;
  const RV_BASE = {
        sBrands: [], sSeriesList: [], sCarNo: "", sVinNo: "", sCustNm: "", sResvCustNm: "", sRoNo: "", sResvNo: "", sCustTp: "",
        sExcellence: "", sVocRcv: "", sDlrCd: DEALER, sBrchCdList: BRANCHES, sSalDlrCd: "", sSalBrchCdList: [], sAcepters: [],
        sSaList: [], sRcptType: "", sResvType: "", sSvcTypes: [], sDqRcrNoti: "", sResvMobility: "", sRclTcResv: "",
        sRclTcTarget: "", sRclTcCampnNm: "", sResvCampn: "", sCampnNm: "" };

  const ymd = (d) => new Date(d.getTime() + 9*3600e3).toISOString().slice(0,10);
  const addDays = (n) => new Date(Date.now() + n*86400e3);
  const startIso = (s) => new Date(s + "T00:00:00+09:00").toISOString();
  const endIso = (s) => new Date(s + "T23:59:59+09:00").toISOString();
  const post = (msg) => window.postMessage(Object.assign({ source: "nt-dms" }, msg), location.origin);

  function ajaxToken(){
    try { return window.jQuery && window.jQuery.ajaxSettings.headers && window.jQuery.ajaxSettings.headers["X-AjaxRequest"]; }
    catch(e){ return null; }
  }
  /* 업무시간(08~18시)에는 DMS 자체 jQuery로 요청 → DMS가 '사용 중'으로 인식해 자동 로그아웃 시간이 연장되도록 함
     업무시간 밖에는 일반 fetch로 요청 → 로그아웃 시간에 영향 없음 */
  /* 근무시간 (원 지정)
     - 월~금 08:30 ~ 18:30
     - 토요일은 그 달의 2·3·4번째 토요일만 08:30 ~ 16:00
     - 일요일·그 외 토요일은 근무 없음
     근무시간에만 DMS 조회와 로그인 유지를 하고, 근무시간이 끝나면 DMS에 아무 요청도 보내지 않음
     → DMS 자체 시간 제한(약 1시간)이 지나면 자동으로 로그아웃됨 */
  function inWork(){
    const k = new Date(Date.now() + 9*3600e3);              // 한국 시간
    const day = k.getUTCDay();                               // 0=일 … 6=토
    const mins = k.getUTCHours()*60 + k.getUTCMinutes();
    const START = 8*60 + 30;
    if (day >= 1 && day <= 5) return mins >= START && mins < 18*60 + 30;
    if (day === 6) {
      const nth = Math.ceil(k.getUTCDate() / 7);            // 그 달의 몇 번째 토요일인지
      return nth >= 2 && nth <= 4 && mins >= START && mins < 16*60;
    }
    return false;
  }
  function postText(url, view, body){
    const $ = window.jQuery;
    if (inWork() && $ && $.ajax){
      return new Promise((resolve, reject) => {
        $.ajax({ url, type: "POST", contentType: "application/json", dataType: "text", global: true,
                 headers: { "Client-Frame-Viewid": view }, data: JSON.stringify(body),
                 success: (t) => resolve(t), error: (x) => reject(new Error("DMS 요청 실패 " + x.status)) });
      });
    }
    return fetch(url, { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", "X-AjaxRequest": ajaxToken(), "Client-TimeZone-Offset": "540", "Client-Frame-Viewid": view },
      body: JSON.stringify(body) }).then(r => r.text());
  }
  async function fetchAll(url, view, base){
    const out = [];
    for (let page = 1; page <= 20; page++){
      const body = Object.assign({}, base, { recordCountPerPage: PAGE, pageIndex: page, firstIndex: (page-1)*PAGE, lastIndex: page*PAGE, sort: [] });
      const t = await postText(url, view, body);
      if (!t.trim().startsWith("{")) throw new Error("DMS 응답 오류(로그아웃 또는 권한 문제)");
      const j = JSON.parse(t);
      const rows = j.data || [];
      out.push(...rows);
      if (out.length >= Number(j.total || 0) || rows.length < PAGE) break;
    }
    // 개인정보 최소화: 전화번호 등은 전달하지 않음
    return out.map(r => { const c = Object.assign({}, r); delete c.custPhone; delete c.resvPhone; delete c.resvNm; delete c.custOpi; delete c.roNote; delete c.ordDlrOpinionMtr; delete c.inDlrOpinionMtr; return c; });
  }
  const RO_BASE = { sBrands: [], sVinNo: "", sCarNo: "", sSeriesList: [], sCustTp: "", sCustNo: "", sCustNm: "", sDlrCd: DEALER,
        sBrchCdList: BRANCHES, sSaList: [], sTechNms: [], sRoNo: "", sRoStat: "", sSvcTypes: [], sCustCarYn: "", sDqRcrNoti: "",
        sCalcTpCd: "", sCalcTpCds: [], sRclTcApply: "", sCampnApply: "", sCupnApply: "", sSvcTp: "", sExcludeCaseTargetYn: "N", sLeadTimeUnit: "HOURS" };
  /* 인보이스 미종료 RO: 'RO취소'·'인보이스 완료'가 아닌 RO만 골라 필요한 항목만 전달 */
  async function fetchOpenRo(today){
    const rows = await fetchAll(RO_URL, RO_VIEW, Object.assign({}, RO_BASE, {
      sSelectDt: "csltEndDt", sSearchStartDt: startIso(ymd(addDays(-OPEN_DAYS_BACK))), sSearchEndDt: endIso(today) }));
    const seen = new Set(), out = [];
    for (const r of rows){
      const stat = String(r.roStat || "").trim(), no = String(r.roNm || "").trim();
      if (!no || stat === "RO취소" || stat === "인보이스 완료" || seen.has(no)) continue;
      seen.add(no);
      out.push({ ro: no, stat, brch: r.asBrch || "", sa: r.chrgSaNm || "", car: r.carNo || "",
                 pub: String(r.publishDt || "").slice(0, 10), acpt: String(r.carAcptDtime || "").slice(0, 10) });
    }
    return out;
  }
  async function run(reason){
    if (running) return; running = true;
    try {
      if (!inWork()) { post({ type: "status", ok: true, msg: "근무시간 외 — 자동 입력 쉬는 중 (DMS는 약 1시간 뒤 자동 로그아웃)" }); return; }
      if (!ajaxToken()) { post({ type: "status", ok: false, msg: "DMS 로그인 대기 중" }); return; }
      const today = ymd(new Date());
      const ro = await fetchAll(RO_URL, RO_VIEW, Object.assign({}, RO_BASE, {
        sSelectDt: "csltEndDt", sSearchStartDt: startIso(ymd(addDays(-RO_DAYS_BACK))), sSearchEndDt: endIso(today) }));

      // ① 예약일 기준 (-3일 ~ +7일)
      const byResv = await fetchAll(RV_URL, RV_VIEW, Object.assign({}, RV_BASE, {
        sSelectDt: "resvDt", sSearchStartDt: startIso(ymd(addDays(-RV_DAYS_BACK))), sSearchEndDt: endIso(ymd(addDays(RV_DAYS_FWD))) }));
      // ② 차량접수일 기준 (최근 3일) — 예약일이 오래됐거나 다른 날인데 오늘 들어온 차까지 포함
      const byAcpt = await fetchAll(RV_URL, RV_VIEW, Object.assign({}, RV_BASE, {
        sSelectDt: "carAcptDt", sSearchStartDt: startIso(ymd(addDays(-RV_DAYS_BACK))), sSearchEndDt: endIso(today) }));
      const seen = new Set(); const resv = [];
      for (const r of [...byAcpt, ...byResv]) { const k = r.resvBrch + "|" + r.resvNo; if (seen.has(k)) continue; seen.add(k); resv.push(r); }  // 예약번호는 지점마다 따로 매겨짐
      let openRo = null;
      if (reason !== "timer" || Date.now() - lastOpenAt >= OPEN_EVERY_MS){
        try { openRo = await fetchOpenRo(today); lastOpenAt = Date.now(); } catch (e) { openRo = null; }
      }
      post({ type: "data", reason, ro, resv, openRo, at: new Date().toISOString() });
    } catch (e) {
      post({ type: "status", ok: false, msg: String(e.message || e) });
    } finally { running = false; }
  }
  window.addEventListener("message", (ev) => {
    if (ev.source === window && ev.data && ev.data.source === "nt-dms-cmd" && ev.data.cmd === "run") run("manual");
  });
  /* 로그인 유지: 업무시간에 5분마다 '사용 중' 신호 (마우스 이동·키 입력 흉내 + 가벼운 조회 1건) */
  function keepAlive(){
    if (!inWork() || !ajaxToken()) return;
    const docs = [document];
    document.querySelectorAll("iframe").forEach(f => { try { if (f.contentDocument) docs.push(f.contentDocument); } catch(e){} });
    for (const d of docs){
      try {
        const w = d.defaultView || window;
        d.dispatchEvent(new w.MouseEvent("mousemove", { bubbles: true, clientX: 5, clientY: 5 }));
        d.dispatchEvent(new w.KeyboardEvent("keydown", { bubbles: true, key: "Shift", code: "ShiftLeft" }));
        d.dispatchEvent(new w.KeyboardEvent("keyup", { bubbles: true, key: "Shift", code: "ShiftLeft" }));
      } catch(e){}
    }
    const today = ymd(new Date());
    postText(RV_URL, RV_VIEW, Object.assign({}, RV_BASE, { recordCountPerPage: 1, pageIndex: 1, firstIndex: 0, lastIndex: 1, sort: [],
      sSelectDt: "resvDt", sSearchStartDt: startIso(today), sSearchEndDt: endIso(today) }))
      .catch(() => {});
  }
  setInterval(keepAlive, 5 * 60 * 1000);

  setTimeout(() => run("start"), 20 * 1000);
  setInterval(() => run("timer"), INTERVAL_MS);
})();
