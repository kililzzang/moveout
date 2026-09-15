import { NextResponse } from 'next/server';

// /stats(성과 대시보드)는 다른 점검원 두 명은 못 만드는, 박길일님 개인 업무 실적
// 자료라 체크리스트 화면과 다르게 비밀번호로 잠근다. 비밀번호 자체는 서버 환경변수
// (STATS_PASSWORD)에만 있고, 브라우저로 내려가는 JS 번들에는 절대 포함되지 않는다
// (그래서 이 라우트를 거쳐 서버에서만 비교한다) -- 클라이언트 쪽 NEXT_PUBLIC 값으로
// 비교하면 누구나 개발자도구에서 비밀번호를 읽을 수 있어서 그렇게 하지 않았다.
export async function POST(request) {
  const { password } = await request.json().catch(() => ({}));
  const expected = process.env.STATS_PASSWORD;

  if (!expected) {
    return NextResponse.json({ error: 'STATS_PASSWORD가 서버에 설정되지 않았어요.' }, { status: 500 });
  }
  if (password !== expected) {
    return NextResponse.json({ error: '비밀번호가 틀렸어요.' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  // 비밀번호 자체가 아니라 고정 토큰만 쿠키에 남긴다 -- 90일 유지.
  res.cookies.set('stats_auth', 'ok', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 90,
    path: '/stats',
  });
  return res;
}
