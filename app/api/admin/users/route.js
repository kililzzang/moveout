import { NextResponse } from 'next/server';
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from '../../../../lib/session';
import { createServiceClient } from '../../../../lib/supabaseServer';

// 2026-09-16 신설 — 관리자 클립보드(/admin)가 "이 작업을 누구한테 배정할지" 고를 때
// 쓰는 목록. allowed_users는 RLS가 "service role only"라 브라우저(anon 키)에서
// 직접 못 읽는다(로그인 콜백에서만 읽는 설계, app/api/auth/naverworks/callback
// 참고) — 그래서 이 서버 라우트가 service role로 대신 조회해서, 배정에 필요한
// email/name/role만 골라 내려준다(비밀번호나 토큰 같은 건 애초에 이 표에 없음).
export async function GET(request) {
  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionCookieValue(cookieValue);
  if (!session) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.from('allowed_users').select('email, name, role').order('name');
  if (error) {
    return NextResponse.json({ error: `조회 실패: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ users: data || [] });
}
