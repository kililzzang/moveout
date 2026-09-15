import { NextResponse } from 'next/server';
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from '../../../../lib/session';
import { deleteR2Object } from '../../../../lib/r2';

// 사진/동영상 삭제(ItemRow의 "×" 버튼)도 presign과 마찬가지로 서버를 거친다 —
// 삭제는 서명 URL 없이 서버가 R2 인증키로 직접 지운다(2026-09-16, Supabase Storage
// 대신 R2로 이전).
export async function POST(request) {
  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionCookieValue(cookieValue);
  if (!session) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const { path } = await request.json().catch(() => ({}));
  if (!path || typeof path !== 'string') {
    return NextResponse.json({ error: 'path가 필요합니다.' }, { status: 400 });
  }

  try {
    await deleteR2Object(path);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('R2 삭제 실패:', err);
    return NextResponse.json({ error: `삭제 실패: ${err.message}` }, { status: 500 });
  }
}
