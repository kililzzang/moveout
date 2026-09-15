import WorkList from '../_shared/WorkList';
import '../checklist.css';

// Supabase 클라이언트를 마운트 즉시 만드는 클라이언트 컴포넌트라, 빌드 시 정적
// 프리렌더를 시도하면 (서버에는 NEXT_PUBLIC_* 환경변수가 있어도) "URL과 API 키가
// 필요하다" 에러로 빌드 자체가 실패한다(/stats는 cookies()를 써서 자동으로 이미
// 동적 렌더링이라 이 문제가 없었다) — 이 페이지는 명시적으로 동적 렌더링으로
// 돌린다.
export const dynamic = 'force-dynamic';

export const metadata = { title: '보수작업 목록 — 퇴실점검 클립보드' };

export default function RepairPage() {
  return (
    <WorkList
      category="maintenance"
      title="보수작업 목록"
      subtitle="퇴실점검에서 하자로 확인된 보수(유지보수) 항목만 모았습니다. 호실당 가장 최근 점검 기준이라, 그 호실을 다시 점검하면 여기 내용도 자동으로 갱신됩니다."
      emptyText="지금 보수가 필요한 항목이 없습니다."
    />
  );
}
