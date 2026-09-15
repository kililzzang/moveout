import ChecklistApp from './ChecklistApp';

// Supabase 클라이언트가 브라우저에서만 만들어지도록(빌드 시점 정적 프리렌더를 건너뛰게)
// 강제한다 — 빌드 서버엔 Supabase 키가 없어도 되고, 실제 배포에선 Vercel 환경변수가 있다.
export const dynamic = 'force-dynamic';

export default function Home() {
  return <ChecklistApp />;
}
