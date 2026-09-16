-- 오피스텔 퇴실점검 웹앱 — Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여넣고 실행하면 테이블이 만들어집니다.
--
-- 예전 아티팩트의 db capability 컬렉션 4개(inspections, priceHistory, postQueue, boardHistory)를
-- 그대로 테이블 4개로 옮긴 것 — 문서ID였던 것을 그대로 text 기본키로 씁니다.
-- 지금은 "로그인한 사람이면 전부 다 볼 수 있다(팀 전체 공유)"는 지금 아티팩트와 동일한
-- 정책만 걸어둡니다 — 역할별 세분화(관리자/점검원/청소/보수)는 확장 설계 노트 06번 항목대로
-- 나중 단계에서 정책만 더 추가하면 됩니다(테이블 구조는 안 바뀜).

create extension if not exists "pgcrypto";

-- ---- 점검 기록 (예전 inspections 컬렉션) ----
create table if not exists inspections (
  id text primary key,              -- 예전 unitDocId()와 동일한 규칙(건물_호실 해시)
  building text not null default '',
  unit text not null default '',
  date text not null default '',
  check_time text not null default '',
  inspector text not null default '',
  items jsonb not null default '[]',          -- 하자 항목 요약(리포트·정리함 표시용)
  maintenance_total integer not null default 0,
  cleaning_total integer not null default 0,
  cleaning_fee integer not null default 0,
  final_note text not null default '',
  full_state jsonb not null default '{}',     -- 전체 state(불러오기용 원본) -- "full"은 예약어라 못 씀
  saved_at timestamptz not null default now()
);

-- ---- 표준가 학습 기록 (예전 priceHistory 컬렉션) ----
create table if not exists price_history (
  id text primary key,
  label text not null,
  amount integer not null,
  responsibility text not null default '',
  ts timestamptz not null default now()
);
create index if not exists price_history_label_idx on price_history (label);

-- ---- 네이버웍스 게시글 준비 큐 (예전 postQueue 컬렉션) ----
create table if not exists post_queue (
  id text primary key,              -- inspections.id 와 동일한 unitDocId
  building text not null default '',
  unit text not null default '',
  date text not null default '',
  title text not null default '',
  body text not null default '',
  history_image_url text,           -- 이전호실점검내역/하자보수완료내역/비고 이미지(2026-09-15 추가)
  v1_image_url text,
  v2_image_url text,
  general_photos jsonb not null default '[]',
  defects jsonb not null default '[]',
  status text not null default 'pending',     -- pending | posted
  queued_at timestamptz not null default now(),
  posted_at timestamptz
);

-- 이미 만들어둔 post_queue 표에는 위 컬럼이 없으니(테이블이 이미 있으면 create table
-- if not exists는 컬럼을 추가해주지 않는다), 기존 배포에도 안전하게 추가한다.
alter table post_queue add column if not exists history_image_url text;

-- ---- 게시판 메타데이터 (예전 boardHistory 컬렉션) — 크롤링해둔 기존 글 번호 매핑 ----
create table if not exists board_history (
  id text primary key,              -- "p" + 게시글 번호 뒷 9자리
  building text not null default '',
  unit text not null default '',
  date text not null default '',
  article_no text not null default ''
);
create index if not exists board_history_unit_idx on board_history (building, unit);

-- ---- 정적 호실 이력(게시판 표본 스냅샷) — 예전 UNIT_HISTORY 배열을 테이블로 ----
create table if not exists unit_history (
  id bigint generated always as identity primary key,
  building text not null,
  unit text not null,
  entries jsonb not null default '[]'   -- [{d, co, i:[[설명,금액],...]}, ...]
);
create index if not exists unit_history_bu_idx on unit_history (building, unit);

-- ---- RLS ----
-- 2026-09-15: 처음엔 "로그인한 사람만" 정책으로 걸었는데, 로그인(Auth) 기능 자체를 아직
-- 안 붙여서 anon 키로 쓰는 모든 요청이 다 막혀 저장이 전부 실패하는 버그로 이어졌다
-- (실제 배포에서 발견, SQL Editor에서 직접 수동으로 아래 정책으로 교체해 고침).
-- 지금은 예전 아티팩트의 "편집 가능 링크 공유"와 동일한 수준으로 완전히 열어둔다 —
-- URL만 알면 로그인 없이도 읽고 쓸 수 있다는 뜻. 다음 단계(네이버웍스 계정으로 로그인)를
-- 붙이면 이 정책들을 다시 좁혀야 한다.
alter table inspections enable row level security;
alter table price_history enable row level security;
alter table post_queue enable row level security;
alter table board_history enable row level security;
alter table unit_history enable row level security;

create policy "public read/write (no auth yet)" on inspections for all using (true) with check (true);
create policy "public read/write (no auth yet)" on price_history for all using (true) with check (true);
create policy "public read/write (no auth yet)" on post_queue for all using (true) with check (true);
create policy "public read/write (no auth yet)" on board_history for all using (true) with check (true);
create policy "public read/write (no auth yet)" on unit_history for all using (true) with check (true);

-- ---- Storage: 사진/동영상 버킷 (예전 assets capability) ----
-- SQL Editor에선 버킷을 못 만듭니다 — Supabase 대시보드 > Storage 에서
-- "photos" 라는 이름으로 버킷을 하나 만들고 Public을 켜주세요(팀 링크 공유와 동일한 수준).

-- ---- 로그인 허용 명단 (네이버웍스 OAuth 로그인용, 2026-09-15 추가) ----
-- 네이버웍스 계정으로 로그인은 회사 조직 구성원이면 누구나 시도할 수 있지만,
-- 실제로 이 앱을 쓸 수 있는지는 이 표에 이메일이 등록돼 있는지로 따로 가른다
-- (로그인=신원 확인, 이 표=권한 확인 — 둘은 별개). role은 관리자/점검원/청소/보수
-- 중 하나. 초기 명단은 팀장님께 받아서 여기 수동으로 넣는다 — 관리 화면은 다음 단계.
create table if not exists allowed_users (
  email text primary key,
  name text not null default '',
  role text not null default 'inspector' check (role in ('admin', 'inspector', 'cleaner', 'repair')),
  added_at timestamptz not null default now()
);

-- 예시(실제 이메일로 교체해서 넣으세요):
-- insert into allowed_users (email, name, role) values ('inspector1@example.com', '홍길동', 'inspector');

alter table allowed_users enable row level security;
-- 이 표는 로그인 콜백(서버, service_role 키)에서만 읽는다 — 브라우저(anon 키)는 접근 불가.
create policy "service role only" on allowed_users for all using (false) with check (false);

-- ---- 로그인 토큰 저장 (자동게시용, 2026-09-15 추가) ----
-- 점검원이 로그인할 때 받은 access_token·refresh_token을 저장해뒀다가, 나중에
-- "게시" 버튼을 누르는 시점(로그인보다 한참 뒤일 수 있음)에 그 사람 이름으로
-- 게시판 글을 쓸 때 다시 꺼내 쓴다. access_token은 금방 만료되니 refresh_token으로
-- 필요할 때마다 갱신한다(app/api/naverworks/post/route.js 참고).
create table if not exists oauth_tokens (
  email text primary key,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
-- ---- 작업 배정(work_orders) — 점검/보수/청소 3개 트랙 병렬 추적, 2026-09-16 추가 ----
-- Notion팀이 설계한 스키마(Notion "작업관리" DB와 notion_page_id로 1:1 대응, Supabase가
-- 원본이고 Notion은 단방향 미러)를 그대로 옮긴 것. unit_key는 inspections.id를 참조하되,
-- inspections처럼 호실당 1행으로 덮어쓰지 않는다 — 같은 호실이 다음 세입자 때 다시
-- 점검되면 새 work_orders 행이 또 생긴다(진행 중인 작업 사이클이 다음 점검에 덮어써지는
-- 사고를 막으려고 별도 PK를 쓴다, 전에 지적한 문제).
--
-- inspector/repair/cleaning의 담당자는 이 프로젝트에 범용 users 표가 없어서, 이미 로그인
-- 신원으로 쓰는 allowed_users.email을 그대로 쓴다(Notion 원안은 FK -> users였지만 이
-- 프로젝트 컨벤션에 맞춤). repair_status에만 'not_applicable'이 있고 cleaning_status에는
-- 없는 이유: 보수는 하자가 있을 때만, 청소는 하자 유무와 무관하게 항상 생성되기 때문.
create table if not exists work_orders (
  id uuid primary key default gen_random_uuid(),
  unit_key text not null references inspections(id),
  source text not null default 'manual' check (source in ('form', 'manual')),
  created_at timestamptz not null default now(),

  overall_status text not null default 'received'
    check (overall_status in ('received','inspecting','inspected','processing','billing_pending','completed')),

  inspector_email text references allowed_users(email),
  inspection_status text not null default 'assigned'
    check (inspection_status in ('assigned','rejected','in_progress','completed')),
  inspection_due_at timestamptz,
  inspection_reject_reason text,
  inspection_completed_at timestamptz,

  repair_email text references allowed_users(email),
  repair_status text not null default 'not_applicable'
    check (repair_status in ('not_applicable','assigned','rejected','waiting','in_progress','completed')),
  repair_due_at timestamptz,
  repair_reject_reason text,
  repair_completed_at timestamptz,

  cleaning_email text references allowed_users(email),
  cleaning_status text not null default 'assigned'
    check (cleaning_status in ('assigned','rejected','waiting','in_progress','completed')),
  cleaning_due_at timestamptz,
  cleaning_reject_reason text,
  cleaning_completed_at timestamptz,

  materials_used jsonb not null default '[]',
  invoice_amount integer,
  payment_status text not null default 'unbilled' check (payment_status in ('unbilled','billed','paid')),
  paid_at timestamptz,

  notion_page_id text
);
create index if not exists work_orders_unit_idx on work_orders (unit_key);
create index if not exists work_orders_inspector_idx on work_orders (inspector_email, inspection_status);
create index if not exists work_orders_repair_idx on work_orders (repair_email, repair_status);
create index if not exists work_orders_cleaning_idx on work_orders (cleaning_email, cleaning_status);

alter table work_orders enable row level security;
-- 다른 팀 공유 표들과 동일한 수준으로 열어둔다(로그인은 proxy.js 미들웨어가 이미 막고
-- 있어서, 로그인한 사람이면 전부 볼 수 있는 지금 정책과 일관됨).
create policy "public read/write (team-wide, same as other tables)" on work_orders for all using (true) with check (true);

alter table oauth_tokens enable row level security;
create policy "service role only" on oauth_tokens for all using (false) with check (false);
