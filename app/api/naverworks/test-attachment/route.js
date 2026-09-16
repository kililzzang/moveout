import { NextResponse } from 'next/server';
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from '../../../../lib/session';
import { getValidAccessToken } from '../../../../lib/oauthTokens';
import { postToBoard, addPostAttachment } from '../../../../lib/naverworks';

// "게시글 첨부파일 API"(드라이브 링크와 다른, 게시글 전용 업로드)로 올린 사진이
// 본문 안에서 썸네일로 보이는지, 아니면 파일 목록으로만 보이는지 실제로 확인해보는
// 1회성 테스트 라우트. 로그인한 상태로 이 주소를 열기만 하면 된다. 확인 끝나면
// 이 파일은 지워도 된다.
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
      title: '[삭제예정] 첨부파일 API 인라인 테스트',
      body: `이 글은 "게시글 첨부파일 API"로 올린 사진이 본문 안에 썸네일로 보이는지,\n아니면 파일 목록으로만 보이는지 확인하는 테스트입니다.\n확인 후 삭제해주세요.\n\n올린 사람: ${session.name} (${session.email})`,
    });
    const postId = posted.postId || posted.id;
    if (!postId) {
      return NextResponse.json({ error: '게시글은 만들어졌는데 postId를 못 받았어요.', posted }, { status: 500 });
    }

    const imgRes = await fetch('https://placehold.co/400x300/png?text=Attachment+Test');
    if (!imgRes.ok) {
      throw new Error(`테스트 이미지 다운로드 실패: ${imgRes.status}`);
    }
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

    const attachResult = await addPostAttachment({
      accessToken,
      boardId,
      postId,
      fileName: 'attachment-test.png',
      fileSize: imgBuffer.length,
      contentType: 'image/png',
      fileBuffer: imgBuffer,
    });

    return NextResponse.json({ ok: true, postId, attachResult });
  } catch (err) {
    console.error('첨부파일 테스트 실패:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
