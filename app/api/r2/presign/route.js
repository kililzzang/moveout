import { NextResponse } from 'next/server';
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from '../../../../lib/session';
import { presignPutUrl, getR2PublicUrl } from '../../../../lib/r2';

// 브라우저가 사진/동영상/생성 이미지를 R2에 직접 올릴 수 있게, 이 경로에 한해서만
// 유효한 서명된 업로드 URL을 발급해준다(2026-09-16, Supabase Storage 대신 R2로
// 이전). 로그인한 사람만 발급받을 수 있다 — 진짜 R2 인증키는 여기(서버)에만 있고
// 브라우저로는 절대 안 나간다.
export async function POST(request) {
  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionCookieValue(cookieValue);
  if (!session) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const { path, contentType } = await request.json().catch(() => ({}));
  if (!path || typeof path !== 'string') {
    return NextResponse.json({ error: 'path가 필요합니다.' }, { status: 400 });
  }

  try {
    const uploadUrl = await presignPutUrl(path, contentType);
    return NextResponse.json({ uploadUrl, publicUrl: getR2PublicUrl(path) });
  } catch (err) {
    console.error('R2 업로드 URL 발급 실패:', err);
    return NextResponse.json({ error: `업로드 URL 발급 실패: ${err.message}` }, { status: 500 });
  }
}
