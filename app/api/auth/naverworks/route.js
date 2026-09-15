import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { buildAuthorizeUrl } from '../../../../lib/naverworks';

// "네이버웍스로 로그인" 버튼이 이 라우트로 오면, state(CSRF 방지용 임의값)를 짧게
// 쿠키에 남겨두고 네이버웍스 로그인 화면으로 그대로 돌려보낸다.
export async function GET() {
  const state = crypto.randomBytes(16).toString('hex');
  const res = NextResponse.redirect(buildAuthorizeUrl(state));
  res.cookies.set('nw_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 10, // 로그인 도중 10분 안에만 유효하면 충분
    path: '/',
  });
  return res;
}
