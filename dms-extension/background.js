/* NT DMS 확장팩 - DMS 데이터를 대시보드(SA 일마감 / 리셉션) 형식으로 합쳐서 서버에 저장 */
"use strict";

const DEFAULTS = {
  url: "https://nt-server.tail55a6d4.ts.net",
  anon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzk0MTg5OTUyLCJleHAiOjE5NTE4Njk5NTJ9.sEMA7ifp9YdNC916Urtg57vdMjypGYTEFemKEipruzY",
  token: ""
};
const BRANCH_BY_NAME = { "AS_군산": "gunsan", "AS_목포": "mokpo", "AS_서산": "seosan" };
const RC_SERVICE_TYPES = ["Maintenance","Recall/TC","경수리","중수리","진단","소음","사고수리","입고 Proactive-RITA"];
const RC_STATUS = ["예약접수","차량접수","예약취소","No Show","비예약"];
// 정산유형 → 대시보드 작업구분 (원 지정: C·CP·CCP=RETAIL, WS=BSI, W=W 보증, I=내부처리·정산 미포함)
const CALC_MAP = { C: "RETAIL", CP: "RETAIL", CCP: "RETAIL", WS: "BSI", W: "W 보증", I: "내부처리" };

/* ---------- 대시보드와 같은 집계 함수 (dashboard.html 에서 복사) ---------- */
function bucketSA(entries){
  const b = {RETAIL:0,BSI:0,"W 보증":0,RECALL:0,"보험":0,"내부처리":0};
  let sp=0, wp=0, roCount=0, checkoutO=0, checkoutX=0, loanerCount=0, massRecall=0;
  const countSeen = new Set(), statusSeen = new Set();
  for(const e of entries){
    if(!e.ro_no) continue;
    const amt = Number(e.amount)||0;
    if(e.svc_type === "대규모 리콜"){ massRecall += amt; }
    else {
      if(!countSeen.has(e.ro_no)){ countSeen.add(e.ro_no); roCount++; }
      if(e.svc_type === "SP판매"){ b.RETAIL += amt; sp++; }
      else if(e.svc_type === "WP판매"){ b.RETAIL += amt; wp++; }
      else if(e.svc_type in b){ b[e.svc_type] += amt; }
      else { b.RETAIL += amt; }
    }
    if(!statusSeen.has(e.ro_no)){
      statusSeen.add(e.ro_no);
      if(e.checkout_yn === "O") checkoutO++; else if(e.checkout_yn === "X") checkoutX++;
      if(e.loaner_used === "O") loanerCount++;
    }
  }
  const total = Object.values(b).reduce((a,c)=>a+c,0);
  return { total_sales: total, retail:b.RETAIL, bsi:b.BSI, warranty:b["W 보증"], recall:b.RECALL,
           insurance:b["보험"], internal:b["내부처리"], sp_count:sp, wp_count:wp,
           ro_count: roCount, checkout_o:checkoutO, checkout_x:checkoutX, loaner_count:loanerCount,
           mass_recall: massRecall };
}
function summarizeReception(entries){
  const valid = entries.filter(e => e.customer || e.car_no || e.resv_no || e.status);
  return { resv_count: valid.filter(e=>e.status==="예약접수").length,
           cancel_count: valid.filter(e=>e.status==="예약취소").length,
           checkin_count: valid.filter(e=>e.checkin_yn==="O").length,
           noshow_count: valid.filter(e=>e.checkin_yn==="X").length,
           pickdel_count: valid.filter(e=>e.pickdel==="픽딜").length,
           customer_visit_count: valid.filter(e=>e.pickdel==="고객입고").length,
           rebook_o: valid.filter(e=>e.rebook==="O").length,
           rebook_x: valid.filter(e=>e.rebook==="X").length,
           total_rows: valid.length };
}

/* ---------- 도우미 ---------- */
const s = (v) => (v === null || v === undefined) ? "" : String(v).trim();
const datePart = (v) => s(v).slice(0, 10);
const hhmm = (v) => { const m = s(v).match(/(\d{2}):(\d{2})/); return m ? `${m[1]}:${m[2]}` : ""; };
const todayKST = () => new Date(Date.now() + 9*3600e3).toISOString().slice(0,10);
const pick = (v, list, def) => list.includes(s(v)) ? s(v) : def;
/* 직원이 손으로 고친 값은 덮어쓰지 않음:
   현재 값이 비어 있거나, 지난번 확장팩이 넣은 값 그대로일 때만 새 값으로 바꿈 */
// 직원이 기본값 그대로 둔 경우(예: 상태 '예약접수')는 DMS 최신 상태로 바꿔도 됨
const DEFAULT_VALUES = { status: ["예약접수"] };
function setTracked(e, field, val){
  e._dms = e._dms || {};
  const cur = e[field] === undefined ? "" : e[field];
  const last = e._dms[field];
  const isDefault = (DEFAULT_VALUES[field] || []).includes(String(cur));
  if (cur === "" || cur === null || isDefault || (last !== undefined && String(cur) === String(last))) {
    e[field] = val;
    e._dms[field] = val;
  }
}

function svcFromCalc(calcTpCds, invCnt, invAmt){
  const codes = s(calcTpCds).split(",").map(c => c.trim().toUpperCase()).filter(Boolean);
  if (!codes.length) return { svc: "RETAIL", amount: "" };               // 아직 정산 전
  const nonI = codes.filter(c => c !== "I");
  if (!nonI.length) return { svc: "내부처리", amount: "" };               // I만 → 내부처리, 정산 미포함
  const svcs = [...new Set(nonI.map(c => CALC_MAP[c] || "RETAIL"))];
  const single = codes.length === 1;                                       // 유형 1개일 때만 금액 자동 입력
  const amount = (single && Number(invCnt) > 0) ? String(Math.round(Number(invAmt) || 0)) : "";
  return { svc: svcs[0], amount };                                         // I 섞임·복수 유형 → 금액 비움(SA 수기 입력)
}

/* ---------- 서버 호출 ---------- */
async function cfg(){ const c = await chrome.storage.local.get(["url","anon","token"]); return Object.assign({}, DEFAULTS, c); }
async function rpc(c, fn, body){
  const r = await fetch(`${c.url.replace(/\/$/,"")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: c.anon, Authorization: "Bearer " + c.anon },
    body: JSON.stringify(body)
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`서버 오류 ${r.status}: ${t.slice(0,150)}`);
  return t ? JSON.parse(t) : null;
}

/* ---------- 병합 ---------- */
async function sync(ro, resv){
  const c = await cfg();
  if (!c.token) throw new Error("확장팩 키가 설정되지 않았습니다 (확장팩 아이콘 → 키 입력)");
  const base = await rpc(c, "dms_pull", { p_token: c.token, p_sa_ids: [], p_rc_ids: [] });
  const roster = base.roster || { sa: [], reception: [] };
  const skipped = [];

  // --- SA: RO 리포트 → sa_days ---
  const saPlan = new Map();  // docId -> {person, branch, date, rows:[]}
  for (const r of ro){
    if (s(r.roStat) === "RO취소") continue;
    const branch = BRANCH_BY_NAME[s(r.asBrch)];
    const name = s(r.chrgSaNm);
    const person = roster.sa.find(p => p.name === name && p.branch === branch) || roster.sa.find(p => p.name === name);
    const date = datePart(r.carAcptDtime) || datePart(r.publishDt);
    if (!branch || !person || !date || !s(r.roNm)) { skipped.push(`${s(r.roNm)}(${name||"SA없음"})`); continue; }
    const id = `${person.branch}_${person.id}_${date}`;
    if (!saPlan.has(id)) saPlan.set(id, { person, date, rows: [] });
    saPlan.get(id).rows.push(r);
  }
  // --- 리셉션: 예약 현황 → reception_days ---
  const rcPlan = new Map();
  for (const r of resv){
    const branch = BRANCH_BY_NAME[s(r.resvBrch)];
    // 입고된 차는 '실제 입고일' 문서에, 아직 안 온 예약은 '예약일' 문서에 넣음
    const date = datePart(r.vehicAcptDt) || datePart(r.resvDt);
    if (!branch || !date || !s(r.resvNo)) continue;
    const id = `${branch}_${date}`;
    if (!rcPlan.has(id)) rcPlan.set(id, { branch, date, rows: [] });
    rcPlan.get(id).rows.push(r);
  }

  // 예약일이 바뀐 예약(예: 11/9 → 11/10)이 옛 날짜에 남지 않도록, 조회 기간의 리셉션 문서를 모두 함께 읽음
  const resvTarget = new Map();   // "지점|예약번호" -> 현재 들어가야 할 문서 id (예약번호는 지점마다 따로 매겨짐)
  for (const [id, plan] of rcPlan) for (const r of plan.rows) resvTarget.set(plan.branch + "|" + s(r.resvNo), id);
  // SA: RO 담당자/입고일이 바뀐 경우 옛 문서의 자동 입력 줄 정리용
  const roTarget = new Map();     // "지점|RO번호" -> 문서 id
  for (const [id, plan] of saPlan) for (const r of plan.rows) roTarget.set(plan.person.branch + "|" + s(r.roNm), id);
  const saWindowIds = new Set(saPlan.keys());
  for (const p of roster.sa) for (let d = -7; d <= 0; d++)
    saWindowIds.add(`${p.branch}_${p.id}_${new Date(Date.now() + (9*3600 + d*86400)*1000).toISOString().slice(0,10)}`);
  const windowIds = new Set(rcPlan.keys());
  for (const b of Object.values(BRANCH_BY_NAME))
    for (let d = -3; d <= 7; d++) windowIds.add(`${b}_${new Date(Date.now() + (9*3600 + d*86400)*1000).toISOString().slice(0,10)}`);

  const cur = await rpc(c, "dms_pull", { p_token: c.token, p_sa_ids: [...saWindowIds], p_rc_ids: [...windowIds] });
  const saOut = [], rcOut = [];

  for (const [id, plan] of saPlan){
    const old = (cur.sa || {})[id];
    const before = old ? JSON.stringify(old.entries || []) : "";
    const entries = old ? JSON.parse(JSON.stringify(old.entries || [])) : [];
    for (const r of plan.rows){
      const roNo = s(r.roNm);
      const lines = entries.filter(e => s(e.ro_no) === roNo);
      const { svc, amount } = svcFromCalc(r.calcTpCds, r.invCnt, r.invAmt);
      if (!lines.length){
        entries.push({ ro_no: roNo, checkin_time: hhmm(r.carAcptDtime), checkout_yn: "", stay_reason: "", svc_type: svc, amount,
                       return_date: "", return_reason: "", return_status: "", loaner_used: "", loaner_car_no: "",
                       car_no: s(r.carNo), _dms: { svc_type: svc, amount, src: "dms" } });
        lines.push(entries[entries.length-1]);
      } else if (lines.length === 1){
        // SA가 한 RO를 여러 줄로 나눠 적은 경우(금액 분할)는 금액·구분을 건드리지 않음
        setTracked(lines[0], "svc_type", svc);
        setTracked(lines[0], "amount", amount);
        if (!lines[0].checkin_time) lines[0].checkin_time = hhmm(r.carAcptDtime);
      }
      // 출고: RO상태 '인보이스 완료'면 O (그 전에는 SA 수기 값 유지)
      if (s(r.roStat) === "인보이스 완료"){
        for (const e of lines){
          if (e.checkout_yn !== "O") e.checkout_yn = "O";
          // 대시보드 '일마감 저장'과 같은 규칙: 출고 O면 로너카는 X(사용 중이었다면 반납일 기록)
          if (e.loaner_used !== "X"){
            if (e.loaner_used === "O" && !e.loaner_return_date) e.loaner_return_date = todayKST();
            e.loaner_used = "X";
          }
        }
      }
    }
    if (JSON.stringify(entries) === before) continue;
    saOut.push({ id, branch_slug: plan.person.branch, sa_id: plan.person.id, sa_name: plan.person.name, date: plan.date,
                 entries, summary: bucketSA(entries), base_submitted_at: old ? old.submitted_at : null });
  }

  for (const [id, plan] of rcPlan){
    const old = (cur.rc || {})[id];
    const before = old ? JSON.stringify(old.entries || []) : "";
    const entries = old ? JSON.parse(JSON.stringify(old.entries || [])) : [];
    for (const r of plan.rows){
      const resvNo = s(r.resvNo);
      const walkin = s(r.acptType) === "직접방문";
      const status = walkin ? "비예약" : pick(r.resvType, RC_STATUS, "예약접수");
      const checkin = s(r.resvType) === "차량접수" ? "O" : (s(r.resvType) === "No Show" ? "X" : "");
      let e = entries.find(x => s(x.resv_no) === resvNo);
      const isNew = !e;
      const prevStatus = e ? e.status : "";
      if (!e){
        e = { resv_dt: hhmm(r.resvDt), checkin_dt: hhmm(r.vehicAcptDt), resv_no: resvNo, customer: s(r.custNm), car_no: s(r.carNo),
              vin: s(r.vinNo), model: s(r.model), svc_type: pick(r.svcType, RC_SERVICE_TYPES, "Maintenance"), status,
              pickdel: s(r.pndYn) === "true" ? "픽딜" : "", checkin_yn: checkin, cancel_reason: "", rebook: "", rebook_dt: "",
              receiver: s(r.resvAcpter), _dms: { status, checkin_yn: checkin, src: "dms" } };
        entries.push(e);
      } else {
        const staffRow = !(e._dms && e._dms.src === "dms");
        const staffSetCheckin = staffRow && e.checkin_yn && !(e._dms && e._dms.checkin_yn === e.checkin_yn);
        // 직원이 입고 O/X를 직접 정한 줄은 상태를 바꾸지 않음 (예: 예약 재생성으로 DMS엔 '예약취소'지만 실제 입고한 차)
        if (staffSetCheckin) {
          // 1.0.1~1.0.6이 잘못 바꿔 둔 상태 되돌리기: 입고 O인데 DMS 값으로 '예약취소/No Show'가 된 직원 줄 → '예약접수'
          if (e.checkin_yn === "O" && e._dms && e._dms.status === e.status && (e.status === "예약취소" || e.status === "No Show")) {
            e.status = "예약접수"; delete e._dms.status;
          }
        } else {
          setTracked(e, "status", status);
        }
        setTracked(e, "checkin_yn", checkin);
        if (!e.checkin_dt) e.checkin_dt = hhmm(r.vehicAcptDt);
        if (!e.resv_dt) e.resv_dt = hhmm(r.resvDt);
      }
      // 취소를 처음 확인한 날짜 기록 → 대시보드에서 '예약일 당일 취소'만 사유 입력 대상으로 봄
      // (확장팩 1.0.8 이전부터 이미 취소돼 있던 건은 언제 취소됐는지 알 수 없어 'legacy'로 표시 → 사전 취소로 간주)
      const cancelFromDms = e._dms && (e._dms.src === "dms" || e._dms.status === "예약취소");   // 직원이 직접 취소로 적은 줄은 제외
      if (e.status === "예약취소" && cancelFromDms && !e._dms.cancel_at) {
        e._dms = e._dms || {};
        e._dms.cancel_at = (!isNew && prevStatus === "예약취소") ? "legacy" : todayKST();
      }
    }
    if (JSON.stringify(entries) === before) continue;
    const mgr = old && old.manager ? { name: old.manager, id: old.manager_id }
              : (roster.reception.find(p => p.branch === plan.branch) || { name: "DMS 자동", id: "dms_auto" });
    rcOut.push({ id, branch_slug: plan.branch, manager: mgr.name, manager_id: mgr.id, date: plan.date,
                 entries, summary: summarizeReception(entries), base_submitted_at: old ? old.submitted_at : null });
  }

  // 옛 날짜 문서에 남아 있는 '확장팩이 넣은' 예약 줄 정리 (직원이 직접 입력한 줄은 건드리지 않음)
  const outIds = new Set(rcOut.map(d => d.id));
  for (const [id, old] of Object.entries(cur.rc || {})){
    if (outIds.has(id)) continue;
    const entries = (old.entries || []).filter(e => {
      const t = resvTarget.get(old.branch_slug + "|" + s(e.resv_no));
      return !(e._dms && e._dms.src === "dms" && t && t !== id);
    });
    if (entries.length === (old.entries || []).length) continue;
    rcOut.push({ id, branch_slug: old.branch_slug, manager: old.manager, manager_id: old.manager_id, date: old.date,
                 entries, summary: summarizeReception(entries), base_submitted_at: old.submitted_at });
  }
  // 이번에 갱신한 문서 안에서도 다른 날짜로 옮겨간 예약 줄 제거
  for (const d of rcOut){
    d.entries = d.entries.filter(e => { const t = resvTarget.get(d.branch_slug + "|" + s(e.resv_no)); return !(e._dms && e._dms.src === "dms" && t && t !== d.id); });
    d.summary = summarizeReception(d.entries);
  }

  // SA: 다른 SA·다른 날짜로 옮겨간 RO의 '확장팩이 넣은' 줄을 옛 문서에서 제거 (SA가 직접 입력한 줄은 유지)
  const saOutIds = new Set(saOut.map(d => d.id));
  for (const [id, old] of Object.entries(cur.sa || {})){
    if (saOutIds.has(id)) continue;
    const entries = (old.entries || []).filter(e => {
      const t = roTarget.get(old.branch_slug + "|" + s(e.ro_no));
      return !(e._dms && e._dms.src === "dms" && t && t !== id);
    });
    if (entries.length === (old.entries || []).length) continue;
    saOut.push({ id, branch_slug: old.branch_slug, sa_id: old.sa_id, sa_name: old.sa_name, date: old.date,
                 entries, summary: bucketSA(entries), base_submitted_at: old.submitted_at });
  }
  for (const d of saOut){
    d.entries = d.entries.filter(e => { const t = roTarget.get(d.branch_slug + "|" + s(e.ro_no)); return !(e._dms && e._dms.src === "dms" && t && t !== d.id); });
    d.summary = bucketSA(d.entries);
  }

  // 바뀐 게 없어도 매번 기록 → 대시보드의 'DMS 자동입력 시각'이 정상 동작 중임을 알 수 있게 함
  const res = await rpc(c, "dms_push", { p_token: c.token, p_sa: saOut, p_rc: rcOut,
                                         p_info: { ro: ro.length, resv: resv.length, skipped: skipped.slice(0, 30) } });
  return { ro: ro.length, resv: resv.length, saDocs: res.sa, rcDocs: res.rc, skipped: skipped.length };
}

async function setStatus(st){
  await chrome.storage.local.set({ status: Object.assign({ at: new Date().toISOString() }, st) });
  chrome.action.setBadgeText({ text: st.ok ? "" : "!" });
  chrome.action.setBadgeBackgroundColor({ color: st.ok ? "#1baf7a" : "#d93025" });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.kind !== "dms") return;
  const p = msg.payload || {};
  if (p.type === "status") { setStatus({ ok: false, msg: p.msg }); return; }
  if (p.type === "data") {
    sync(p.ro || [], p.resv || [])
      .then(r => setStatus({ ok: true, msg: `RO ${r.ro}건 · 예약 ${r.resv}건 확인 → SA ${r.saDocs}건 · 리셉션 ${r.rcDocs}건 갱신` + (r.skipped ? ` (SA 미매칭 ${r.skipped}건 건너뜀)` : "") }))
      .catch(e => setStatus({ ok: false, msg: String(e.message || e) }));
  }
});
