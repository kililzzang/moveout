import { NextResponse } from 'next/server';
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from '../../../../lib/session';
import { getValidAccessToken } from '../../../../lib/oauthTokens';
import { postToBoard } from '../../../../lib/naverworks';

// 자동게시(API 직접 호출) 배선이 실제로 되는지 딱 한 번 확인해보는 용도의 임시
// 라우트. post_queue를 안 건드리고, 지금 로그인한 사람 계정으로 게시판에 테스트
// 글 하나를 바로 올린다 — 확인 끝나면 이 파일은 지워도 된다. 로그인한 상태로
// 이 주소를 브라우저(휴대폰 등)에서 그냥 열기만 하면 된다.
export async function GET(request) {
  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionCookieValue(cookieValue);
  if (!session) {
    return NextResponse.json({ error: '로그인이 필요합니다. 먼저 로그인해주세요.' }, { status: 401 });
  }

  const boardId = process.env.NAVERWORKS_BOARD_ID;
  if (!boardId) {
    return NextResponse.json({ error: 'NAVERWORKS_BOARD_ID가 설정되지 않았어요.' }, { status: 500 });
  }

  try {
    const accessToken = await getValidAccessToken(session.email);
    const posted = await postToBoard({
      accessToken,
      boardId,
      title: '[삭제예정] 자동게시 인라인 이미지 테스트',
      body: `이 글은 사진이 본문에 실제로 인라인으로 삽입되는지 확인하는 테스트입니다.\n아래 이미지가 링크가 아니라 그림으로 바로 보이면 성공입니다.\n확인 후 삭제해주세요.\n\n올린 사람: ${session.name} (${session.email})`,
      media: [{ label: '테스트 이미지', url: 'https://placehold.co/400x300/png?text=Inline+Test', contentType: 'image/png' }],
    });
    return NextResponse.json({ ok: true, result: posted });
  } catch (err) {
    console.error('테스트 게시 실패:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
