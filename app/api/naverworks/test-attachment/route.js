import { NextResponse } from 'next/server';
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from '../../../../lib/session';
import { getValidAccessToken } from '../../../../lib/oauthTokens';
import { postToBoard, addPostAttachment, getPostAttachmentUrl } from '../../../../lib/naverworks';

// "게시글 첨부파일 API"(드라이브 링크와 다른, 게시글 전용 업로드)로 올린 사진들이
// 본문 안에서 여러 장 다 썸네일로 보이는지, 순서가 유지되는지 확인해보는 1회성
// 테스트 라우트. ?count=6 처럼 개수를 바꿀 수 있다(기본 6장). 확인 끝나면 이
// 파일은 지워도 된다.
const COLORS = ['1D9E75', '378ADD', 'D85A30', '7F77DD', 'D4537E', 'BA7517', '639922', 'A32D2D'];

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

  const { searchParams } = new URL(request.url);
  const count = Math.min(Math.max(parseInt(searchParams.get('count') || '2', 10) || 2, 1), 8);

  let postId;
  const uploaded = [];
  try {
    const accessToken = await getValidAccessToken(session.email);

    const posted = await postToBoard({
      accessToken,
      boardId,
      title: `[삭제예정] 첨부파일 API 여러장 테스트 (${count}장)`,
      body: `이 글은 "게시글 첨부파일 API"로 사진 ${count}장을 올렸을 때\n1) 전부 썸네일로 보이는지 2) 순서가 1~${count} 그대로인지\n3) 눌렀을 때 스와이프로 넘길 수 있는지 확인하는 테스트입니다.\n확인 후 삭제해주세요.\n\n올린 사람: ${session.name} (${session.email})`,
    });
    postId = posted.postId || posted.id;
    if (!postId) {
      return NextResponse.json({ error: '게시글은 만들어졌는데 postId를 못 받았어요.', posted }, { status: 500 });
    }

    for (let i = 1; i <= count; i++) {
      const color = COLORS[(i - 1) % COLORS.length];
      const imgRes = await fetch(`https://placehold.co/400x300/${color}/FFF/png?text=${i}`);
      if (!imgRes.ok) throw new Error(`${i}번 테스트 이미지 다운로드 실패: ${imgRes.status}`);
      const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
      const fileName = `test-${String(i).padStart(2, '0')}.png`;

      // 게시글 생성 직후 첫 첨부는 색인 반영 지연으로 "Post does not exist"가
      // 나는 경우가 있어서(2026-09-16 확인), 짧게 재시도한다.
      let attachResult;
      let lastErr;
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
        try {
          attachResult = await addPostAttachment({
            accessToken,
            boardId,
            postId,
            fileName,
            fileSize: imgBuffer.length,
            contentType: 'image/png',
            fileBuffer: imgBuffer,
          });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (lastErr) throw lastErr;

      // 공식 문서가 안내하는 302 Location 방식으로 이 파일의 실제 접근 URL을
      // 물어본다 — 이 URL을 본문 HTML에 직접 <img src>로 넣을 수 있는지가
      // 핵심 확인 사항이다.
      let fileUrl = null;
      try {
        fileUrl = await getPostAttachmentUrl({
          accessToken,
          boardId,
          postId,
          attachmentId: attachResult.fileId,
        });
      } catch (urlErr) {
        fileUrl = `조회 실패: ${urlErr.message}`;
      }

      uploaded.push({ fileName, fileId: attachResult.fileId, fileUrl });
    }

    return NextResponse.json({ ok: true, postId, uploaded });
  } catch (err) {
    console.error('첨부파일 여러장 테스트 실패:', err);
    return NextResponse.json({ error: err.message, postId: postId ?? null, uploaded }, { status: 500 });
  }
}
