import { NextResponse } from 'next/server';
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from '../../../lib/session';

// 로그인한 사람이 누구인지(이메일/이름/역할) 브라우저 쪽(체크리스트 화면 등)에서
// 알아야 할 때 이 라우트로 물어보면 된다. 예: 점검 저장 시 "담당자"를 자동으로
// 채우거나, 관리자 전용 버튼을 보여줄지 판단할 때.
export async function GET(request) {
  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionCookieValue(cookieValue);
  if (!session) return NextResponse.json({ loggedIn: false }, { status: 401 });
  return NextResponse.json({ loggedIn: true, ...session });
}
