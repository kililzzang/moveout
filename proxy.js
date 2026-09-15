import { NextResponse } from 'next/server';
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from './lib/session';

// 이 앱 전체(체크리스트 포함)는 로그인해야 볼 수 있게 막는다. 예외:
// - /login, /api/auth/* : 로그인 자체를 하는 경로라 당연히 열어둠
// - /stats* : 예전부터 자체 비밀번호(stats_auth 쿠키)로 따로 잠겨 있음, 그대로 둠
// - /api/cron/* : Vercel Cron이 호출(로그인 쿠키 없음), user-agent로 자체 확인함
// - /gallery/* : 게시글 사진을 탭하면 열리는 스와이프 갤러리 — 사진 원본 URL 자체가
//   이미 Supabase의 public 버킷이라 로그인 없이도 열람 가능했으므로, 이 페이지도
//   같은 수준으로 공개해둔다(2026-09-15, 박길일님 요청으로 신설)
// - Next.js 정적 자원(_next 등)
export async function proxy(request) {
  const { pathname } = request.nextUrl;

  const isPublic =
    pathname === '/login' ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/stats') ||
    pathname.startsWith('/api/stats-auth') ||
    pathname.startsWith('/api/cron/') ||
    pathname.startsWith('/gallery/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico';

  if (isPublic) return NextResponse.next();

  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionCookieValue(cookieValue);

  if (!session) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// 정적 파일(이미지·폰트 등)과 Next 내부 경로는 애초에 미들웨어를 안 태운다.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
