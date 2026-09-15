# 퇴실점검 클립보드 — 웹앱 전환

박길일님의 오피스텔 퇴실점검 체크리스트를 claude.ai 아티팩트에서 진짜 웹앱(Next.js + Supabase +
Vercel, 시작 비용 0원)으로 옮기는 프로젝트. 아티팩트는 CSP 때문에 네이버웍스 API를 직접 호출할
수 없어서, 자동 게시까지 가려면 이 전환이 필요하다.

## 지금까지 된 것 (2026-09-15)
- 프로젝트 뼈대(Next.js App Router) + Supabase 클라이언트 배선
- `supabase/schema.sql` — 예전 아티팩트의 db capability 컬렉션 4개(inspections, priceHistory,
  postQueue, boardHistory) + UNIT_HISTORY를 테이블 5개로 그대로 이전
- `lib/sections.js` — 체크리스트 항목·표준가·책임소재 데이터(SECTIONS) 이전 완료
- `lib/unitHistory.json` — 이전 점검 이력 942건 이전 완료(942/948 — 옛 triple 포맷 6건은
  건물/호실 정보가 없어 스킵됨, 필요하면 원본 아티팩트에서 수동 확인 필요)
- Supabase 연결 확인용 임시 페이지 (`app/page.js`)

## 아직 안 된 것 (다음 단계)
1. **체크리스트 화면 자체 이식** — 지금 아티팩트(moveout-checklist.html, 2800줄)의 폼 UI·사진
   업로드·표준가 학습 로직·리포트 조립·네이버웍스 게시 준비(postQueue) 로직을 React 컴포넌트로
   옮기는 작업. 로직 자체는 순수 JS라 그대로 옮겨지지만 분량이 커서 별도 작업으로 진행.
2. **로그인(Auth)** — 지금은 "편집 가능 링크 공유"로 대체하던 접근 제어를 Supabase Auth
   (이메일 로그인)로 교체.
3. **네이버웍스 API 연동** — 팀장님이 멤버 계정+OAuth를 발급하면, `app/api/naverworks/` 아래에
   서버 라우트를 만들어 여기서 직접 게시글을 등록한다(더 이상 브라우저 자동화 불필요, 단
   인라인 사진 삽입이 API로 되는지는 아직 미확인 — `naverworks-post-format.md` 참고).

## 로컬에서 실행하기
```bash
npm install
cp .env.local.example .env.local   # 아래 "Supabase 설정" 값을 채운 뒤
npm run dev
```

## 배포 준비 — 아래 두 계정은 본인이 직접 만들어야 합니다(둘 다 무료 플랜)

### 1. Supabase 프로젝트 만들기
1. https://supabase.com → 가입 → "New Project"
2. 프로젝트 만들어지면 왼쪽 메뉴 **SQL Editor** → `supabase/schema.sql` 파일 내용 전체 복사해서
   붙여넣고 실행 (테이블 5개 생성됨)
3. 왼쪽 메뉴 **Storage** → "New bucket" → 이름 `photos` → **Public bucket** 체크 → 생성
4. 왼쪽 메뉴 **Project Settings → API** 에서 3개 값 복사:
   - `Project URL` → `.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` 키 → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` 키(⚠️ 비밀, 절대 공유 금지) → `SUPABASE_SERVICE_ROLE_KEY`
5. (선택) 기존 이력 데이터 이전: `.env.local` 채운 뒤
   ```bash
   node -r dotenv/config scripts/import-unit-history.js dotenv_config_path=.env.local
   ```

### 2. Vercel 배포
1. 이 프로젝트를 GitHub 저장소로 올린다(아래 git 안내 참고)
2. https://vercel.com → GitHub 계정으로 가입/로그인 → "Add New Project" → 방금 만든 저장소 선택
3. **Environment Variables** 에 `.env.local`과 같은 3개 값을 그대로 입력(단, 이 화면에만
   입력하고 git에는 절대 올리지 않는다)
4. Deploy — 몇 분 뒤 `프로젝트명.vercel.app` 주소로 접속 가능

### GitHub에 올리기
```bash
git init
git add .
git commit -m "Initial scaffold: Next.js + Supabase"
# GitHub에서 빈 저장소를 하나 만든 뒤(예: officetel-checklist-app), 나온 remote 주소로:
git remote add origin <저장소 주소>
git push -u origin main
```
