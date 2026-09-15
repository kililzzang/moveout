import { NextResponse } from 'next/server';
import { exchangeCodeForToken, decodeIdToken } from '../../../../../lib/naverworks';
import { createSessionCookieValue, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from '../../../../../lib/session';
import { createServiceClient } from '../../../../../lib/supabaseServer';

// 네이버웍스 로그인 화면에서 승인하고 돌아오는 곳. 여기서:
// 1) state로 CSRF 확인 2) code를 토큰으로 교환 3) id_token에서 이메일 꺼내기
// 4) allowed_users 표에 그 이메일이 있는지 확인(=권한 확인, 로그인 성공과는 별개)
// 5) 있으면 서명된 세션 쿠키를 남기고 체크리스트로, 없으면 "권한 없음" 안내로 보낸다.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const expectedState = request.cookies.get('nw_oauth_state')?.value;
  const baseUrl = new URL(request.url).origin;

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${baseUrl}/login?error=invalid_state`);
  }

  let tokenResponse;
  try {
    tokenResponse = await exchangeCodeForToken(code);
  } catch (err) {
    console.error('네이버웍스 토큰 교환 실패:', err);
    return NextResponse.redirect(`${baseUrl}/login?error=token_exchange_failed`);
  }

  let claims;
  try {
    claims = decodeIdToken(tokenResponse.id_token);
  } catch (err) {
    console.error('id_token 해석 실패:', err);
    return NextResponse.redirect(`${baseUrl}/login?error=id_token_invalid`);
  }

  // ⚠️ 확인 필요: 이메일/이름 필드가 실제로 이 키(email, name)로 오는지는 첫 로그인
  // 테스트에서 실제 payload를 콘솔에 찍어보고 확인해야 한다(문서상 OIDC 표준 클레임
  // 이름을 따랐을 거라 가정한 것).
  const email = claims.email;
  const name = claims.name || claims.sub || '';

  if (!email) {
    return NextResponse.redirect(`${baseUrl}/login?error=no_email`);
  }

  const supabase = createServiceClient();
  const { data: allowedUser, error } = await supabase
    .from('allowed_users')
    .select('email, name, role')
    .eq('email', email)
    .maybeSingle();

  if (error) {
    console.error('allowed_users 조회 실패:', error);
    return NextResponse.redirect(`${baseUrl}/login?error=lookup_failed`);
  }
  if (!allowedUser) {
    // 로그인(신원 확인)은 됐지만 사용 권한이 없는 경우 — 관리자에게 등록을 요청해야 함.
    return NextResponse.redirect(`${baseUrl}/login?error=not_allowed&email=${encodeURIComponent(email)}`);
  }

  const cookieValue = await createSessionCookieValue({
    email: allowedUser.email,
    name: allowedUser.name || name,
    role: allowedUser.role,
  });

  const res = NextResponse.redirect(`${baseUrl}/`);
  res.cookies.set(SESSION_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: '/',
  });
  res.cookies.set('nw_oauth_state', '', { maxAge: 0, path: '/' }); // 다 쓴 state 쿠키는 지운다
  return res;
}
