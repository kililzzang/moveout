import { NextResponse } from 'next/server';
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from '../../../../lib/session';
import { createServiceClient } from '../../../../lib/supabaseServer';
import { getValidAccessToken } from '../../../../lib/oauthTokens';
import { postToBoard } from '../../../../lib/naverworks';

// 웹앱A가 "리포트 저장" 시 post_queue에 미리 조립해둔 제목/본문(title, body)을
// 그대로 가져다가, 지금 로그인한 사람의 네이버웍스 계정으로 실제 게시한다.
// 지금까지는 "게시글 올려줘"라고 말하면 브라우저 자동화로 처리했는데, 이 라우트가
// 완성되면 그 대신 버튼 하나로 바로 게시할 수 있다. 사진은 postToBoard에서
// <img> 태그로 본문에 인라인 삽입을 시도한다(2026-09-15 확인: body가 HTML을
// 지원해서 가능해짐 — lib/naverworks.js 참고).
//
// 권한: 지금은 "로그인한 사람이면 누구나 어떤 post_queue든 게시 가능"으로 단순하게
// 열어뒀다. 나중에 "본인이 담당한 점검만" 같은 제한을 추가하려면 여기에 조건을
// 더 넣으면 된다(팀 규모가 작아서 지금은 이렇게 시작해도 괜찮다고 판단).
export async function POST(request) {
  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionCookieValue(cookieValue);
  if (!session) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const { postId } = await request.json().catch(() => ({}));
  if (!postId) {
    return NextResponse.json({ error: 'postId가 필요합니다.' }, { status: 400 });
  }

  const boardId = process.env.NAVERWORKS_BOARD_ID;
  if (!boardId) {
    return NextResponse.json(
      { error: 'NAVERWORKS_BOARD_ID 환경변수가 설정되지 않았어요. 어느 게시판에 올릴지 정해서 설정해주세요.' },
      { status: 500 }
    );
  }

  const supabase = createServiceClient();
  const { data: row, error: fetchError } = await supabase
    .from('post_queue')
    .select('*')
    .eq('id', postId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: `조회 실패: ${fetchError.message}` }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: '해당 점검 기록을 찾을 수 없어요.' }, { status: 404 });
  }
  if (row.status === 'posted') {
    return NextResponse.json({ error: '이미 게시된 기록이에요.' }, { status: 409 });
  }

  // 사진/동영상을 "1. 전체점검" 순서 그대로 다음 "2. 하자사진" 순서로 나열한다.
  // postToBoard가 사진은 <img>로 진짜 인라인 삽입을 시도하고, 동영상만 링크로 남긴다.
  const media = [];
  if (row.v1_image_url) media.push({ label: '점검결과표', url: row.v1_image_url, contentType: 'image/png' });
  (row.general_photos || []).forEach((p) => {
    if (p?.url) media.push({ label: p.label || '사진', url: p.url, contentType: p.contentType });
  });
  if (row.v2_image_url) media.push({ label: '하자요약표', url: row.v2_image_url, contentType: 'image/png' });
  (row.defects || []).forEach((d) => {
    (d.photos || []).forEach((p) => {
      if (p?.url) media.push({ label: `${d.mark || ''} ${d.caption || d.label || ''}`.trim(), url: p.url, contentType: p.contentType });
    });
  });

  let accessToken;
  try {
    accessToken = await getValidAccessToken(session.email);
  } catch (err) {
    const status = err.code === 'no_token' ? 401 : 500;
    return NextResponse.json({ error: `토큰 확인 실패: ${err.message}` }, { status });
  }

  let posted;
  try {
    posted = await postToBoard({
      accessToken,
      boardId,
      title: row.title,
      body: row.body,
      media,
    });
  } catch (err) {
    console.error('게시 실패:', err);
    return NextResponse.json({ error: `게시 실패: ${err.message}` }, { status: 502 });
  }

  await supabase
    .from('post_queue')
    .update({ status: 'posted', posted_at: new Date().toISOString() })
    .eq('id', postId);

  return NextResponse.json({ ok: true, postId: posted.postId || posted.id, postedBy: session.email });
}
