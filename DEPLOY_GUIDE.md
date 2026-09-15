# National Motors AS DashBoard — 배포 가이드

클로드 아티팩트를 벗어나 자체 도메인(nt.asdashboard.com)에서, 자체 로그인으로 운영하기 위한 배포 절차입니다.
비용 없이 시작할 수 있는 조합(Supabase 무료 티어 + Vercel 무료 호스팅)을 기준으로 안내합니다. 17명 규모(입력 10명·관리자 1명·뷰어 6명)에는 무료 티어로 충분합니다.

전체 흐름: **① Supabase(데이터베이스+로그인) 만들기 → ② 코드에 접속정보 넣기 → ③ Vercel에 올리기 → ④ 도메인 연결 → ⑤ 관리자 계정 지정 → ⑥ 직원 승인**

---

## 0. 이 폴더에 들어있는 파일

- `index.html` — 로그인 / 가입 신청 화면
- `dashboard.html` — 실제 대시보드(기존 클로드 버전과 기능 동일 + 실제 로그인 기반 권한)
- `supabase-adapter.js` — 내부 배관(직접 손댈 필요 없음)
- `config.js` — **여기에 본인 Supabase 접속정보를 입력해야 합니다**
- `schema.sql` — 데이터베이스 구조 + 권한 규칙 (Supabase에 한 번 실행)

## 1. Supabase 프로젝트 만들기

1. https://supabase.com 접속 → 회원가입(무료) → "New Project" 생성
   - Project name: 아무 이름 (예: `nt-asdashboard`)
   - Database Password: 안전한 비밀번호로 설정하고 별도로 보관
   - Region: `Northeast Asia (Seoul)` 선택 (속도가 가장 빠릅니다)
2. 프로젝트가 만들어지면 왼쪽 메뉴의 **SQL Editor**로 들어가서, 이 폴더의 `schema.sql` 내용을 전체 복사해 붙여넣고 **Run**을 누릅니다.
   - 오류 없이 끝나면 테이블(profiles, sa_days, reception_days, loaner_cars, config_kv)이 만들어진 것입니다.
3. 왼쪽 메뉴 **Project Settings → API**로 들어가서 다음 두 값을 복사해 둡니다.
   - **Project URL** (예: `https://abcxyz.supabase.co`)
   - **anon public** 키 (긴 문자열) — `service_role` 키는 **절대 사용하지 마세요**(외부에 노출되면 전체 데이터가 위험합니다).

## 2. 접속정보 입력

`config.js` 파일을 열어 아래처럼 방금 복사한 값으로 바꿔 저장합니다.

```js
window.SUPABASE_URL = "https://abcxyz.supabase.co";
window.SUPABASE_ANON_KEY = "여기에_anon_public_키_붙여넣기";
```

## 3. Vercel에 올리기 (무료 호스팅)

가장 쉬운 방법 — 설치 없이 드래그 앤 드롭:

1. https://vercel.com 접속 → 회원가입(무료, GitHub 계정으로 가입하면 편합니다)
2. 대시보드에서 **Add New → Project → Deploy without Git (Upload)** 또는 "Import" 옆의 드래그 영역에 이 폴더(`asdashboard` 전체, `config.js` 수정 완료된 상태)를 그대로 끌어다 놓습니다.
3. 빌드 설정은 그대로 두고 **Deploy**를 누르면 1분 안에 `https://프로젝트명.vercel.app` 주소가 생깁니다. 여기서 로그인·가입이 정상 동작하는지 먼저 테스트해 보세요.

(GitHub을 쓰신다면: 이 폴더를 GitHub 저장소에 올리고, Vercel에서 "Import Git Repository"로 연결하면 이후 파일을 고칠 때마다 자동으로 다시 배포됩니다. 처음엔 드래그 앤 드롭이 더 간단합니다.)

## 4. nt.asdashboard.com 도메인 연결

1. Vercel 프로젝트 화면에서 **Settings → Domains → Add** → `nt.asdashboard.com` 입력
2. Vercel이 안내하는 DNS 레코드(보통 `CNAME` 또는 `A` 레코드 하나)를 도메인을 구매한 곳(가비아, 후이즈, Cloudflare 등)의 DNS 관리 화면에 그대로 추가합니다.
   - 도메인이 아직 없다면: 가비아/후이즈 등에서 `asdashboard.com`을 구매한 뒤 `nt` 서브도메인으로 위 방식대로 연결하면 됩니다.
3. DNS는 반영까지 몇 분~몇 시간 걸릴 수 있습니다. 반영되면 `https://nt.asdashboard.com`으로 바로 접속됩니다.

## 5. 맨 처음 관리자 계정 만들기

1. 배포된 사이트(`nt.asdashboard.com` 또는 임시 `.vercel.app` 주소)에서 원 본인 이메일로 **가입 신청**을 먼저 합니다. (가입 직후에는 "승인 대기 중" 화면이 뜨는 게 정상입니다.)
2. Supabase **SQL Editor**로 돌아가서 아래 문장을 원의 이메일로 바꿔 실행합니다.
   ```sql
   update profiles set role = 'admin' where email = '본인이메일@example.com';
   ```
3. 사이트에서 로그아웃 후 다시 로그인하면 관리자 화면(설정 탭)이 열립니다.

## 6. 직원 계정 승인하기

1. 각 직원이 사이트에서 본인 이메일로 **가입 신청**을 합니다.
2. 관리자(원)가 로그인 후 **설정 → 직원 승인 / 역할 관리**에서 각 직원의 역할(SA/리셉션/뷰어)과 담당 지점·담당자(로스터 이름)를 지정하고 저장합니다.
3. 승인된 직원은 다음 로그인부터 정상적으로 대시보드를 사용할 수 있습니다.

이렇게 하면 SA/리셉션은 본인 이름으로 지정된 항목만 수정할 수 있고(데이터베이스 규칙으로 강제되어, 이전 클로드 버전의 PIN 방식보다 훨씬 안전합니다), 뷰어는 조회만 가능하며, 관리자만 설정·목표·직원 승인·데이터 백업/정리를 할 수 있습니다.

## 참고 — 나중에 필요할 수 있는 것

- **직원 초대 방식 변경**: 지금은 누구나 이메일만 있으면 가입 신청이 가능하고 관리자가 승인하는 방식입니다. 회사 이메일 도메인(예: `@nationalmotors.co.kr`)을 가진 사람만 가입되게 제한하고 싶다면 말씀해 주시면 코드 한 줄로 추가할 수 있습니다.
- **비밀번호를 잊어버린 경우**: 로그인 화면에 "비밀번호 찾기"는 아직 없습니다. 필요하면 Supabase Auth의 이메일 재설정 기능을 연결해 드릴 수 있습니다.
- **요금**: Supabase 무료 티어는 프로젝트가 1주일 이상 완전히 미사용 상태면 일시 정지될 수 있습니다(재접속 시 자동으로 다시 켜짐, 데이터는 유지됨). 실제 운영 중이면 이 문제는 없습니다. Vercel 무료 티어는 이 정도 트래픽에서는 제한에 걸리지 않습니다.
