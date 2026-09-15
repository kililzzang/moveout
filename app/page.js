import { SECTIONS } from '../lib/sections';
import unitHistory from '../lib/unitHistory.json';
import SupabasePing from './SupabasePing';

// 임시 상태 페이지 — 아직 실제 체크리스트 UI(아티팩트의 2800줄짜리 화면)는 이식 전이다.
// 지금은 "데이터·DB 배선이 제대로 됐는지"만 확인하는 용도. 다음 단계에서 이 페이지를
// 실제 체크리스트 폼으로 교체한다.
export default function Home() {
  const itemCount = SECTIONS.reduce((sum, s) => sum + s.items.length, 0);
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '40px 20px' }}>
      <h1 style={{ fontSize: 22 }}>퇴실점검 클립보드 — 웹앱 전환 진행 중</h1>
      <p style={{ color: 'var(--ink-soft)', lineHeight: 1.6 }}>
        아직 체크리스트 화면 자체는 이식하기 전 단계입니다. 지금 이 페이지는 데이터·DB
        배선이 제대로 됐는지만 확인하는 임시 화면이에요.
      </p>
      <ul style={{ lineHeight: 1.9 }}>
        <li>SECTIONS: {SECTIONS.length}개 구분, 항목 {itemCount}개 (lib/sections.json에서 로드됨)</li>
        <li>UNIT_HISTORY: {unitHistory.length}개 호실 이력 (lib/unitHistory.json에서 로드됨, 아직 Supabase로 이전 전)</li>
      </ul>
      <SupabasePing />
    </main>
  );
}
