#!/bin/bash
# 인보이스 미종료 RO 목록 저장 창구(RPC) 추가 — 확장팩 1.0.10 이상에서 사용
set -e
cd /opt/nt-supabase
PW=$(grep "^POSTGRES_PASSWORD=" .env | cut -d= -f2-)
docker exec -i -e PGPASSWORD="$PW" supabase-db psql -h localhost -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<'SQL'
create or replace function public.dms_push_open_ro(p_token text, p_rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
begin
  if not public.dms_check(p_token) then raise exception 'invalid dms key' using errcode = '28000'; end if;
  insert into public.config_kv (key, value, updated_at)
  values ('dms_open_ro', jsonb_build_object('at', now(), 'rows', coalesce(p_rows, '[]'::jsonb)), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
end $$;
revoke all on function public.dms_push_open_ro(text, jsonb) from public;
grant execute on function public.dms_push_open_ro(text, jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
SQL
echo "완료! 미종료 RO 저장 창구가 추가되었습니다."
