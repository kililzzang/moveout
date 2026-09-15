'use client';
import dynamic from 'next/dynamic';

// 이 체크리스트는 localStorage·File API·canvas·Supabase 브라우저 클라이언트에 전부
// 의존하는, 완전히 클라이언트 전용 화면이다. 서버 렌더링(SSR)을 시도하면 서버에는
// localStorage가 없어 빈 상태로 렌더되고, 클라이언트가 실제 저장된 값으로 다시
// 그리면서 "Hydration failed" 오류가 났다(실제로 재현·확인함). ssr:false로 아예
// 서버 렌더링을 건너뛰어 이 불일치 자체가 생기지 않게 한다.
const ChecklistApp = dynamic(() => import('./ChecklistApp'), { ssr: false });

export default function Home() {
  return <ChecklistApp />;
}
