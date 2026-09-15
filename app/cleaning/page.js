import WorkList from '../_shared/WorkList';
import '../checklist.css';

// 이유는 app/repair/page.js 주석 참고 — Supabase 클라이언트를 즉시 만드는 클라이언트
// 컴포넌트라 정적 프리렌더 시 빌드가 깨져서 동적 렌더링으로 명시해둔다.
export const dynamic = 'force-dynamic';

export const metadata = { title: '청소작업 목록 — 퇴실점검 클립보드' };

export default function CleaningPage() {
  return (
    <WorkList
      category="cleaning"
      title="청소작업 목록"
      subtitle="흡연·스티커/부착물·폐기물·추가 청소비용·반려동물 청소 등 청소 카테고리 하자만 모았습니다. 호실당 가장 최근 점검 기준이라, 그 호실을 다시 점검하면 여기 내용도 자동으로 갱신됩니다."
      emptyText="지금 청소가 필요한 항목이 없습니다."
    />
  );
}
