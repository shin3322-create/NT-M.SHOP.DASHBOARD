-- ============================================================================
-- National Motors AS DashBoard  —  Supabase(Postgres) 스키마 + 권한(RLS)
-- Supabase 프로젝트 생성 후, 왼쪽 메뉴 SQL Editor에 이 파일 전체를 붙여넣고 Run 하세요.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 기본 설정(로스터/목표) — 기존 클로드 버전의 config/roster, config/targets 그대로
-- ---------------------------------------------------------------------------
create table if not exists config_kv (
  key   text primary key,          -- 'roster' | 'targets'
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into config_kv (key, value) values
  ('roster', '{
    "branches":[{"id":"gunsan","name":"군산"},{"id":"mokpo","name":"목포"},{"id":"seosan","name":"서산"}],
    "reception":[],
    "sa":[]
  }'::jsonb)
on conflict (key) do nothing;

insert into config_kv (key, value) values
  ('targets', '{"gunsan":253000000,"mokpo":310000000,"seosan":300000000}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. 사용자 프로필 — Supabase Auth의 auth.users 1건당 1행
--    role: pending(승인대기) | admin | sa | reception | viewer
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  role         text not null default 'pending' check (role in ('pending','admin','sa','reception','viewer')),
  person_id    text,              -- roster.sa[].id 또는 roster.reception[].id 와 매칭
  branch_slug  text,              -- gunsan | mokpo | seosan
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. 일마감 데이터
-- ---------------------------------------------------------------------------
create table if not exists sa_days (
  id            text primary key,   -- {branch}_{sa_id}_{date}
  branch_slug   text not null,
  sa_id         text not null,
  sa_name       text,
  date          date not null,
  entries       jsonb not null default '[]'::jsonb,
  summary       jsonb not null default '{}'::jsonb,
  submitted_at  timestamptz not null default now()
);
create index if not exists sa_days_date_idx on sa_days(date);
create index if not exists sa_days_branch_idx on sa_days(branch_slug);

create table if not exists reception_days (
  id            text primary key,   -- {branch}_{date}
  branch_slug   text not null,
  manager       text,
  manager_id    text,
  date          date not null,
  entries       jsonb not null default '[]'::jsonb,
  summary       jsonb not null default '{}'::jsonb,
  submitted_at  timestamptz not null default now()
);
create index if not exists reception_days_date_idx on reception_days(date);
create index if not exists reception_days_branch_idx on reception_days(branch_slug);

-- ---------------------------------------------------------------------------
-- 4. 로너카
-- ---------------------------------------------------------------------------
create table if not exists loaner_cars (
  id                    text primary key,
  branch_slug           text not null,
  car_no                text not null,
  status                text not null default '대기중' check (status in ('대여중','대기중')),
  loan_ro_no            text,
  checkout_date         date,
  expected_return_date  date,
  warranty              text default 'N' check (warranty in ('Y','N')),
  reason                text,
  updated_at            timestamptz not null default now()
);
create index if not exists loaner_cars_branch_idx on loaner_cars(branch_slug);

-- ---------------------------------------------------------------------------
-- 5. 헬퍼 함수 — 현재 로그인한 사용자의 role / person_id
-- ---------------------------------------------------------------------------
create or replace function my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function my_person_id() returns text
language sql stable security definer set search_path = public as $$
  select person_id from profiles where id = auth.uid();
$$;

create or replace function is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role <> 'pending' from profiles where id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS 켜기
-- ---------------------------------------------------------------------------
alter table config_kv       enable row level security;
alter table profiles        enable row level security;
alter table sa_days         enable row level security;
alter table reception_days  enable row level security;
alter table loaner_cars     enable row level security;

-- config_kv: 승인된 사용자는 조회, 관리자만 수정
create policy config_kv_select on config_kv for select
  using ( is_approved() );
create policy config_kv_write on config_kv for all
  using ( my_role() = 'admin' ) with check ( my_role() = 'admin' );

-- profiles: 본인 행은 조회, 관리자는 전체 조회/수정. 본인 최초 가입 시 자기 행만 pending으로 insert 가능
create policy profiles_select_self on profiles for select
  using ( id = auth.uid() or my_role() = 'admin' );
create policy profiles_insert_self on profiles for insert
  with check ( id = auth.uid() and role = 'pending' );
create policy profiles_update_admin on profiles for update
  using ( my_role() = 'admin' ) with check ( true );
create policy profiles_update_self_noop on profiles for update
  using ( id = auth.uid() and my_role() <> 'admin' )
  with check ( id = auth.uid() and role = (select role from profiles p where p.id = auth.uid()) );

-- sa_days: 승인된 사용자는 전체 조회(대시보드 집계용). 쓰기는 본인 sa_id 이거나 관리자만
create policy sa_days_select on sa_days for select
  using ( is_approved() );
create policy sa_days_write on sa_days for all
  using ( my_role() = 'admin' or (my_role() = 'sa' and sa_id = my_person_id()) )
  with check ( my_role() = 'admin' or (my_role() = 'sa' and sa_id = my_person_id()) );

-- reception_days: 승인된 사용자는 전체 조회. 쓰기는 본인 지점 담당(리셉션) 이거나 관리자만
create policy reception_days_select on reception_days for select
  using ( is_approved() );
create policy reception_days_write on reception_days for all
  using ( my_role() = 'admin' or (my_role() = 'reception' and manager_id = my_person_id()) )
  with check ( my_role() = 'admin' or (my_role() = 'reception' and manager_id = my_person_id()) );

-- loaner_cars: 승인된 사용자는 조회, 관리자만 수정 (필요시 SA/리셉션도 상태만 바꾸도록 추후 조정 가능)
create policy loaner_cars_select on loaner_cars for select
  using ( is_approved() );
create policy loaner_cars_write on loaner_cars for all
  using ( my_role() = 'admin' ) with check ( my_role() = 'admin' );

-- ---------------------------------------------------------------------------
-- 7. 맨 처음 관리자 지정하기
--    1) Supabase Dashboard > Authentication > Users 에서 원 본인 이메일로 계정을 먼저 만드세요
--       (또는 배포된 로그인 페이지에서 직접 회원가입)
--    2) 아래 UPDATE 문의 이메일을 본인 이메일로 바꿔서 SQL Editor에서 실행하세요
-- ---------------------------------------------------------------------------
-- update profiles set role = 'admin' where email = 'owner@example.com';

-- ---------------------------------------------------------------------------
-- 8. 실시간 동기화(Realtime) 켜기 — 여러 명이 동시에 볼 때 자동 갱신되게 함
--    (안 켜도 화면 새로고침/직접 저장 시에는 정상 동작합니다. 앱이 30초 간격으로도
--     자동 재조회하므로 필수는 아니지만, 켜두면 즉시 반영됩니다.)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table config_kv;
alter publication supabase_realtime add table sa_days;
alter publication supabase_realtime add table reception_days;
alter publication supabase_realtime add table loaner_cars;
alter publication supabase_realtime add table profiles;
