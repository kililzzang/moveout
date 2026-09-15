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
  v1_image_url text,
  v2_image_url text,
  general_photos jsonb not null default '[]',
  defects jsonb not null default '[]',
  status text not null default 'pending',     -- pending | posted
  queued_at timestamptz not null default now(),
  posted_at timestamptz
);

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
