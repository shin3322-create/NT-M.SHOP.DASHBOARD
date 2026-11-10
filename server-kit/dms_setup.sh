#!/bin/bash
# DMS 확장팩용 서버 입력 창구(RPC) + 확장팩 키 생성
set -e
KIT_WIN="$(pwd)"
cd /opt/nt-supabase
PW=$(grep "^POSTGRES_PASSWORD=" .env | cut -d= -f2-)
KEY_FILE="$KIT_WIN/data/dms_key.txt"
if [ -f "$KEY_FILE" ]; then KEY=$(tr -d '\r\n ' < "$KEY_FILE"); else KEY="ntdms_$(openssl rand -hex 20)"; fi
docker exec -i -e PGPASSWORD="$PW" supabase-db psql -h localhost -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -v key="$KEY" <<'SQL'
create extension if not exists pgcrypto with schema extensions;
create schema if not exists nt_private;
revoke all on schema nt_private from public, anon, authenticated;
create table if not exists nt_private.dms_config (id int primary key default 1, token_hash text not null, updated_at timestamptz default now());
create table if not exists nt_private.dms_log (at timestamptz default now(), info jsonb);
insert into nt_private.dms_config (id, token_hash) values (1, encode(extensions.digest(:'key', 'sha256'), 'hex'))
  on conflict (id) do update set token_hash = excluded.token_hash, updated_at = now();

create or replace function public.dms_check(p_token text) returns boolean
language sql security definer set search_path = '' as $$
  select exists(select 1 from nt_private.dms_config where token_hash = encode(extensions.digest(coalesce(p_token,''), 'sha256'), 'hex'));
$$;
revoke all on function public.dms_check(text) from public, anon, authenticated;

create or replace function public.dms_pull(p_token text, p_sa_ids text[], p_rc_ids text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.dms_check(p_token) then raise exception 'invalid dms key' using errcode = '28000'; end if;
  return jsonb_build_object(
    'roster', (select value from public.config_kv where key = 'roster'),
    'sa', coalesce((select jsonb_object_agg(s.id, to_jsonb(s)) from public.sa_days s where s.id = any(p_sa_ids)), '{}'::jsonb),
    'rc', coalesce((select jsonb_object_agg(r.id, to_jsonb(r)) from public.reception_days r where r.id = any(p_rc_ids)), '{}'::jsonb));
end $$;

-- 저장: 확장팩이 읽어간 뒤 직원이 먼저 저장했으면(제출시각 변경) 그 문서는 건너뜀 → 다음 주기에 다시 병합
create or replace function public.dms_push(p_token text, p_sa jsonb, p_rc jsonb, p_info jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n_sa int := 0; n_rc int := 0; d jsonb; n int;
begin
  if not public.dms_check(p_token) then raise exception 'invalid dms key' using errcode = '28000'; end if;
  for d in select * from jsonb_array_elements(coalesce(p_sa, '[]'::jsonb)) loop
    if d->>'base_submitted_at' is null then
      insert into public.sa_days (id, branch_slug, sa_id, sa_name, date, entries, summary, submitted_at)
      values (d->>'id', d->>'branch_slug', d->>'sa_id', d->>'sa_name', (d->>'date')::date, d->'entries', d->'summary', now())
      on conflict (id) do nothing;
    else
      update public.sa_days set entries = d->'entries', summary = d->'summary'
       where id = d->>'id' and submitted_at = (d->>'base_submitted_at')::timestamptz;
    end if;
    get diagnostics n = row_count; n_sa := n_sa + n;
  end loop;
  for d in select * from jsonb_array_elements(coalesce(p_rc, '[]'::jsonb)) loop
    if d->>'base_submitted_at' is null then
      insert into public.reception_days (id, branch_slug, manager, manager_id, date, entries, summary, submitted_at)
      values (d->>'id', d->>'branch_slug', d->>'manager', d->>'manager_id', (d->>'date')::date, d->'entries', d->'summary', now())
      on conflict (id) do nothing;
    else
      update public.reception_days set entries = d->'entries', summary = d->'summary'
       where id = d->>'id' and submitted_at = (d->>'base_submitted_at')::timestamptz;
    end if;
    get diagnostics n = row_count; n_rc := n_rc + n;
  end loop;
  insert into nt_private.dms_log (info) values (coalesce(p_info, '{}'::jsonb) || jsonb_build_object('sa', n_sa, 'rc', n_rc));
  delete from nt_private.dms_log where at < now() - interval '30 days';
  return jsonb_build_object('sa', n_sa, 'rc', n_rc);
end $$;
revoke all on function public.dms_pull(text, text[], text[]) from public;
revoke all on function public.dms_push(text, jsonb, jsonb, jsonb) from public;
grant execute on function public.dms_pull(text, text[], text[]) to anon, authenticated;
grant execute on function public.dms_push(text, jsonb, jsonb, jsonb) to anon, authenticated;
-- 대시보드 상단에 표시할 '마지막 자동 입력 시각' (로그인한 직원만 조회)
create or replace function public.dms_last_sync() returns timestamptz
language sql security definer set search_path = '' as $$ select max(at) from nt_private.dms_log; $$;
revoke all on function public.dms_last_sync() from public, anon;
grant execute on function public.dms_last_sync() to authenticated;
notify pgrst, 'reload schema';
SQL
printf '%s' "$KEY" > "$KEY_FILE"
echo
echo "완료! 확장팩 키: data\\dms_key.txt"
