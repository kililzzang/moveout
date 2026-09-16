// 네이버웍스 OAuth 로그인(Authorization Code 방식) + 게시판 API 헬퍼.
//
// 2026-09-15: authorize/token 엔드포인트 실제 로그인으로 끝까지 검증 완료(박길일님,
// 팀장님 계정 둘 다 로그인 성공). 처음엔 리다이렉트 주소가 배포마다 바뀌는 임시
// 주소(VERCEL_URL)로 계산돼서 "유효하지 않은 클라이언트 정보" 오류가 났었는데,
// NEXT_PUBLIC_BASE_URL을 고정 배포주소로 명시하고 나서 해결됐다.
const AUTHORIZE_URL = 'https://auth.worksmobile.com/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://auth.worksmobile.com/oauth2/v2.0/token';
// 게시판 글쓰기 API. board 스코프로 로그인한 사람의 access_token을 그대로 쓰면
// 그 사람 이름으로 게시된다(서비스 계정과 달리 이건 진짜 멤버라 막히지 않을 것으로
// 예상 — 다만 실제 게시 자체는 아직 테스트 전이라 첫 시도가 진짜 검증이다).
const BOARD_POSTS_URL = (boardId) => `https://www.worksapis.com/v1.0/boards/${boardId}/posts`;

// 배포 주소를 기준으로 콜백 URL을 만든다. Vercel은 VERCEL_URL을 자동으로 넣어주지만
// 프로덕션 커스텀 도메인을 쓸 경우를 대비해 NEXT_PUBLIC_BASE_URL을 우선한다.
export function getBaseUrl() {
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export function getRedirectUri() {
  return `${getBaseUrl()}/api/auth/naverworks/callback`;
}

export function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.NAVERWORKS_CLIENT_ID,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: 'openid profile email board',
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

// authorization code를 토큰(access_token, id_token 등)으로 교환한다.
export async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: process.env.NAVERWORKS_CLIENT_ID,
    client_secret: process.env.NAVERWORKS_CLIENT_SECRET,
    redirect_uri: getRedirectUri(),
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`네이버웍스 토큰 교환 실패: ${res.status} ${text}`);
  }
  return JSON.parse(text); // { access_token, refresh_token, id_token, expires_in, ... }
}

// id_token(JWT)의 payload만 꺼낸다. 서명 검증은 하지 않는다 — 이 값은 클라이언트가
// 보낸 게 아니라 서버가 네이버웍스 토큰 엔드포인트에서 직접(HTTPS로) 받아온 것이라,
// 중간에 위조될 여지가 없다(제3자가 끼어들 수 없는 서버-서버 통신). 그래도 더 엄격하게
// 하려면 네이버웍스의 JWKS로 서명 검증을 추가할 수 있다 — 다음 단계로 남겨둔다.
export function decodeIdToken(idToken) {
  const parts = (idToken || '').split('.');
  if (parts.length !== 3) throw new Error('id_token 형식이 이상합니다.');
  const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
  return JSON.parse(payload); // { sub, name, email, ... } — 정확한 필드명은 실제 응답 보고 확인 필요
}

// access_token은 금방 만료된다 — refresh_token으로 새로 받는다. 로그인 때와
// grant_type만 다르고 나머지는 같은 토큰 엔드포인트를 쓴다.
export async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: process.env.NAVERWORKS_CLIENT_ID,
    client_secret: process.env.NAVERWORKS_CLIENT_SECRET,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`네이버웍스 토큰 갱신 실패: ${res.status} ${text}`);
  }
  return JSON.parse(text); // { access_token, refresh_token, expires_in, ... }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 2026-09-15: 첫 테스트 게시에서 사진이 "이미지"가 아니라 그냥 클릭해야 하는
// 링크 텍스트로 올라간 걸 확인했다. 알고 보니 이 API의 body는 HTML을 지원한다
// (developers.worksmobile.com/kr/docs/board-post-create 문서 확인,
// <script>만 금지) — 그래서 순수 텍스트 링크 대신 <img>/<video> 태그로 바꿨고,
// 사진·동영상 둘 다 실제로 인라인 재생까지 확인됨(링크 fallback은 필요 없어서 제거).
//
// 사진 크기·확대 관련 히스토리(박길일님 피드백 순서대로):
// 1) 처음엔 max-width:100%라 화면 폭을 꽉 채워서 스크롤이 길어짐 → 480px로 캡.
// 2) 축소된 <img>를 탭해도 네이버웍스 뷰어가 원본으로 확대를 안 해줌 → <a href
//    target=_blank>로 감싸서 탭하면 원본 이미지가 새 창/탭에 열리게 함.
// 3) 그렇게 열리는 원본이 사진 한 장짜리 브라우저 뷰라 여러 장을 스와이프로 넘겨볼
//    수가 없음 → galleryUrl이 있으면 그 링크(#p{idx} 프래그먼트 포함)로 연결해서,
//    탭하면 app/gallery/[id] 페이지가 열리고 그 안에서 전체 사진/동영상을 스와이프로
//    넘겨볼 수 있게 함(같은 순서를 쓰는 lib/postMedia.js 참고).
// 4) 점검결과표(v1)·하자요약표(v2)는 표/글자가 담긴 이미지라 축소하면 안 읽혀서,
//    이 둘은 isTable 플래그로 표시해 480px 축소 대상에서 뺐다.
// 2026-09-15: 게시글 폰트 크기 지정(박길일님 요청) — 게시글 자체의 "제목"(네이버웍스
// 게시판이 별도로 렌더링하는 순수 텍스트 필드, postToBoard의 title 인자)은 HTML이
// 아니라서 폰트 크기를 못 바꾼다. 대신 우리가 직접 만드는 본문(body)과 사진/동영상
// 캡션은 전부 이 크기로 통일한다.
const BODY_FONT_PX = 28;

// 2026-09-15: "내부사진"/"하자사진" 구분선 추가(박길일님 요청) — 일반 촬영 사진
// 묶음과 하자 사진 묶음이 시작되는 지점에 한 번씩 큰 글씨로 구분선을 넣는다.
// lib/postMedia.js가 매긴 group('table'·'general'·'defect')이 바뀌는 순간만
// 감지해서 넣으므로, 사진이 몇 장이든 묶음당 한 번만 나온다.
// 크기: 처음엔 본문(BODY_FONT_PX)의 3배(84px) → 2배(56px) → 44px로 조금 더 줄이고
// 볼드 처리(박길일님 요청, 2026-09-16).
const GROUP_DIVIDER_LABEL = { general: '내부사진', defect: '하자사진' };
const GROUP_DIVIDER_FONT_PX = 44;

// media: [{ label, url, contentType, isTable?, group? }]
// defectSummaryLines: ["①계량기 파손 40000원", ...] — "하자사진" 구분선 바로 밑에
// 한 번에 나열되는 하자 내역 텍스트(박길일님 요청, lib/postMedia.js의
// buildDefectSummaryLines 참고). 개별 사진 캡션([① 계량기 - 파손 (40,000원)])과는
// 별개로, 사진을 넘기지 않아도 전체 하자 내역을 한눈에 볼 수 있게 하는 목적이다.
export async function postToBoard({ accessToken, boardId, title, body, media, galleryUrl, defectSummaryLines }) {
  const bodyHtml = escapeHtml(body).replace(/\n/g, '<br>');
  let prevGroup = null;
  const mediaHtml = (media || [])
    .map((m, idx) => {
      let divider = '';
      if (GROUP_DIVIDER_LABEL[m.group] && m.group !== prevGroup) {
        divider = `<div style="font-size:${GROUP_DIVIDER_FONT_PX}px;font-weight:bold;">-------------------------${GROUP_DIVIDER_LABEL[m.group]}</div>`;
        if (m.group === 'defect' && defectSummaryLines && defectSummaryLines.length) {
          divider += defectSummaryLines.map((line) => `<div>${escapeHtml(line)}</div>`).join('');
        }
      }
      prevGroup = m.group;

      const isVideo = (m.contentType || '').indexOf('video') === 0;
      const caption = `<div>[${escapeHtml(m.label || '')}]</div>`;
      if (isVideo) {
        return divider + caption + `<video src="${m.url}" controls style="max-width:100%;"></video>`;
      }
      const imgStyle = m.isTable ? 'max-width:100%;' : 'max-width:480px;width:100%;height:auto;';
      const viewerHref = galleryUrl ? `${galleryUrl}#p${idx}` : m.url;
      return divider + caption + `<a href="${viewerHref}" target="_blank" rel="noopener"><img src="${m.url}" style="${imgStyle}" /></a>`;
    })
    .join('<br>');
  // 2026-09-15: body(주소/날짜 등 텍스트)가 완전히 삭제되면서 bodyHtml이 빈 문자열로
  // 들어오는 게 이제 기본값이다 — 이때 그냥 이어붙이면 이미지 앞에 빈 줄(<br><br>)이
  // 남아서 첫 줄이 붕 뜨므로, bodyHtml이 비어 있으면 mediaHtml만 쓴다.
  const rawBody = bodyHtml && mediaHtml ? `${bodyHtml}<br><br>${mediaHtml}` : (bodyHtml || mediaHtml);
  const fullBody = `<div style="font-size:${BODY_FONT_PX}px;">${rawBody}</div>`;

  const res = await fetch(BOARD_POSTS_URL(boardId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title,
      body: fullBody,
      enableComment: false,
      sendNotifications: false,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`네이버웍스 게시 실패: ${res.status} ${text}`);
  }
  const parsed = JSON.parse(text); // { postId, ... }
  // postId가 JS Number의 안전 정수 범위(2^53)를 넘는 큰 정수라서, 위 JSON.parse가
  // 이미 끝자리를 반올림해버린다(예: ...363123 → ...363000). 반올림된 값으로 이후
  // 첨부파일 API를 부르면 "Post does not exist"가 난다 — 원본 텍스트에서 정확한
  // 숫자 그대로 문자열로 다시 뽑아 덮어쓴다.
  const idMatch = text.match(/"postId"\s*:\s*(\d+)/);
  if (idMatch) parsed.postId = idMatch[1];
  return parsed;
}

// 2026-09-16: "게시글 첨부파일 API"(드라이브와 무관, 게시글 전용 업로드)로 올린
// 사진이 본문 안에서 썸네일로 보이는지 실제로 확인하기 위한 헬퍼. 문서
// (developers.worksmobile.com/kr/docs/board-post-attachment-create,
// .../kr/docs/file-upload) 기준 2단계: 1) 메타데이터(fileName/fileSize/
// contentType)를 보내 uploadUrl을 받고, 2) 그 uploadUrl에 multipart/form-data로
// 실제 파일을 POST(PUT 아님)한다. Authorization 헤더는 두 단계 모두 필요.
const ATTACHMENT_URL = (boardId, postId) =>
  `https://www.worksapis.com/v1.0/boards/${boardId}/posts/${postId}/attachments`;

export async function addPostAttachment({ accessToken, boardId, postId, fileName, fileSize, contentType, fileBuffer }) {
  const metaRes = await fetch(ATTACHMENT_URL(boardId, postId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fileName, fileSize, contentType }),
  });
  const metaText = await metaRes.text();
  if (!metaRes.ok) {
    throw new Error(`첨부파일 메타데이터 요청 실패: ${metaRes.status} ${metaText}`);
  }
  const { uploadUrl } = JSON.parse(metaText);
  if (!uploadUrl) {
    throw new Error(`응답에 uploadUrl이 없어요: ${metaText}`);
  }

  const form = new FormData();
  form.append('FileData', new Blob([fileBuffer], { type: contentType }), fileName);

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const uploadText = await uploadRes.text();
  if (!uploadRes.ok) {
    throw new Error(`첨부파일 업로드 실패: ${uploadRes.status} ${uploadText}`);
  }
  return uploadText ? JSON.parse(uploadText) : {};
}

// 2026-09-16: 게시판 화면이 첨부 이미지를 <a href="storage.worksmobile.com/..."><img></a>
// 로 자동 렌더링하는 걸 실사용으로 확인했다(로그인 없이도 fetch되는 진짜 공개
// URL). 그 URL을 우리가 직접 알아내려고 fileId를 파싱해서 짜맞추는 대신, 공식
// 문서(board-post-attachment-get)가 안내하는 "302 Location 헤더" 방식으로
// 정식으로 물어본다 — Naver 쪽 내부 URL 형식이 바뀌어도 이 호출은 계속 맞다.
export async function getPostAttachmentUrl({ accessToken, boardId, postId, attachmentId }) {
  const res = await fetch(
    `https://www.worksapis.com/v1.0/boards/${boardId}/posts/${postId}/attachments/${attachmentId}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: 'manual',
    }
  );
  const location = res.headers.get('location');
  if (!location) {
    const text = await res.text().catch(() => '');
    throw new Error(`첨부파일 URL 조회 실패: ${res.status} ${text}`);
  }
  return location;
}
