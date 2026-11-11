#!/bin/bash
# 사용: data\check_args.txt 에 "날짜 지점" (예: 2026-11-09 gunsan) — 없으면 오늘/목포
KIT_WIN="$(pwd)"; OUT="$KIT_WIN/data/dms_check.txt"
read D B < <(tr -d '\r' < "$KIT_WIN/data/check_args.txt" 2>/dev/null)
D="${D:-$(TZ=Asia/Seoul date +%F)}"; B="${B:-mokpo}"
cd /opt/nt-supabase; PW=$(grep "^POSTGRES_PASSWORD=" .env | cut -d= -f2-)
Q(){ docker exec -i -e PGPASSWORD="$PW" supabase-db psql -h localhost -U supabase_admin -d postgres -At -F' | ' -c "$1"; }
{
echo "== 확장팩 실행 기록 (최근 4회) =="
Q "select to_char(at at time zone 'Asia/Seoul','MM-DD HH24:MI:SS'), info::text from nt_private.dms_log order by at desc limit 4" | cut -c1-200
echo; echo "== $D $B 리셉션 문서 (담당|제출시각|줄수) =="
Q "select manager, to_char(submitted_at at time zone 'Asia/Seoul','MM-DD HH24:MI:SS'), jsonb_array_length(entries) from reception_days where date='$D' and branch_slug='$B'"
echo; echo "== $D $B 리셉션 (#|접수번호|예약|입고시간|상태|입고|사유|재예약|차량번호|출처|DMS마지막값) =="
Q "select o, e->>'resv_no', e->>'resv_dt', e->>'checkin_dt', e->>'status', e->>'checkin_yn', coalesce(e->>'cancel_reason',''), coalesce(e->>'rebook',''), e->>'car_no', coalesce(e->'_dms'->>'src','수기'), coalesce((e->'_dms')::text,'') from reception_days r, jsonb_array_elements(r.entries) with ordinality as t(e,o) where r.date='$D' and r.branch_slug='$B' order by o"
echo; echo "== 같은 접수번호가 여러 줄인 경우 =="
Q "select e->>'resv_no', count(*) from reception_days r, jsonb_array_elements(r.entries) e where r.date='$D' and r.branch_slug='$B' group by 1 having count(*)>1"
} > "$OUT" 2>&1
echo 완료
