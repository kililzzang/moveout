import { cookies } from 'next/headers';
import StatsPasswordForm from './StatsPasswordForm';
import StatsPanel from './StatsPanel';
import '../checklist.css';

// 서버 컴포넌트라서 쿠키 확인 자체는 브라우저에 로직을 내려보내지 않고 서버에서
// 끝낸다 -- 인증 안 된 사람한테는 StatsPanel 코드/데이터 요청이 아예 전달되지 않는다.
// StatsPanel은 그 자체로 'use client' 클라이언트 컴포넌트라 서버 컴포넌트에서 바로
// import해서 렌더할 수 있다 -- next/dynamic(ssr:false)은 서버 컴포넌트 안에서 못 쓴다
// (Next.js 제약, 빌드 에러로 확인됨)는 점만 유의.

export default async function StatsPage() {
  const cookieStore = await cookies();
  const authed = cookieStore.get('stats_auth')?.value === 'ok';

  if (!authed) {
    return (
      <div className="wrap" style={{ maxWidth: 360 }}>
        <div className="masthead">
          <h1>성과 대시보드</h1>
          <p>박길일님 개인 업무 자료라 비밀번호로 잠가뒀어요.</p>
        </div>
        <StatsPasswordForm />
      </div>
    );
  }

  return <StatsPanel />;
}
