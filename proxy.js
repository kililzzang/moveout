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
// 2026-09-16: 호실점검 클립보드(체크리스트, "/")는 실제 점검원들이 매일 쓰는
// 화면이라 지금처럼 그대로 두고, 그 외에 새로 만들고 있는 기능들(/repair,
// /cleaning, /assignments, /repair-clipboard, /cleaning-clipboard — 아직 실사용
// 준비 안 됨)은 개발자(박길일님)만 들어가 볼 수 있게 막는다(박길일님 요청: "작업
// 하면서 호실점검원들이 혼란이 있으면 안 됌"). allowed_users.is_dev가 true인
// 계정으로 로그인했을 때만 세션 쿠키에 is_dev가 실려서, 그 값으로 판단한다 — DB를
// 매번 다시 조회하지 않는다.
const DEV_ONLY_PATHS = ['/repair', '/cleaning', '/assignments', '/repair-clipboard', '/cleaning-clipboard', '/dashboard'];

// 담당별 대시보드/역할 라우팅 설계(박길일님, 2026-09-16)의 1단계 — 보수·청소
// 작업자는 로그인하면 체크리스트("/") 대신 자기 클립보드로 바로 보낸다.
// is_dev인 사람한테만 적용하는 이유: 위 DEV_ONLY_PATHS가 아직 이 두 경로를
// 막아놔서, is_dev가 아닌 계정을 여기로 보내면 그 페이지가 다시 "/"로 튕겨내
// 무한 리다이렉트가 된다 — 클립보드가 실제로 열리는 개발자 계정에서만 role
// 라우팅을 테스트한다. 나중에 이 기능들을 실사용으로 열 때 이 조건도 같이 뺀다.
const ROLE_LANDING = { repair: '/repair-clipboard', cleaner: '/cleaning-clipboard' };

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

  if (DEV_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/')) && !session.is_dev) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  if (pathname === '/' && session.is_dev && ROLE_LANDING[session.role]) {
    return NextResponse.redirect(new URL(ROLE_LANDING[session.role], request.url));
  }

  return NextResponse.next();
}

// 정적 파일(이미지·폰트 등)과 Next 내부 경로는 애초에 미들웨어를 안 태운다.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
