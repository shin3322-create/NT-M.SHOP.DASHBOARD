#!/bin/bash
# 인보이스 미종료 RO 저장 창구(RPC) + 'RO 재발행 의심' 확인 — 확장팩 1.0.11 이상에서 사용 (다시 실행해도 안전)
set -e
cd /opt/nt-supabase
PW=$(grep "^POSTGRES_PASSWORD=" .env | cut -d= -f2-)
docker exec -i -e PGPASSWORD="$PW" supabase-db psql -h localhost -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<'SQL'
create schema if not exists nt_private;
-- 7일 넘게 미종료였던 RO를 기억해 두는 표 (종료되면 종료 시각·상태 기록)
create table if not exists nt_private.dms_ro_watch (
  ro_no text primary key, branch text, sa_name text, car_no text, open_date date,
  first_seen_at timestamptz not null default now(), closed_at timestamptz, closed_stat text);

drop function if exists public.dms_push_open_ro(text, jsonb);
create or replace function public.dms_push_open_ro(p_token text, p_rows jsonb, p_all jsonb default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
  rows jsonb := coalesce(p_rows, '[]'::jsonb);
  flags jsonb;
begin
  if not public.dms_check(p_token) then raise exception 'invalid dms key' using errcode = '28000'; end if;

  -- ① 현재 미종료 RO 목록 (대시보드 '인보이스 미종료 RO' 칸)
  insert into public.config_kv (key, value, updated_at)
  values ('dms_open_ro', jsonb_build_object('at', now(), 'rows', rows), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  if p_all is null then return jsonb_array_length(rows); end if;

  -- ② 7일 초과 미종료 RO를 감시 목록에 등록 (다시 열려 있으면 종료 표시 해제)
  insert into nt_private.dms_ro_watch (ro_no, branch, sa_name, car_no, open_date)
  select r->>'ro_no', r->>'branch', r->>'sa_name', replace(coalesce(r->>'car_no',''), ' ', ''), (r->>'open_date')::date
    from jsonb_array_elements(rows) r
   where coalesce(r->>'ro_no','') <> '' and coalesce(r->>'open_date','') ~ '^\d{4}-\d{2}-\d{2}$'
     and today - (r->>'open_date')::date > 7
  on conflict (ro_no) do update set closed_at = null, closed_stat = null,
     car_no = excluded.car_no, sa_name = excluded.sa_name, branch = excluded.branch;

  -- ③ 감시 중인 RO가 DMS에서 '인보이스 완료' 또는 'RO취소'로 바뀌면 종료로 기록
  update nt_private.dms_ro_watch w
     set closed_at = now(), closed_stat = a->>'t'
    from jsonb_array_elements(p_all) a
   where w.closed_at is null and a->>'r' = w.ro_no and a->>'t' in ('인보이스 완료', 'RO취소');

  -- ④ 종료 후(또는 종료 직전) 같은 차량번호로 새 RO가 발행된 건 = 재발행 의심
  --    조건: 새 RO 발행일이 기존 RO 발행일보다 늦고, 기존 RO 종료일 + 7일 이내 · 새 RO가 RO취소가 아님
  select coalesce(jsonb_agg(q.x order by q.x->>'closed_at' desc), '[]'::jsonb) into flags from (
    select jsonb_build_object(
             'branch', w.branch, 'car_no', w.car_no,
             'old_ro', w.ro_no, 'old_sa', w.sa_name, 'old_open', w.open_date,
             'closed_at', w.closed_at, 'closed_stat', w.closed_stat,
             'old_days', (w.closed_at at time zone 'Asia/Seoul')::date - w.open_date,
             'new_ro', a->>'r', 'new_sa', a->>'s', 'new_open', a->>'d', 'new_stat', a->>'t') as x
      from nt_private.dms_ro_watch w
      join jsonb_array_elements(p_all) a on replace(coalesce(a->>'c',''), ' ', '') = w.car_no and a->>'r' <> w.ro_no
     where w.closed_at is not null and w.closed_at > now() - interval '60 days' and w.car_no <> ''
       and coalesce(a->>'t','') <> 'RO취소' and coalesce(a->>'d','') ~ '^\d{4}-\d{2}-\d{2}$'
       and (a->>'d')::date > w.open_date
       and (a->>'d')::date <= (w.closed_at at time zone 'Asia/Seoul')::date + 7
  ) q;
  insert into public.config_kv (key, value, updated_at)
  values ('dms_reopen_ro', jsonb_build_object('at', now(), 'rows', flags), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  delete from nt_private.dms_ro_watch where closed_at < now() - interval '120 days';
  return jsonb_array_length(rows);
end $$;
revoke all on function public.dms_push_open_ro(text, jsonb, jsonb) from public;
grant execute on function public.dms_push_open_ro(text, jsonb, jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
SQL
echo "완료! 미종료 RO 저장 창구 + RO 재발행 의심 확인이 설정되었습니다."
