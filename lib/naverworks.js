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
// media: [{ label, url, contentType, isTable? }]
export async function postToBoard({ accessToken, boardId, title, body, media, galleryUrl }) {
  const bodyHtml = escapeHtml(body).replace(/\n/g, '<br>');
  const mediaHtml = (media || [])
    .map((m, idx) => {
      const isVideo = (m.contentType || '').indexOf('video') === 0;
      const caption = `<div>[${escapeHtml(m.label || '')}]</div>`;
      if (isVideo) {
        return caption + `<video src="${m.url}" controls style="max-width:100%;"></video>`;
      }
      const imgStyle = m.isTable ? 'max-width:100%;' : 'max-width:480px;width:100%;height:auto;';
      const viewerHref = galleryUrl ? `${galleryUrl}#p${idx}` : m.url;
      return caption + `<a href="${viewerHref}" target="_blank" rel="noopener"><img src="${m.url}" style="${imgStyle}" /></a>`;
    })
    .join('<br>');
  const fullBody = mediaHtml ? `${bodyHtml}<br><br>${mediaHtml}` : bodyHtml;

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
  return JSON.parse(text); // { postId, ... }
}
