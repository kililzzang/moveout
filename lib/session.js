// 로그인 세션을 아주 가볍게 구현한다 — 이 프로젝트는 이미 /stats에서
// httpOnly 쿠키 하나로 인증을 처리하고 있어서(app/api/stats-auth/route.js),
// 그 스타일을 그대로 따르되 신원 정보(이메일/이름/역할)를 담아야 하니
// 위조 방지를 위해 서명만 추가한다. Supabase Auth 자체의 세션 시스템은
// 쓰지 않는다 — 로그인 주체가 이메일/비밀번호가 아니라 네이버웍스 OAuth라서,
// Supabase가 기본 제공하는 로그인 방식과 안 맞고, 커스텀 OIDC 연동은 지금
// 필요한 것보다 훨씬 복잡하다.
//
// Node의 crypto 모듈 대신 Web Crypto(crypto.subtle)를 쓴다 — 이 파일은
// middleware.js(엣지 런타임에서 돌 수 있음)에서도 import되는데, 엣지 런타임은
// Node crypto를 못 쓰지만 Web Crypto는 Node·엣지 어디서나 동작하기 때문이다.

const COOKIE_NAME = 'nw_session';
// 2026-09-15: 30일 → 180일(6개월)로 연장(박길일님 요청, 개인 휴대폰으로 쓰는 게
// 확인돼서 안전함). 네이버웍스 게시 권한(access/refresh token)은 lib/oauthTokens.js가
// 서버에서 따로 자동 갱신하므로, 이 세션 쿠키를 늘려도 게시 기능 자체엔 영향 없다 —
// 이건 순전히 "이 앱에 다시 로그인해야 하는 주기"만 늘리는 값이다.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180일

function toBase64Url(bytes) {
  let str = '';
  for (const b of new Uint8Array(bytes)) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const str = atob(padded);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

async function getKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      'SESSION_SECRET 환경변수가 없습니다. 아무 임의의 긴 문자열이면 됩니다(예: openssl rand -hex 32) — Vercel 환경변수에 추가해주세요.'
    );
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

// {email, name, role} 을 서명된 쿠키 값 하나로 만든다. "payload.서명" 형태.
export async function createSessionCookieValue(payload) {
  const payloadBase64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await getKey();
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadBase64));
  return `${payloadBase64}.${toBase64Url(signature)}`;
}

// 쿠키 값을 검증해서 payload를 돌려준다. 위조됐거나 형식이 안 맞으면 null.
export async function verifySessionCookieValue(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 2) return null;
  const [payloadBase64, signatureBase64] = parts;
  try {
    const key = await getKey();
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(signatureBase64),
      new TextEncoder().encode(payloadBase64)
    );
    if (!valid) return null;
    return JSON.parse(new TextDecoder().decode(fromBase64Url(payloadBase64)));
  } catch (e) {
    return null;
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_MAX_AGE_SECONDS = MAX_AGE_SECONDS;
