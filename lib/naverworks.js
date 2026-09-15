// 네이버웍스 OAuth 로그인(Authorization Code 방식) 관련 헬퍼.
//
// ⚠️ 확인 필요: 아래 authorize/token 엔드포인트는 이 세션에서 실제 로그인 화면을
// 눌러서 끝까지 테스트해본 게 아니라, 앞서 서비스 계정(JWT) 인증에 실제로 썼던
// 토큰 엔드포인트(auth.worksmobile.com/oauth2/v2.0/token)와 같은 계열 URL 규칙을
// 그대로 따른 것이다. 배포 후 첫 로그인 시도에서 404나 오류가 나면 이 URL부터
// developers.worksmobile.com 문서와 대조해서 고쳐야 한다.
const AUTHORIZE_URL = 'https://auth.worksmobile.com/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://auth.worksmobile.com/oauth2/v2.0/token';

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
