import RepairClipboard from './RepairClipboard';
import '../checklist.css';

// 이유는 app/repair/page.js 주석 참고 — Supabase 클라이언트를 즉시 만드는 클라이언트
// 컴포넌트라 정적 프리렌더 시 빌드가 깨져서 동적 렌더링으로 명시해둔다.
export const dynamic = 'force-dynamic';

export const metadata = { title: '하자보수 클립보드 — 퇴실점검 클립보드' };

export default function RepairClipboardPage() {
  return <RepairClipboard />;
}
