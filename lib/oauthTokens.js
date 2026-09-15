// 로그인한 사람의 네이버웍스 토큰을 저장/조회하고, 만료됐으면 자동으로 갱신한다.
// oauth_tokens 표는 service_role로만 접근 가능(supabase/schema.sql 참고).
import { createServiceClient } from './supabaseServer';
import { refreshAccessToken } from './naverworks';

export async function saveTokens(email, tokenResponse) {
  const supabase = createServiceClient();
  const expiresAt = new Date(Date.now() + (tokenResponse.expires_in || 3600) * 1000).toISOString();
  const { error } = await supabase.from('oauth_tokens').upsert({
    email,
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`토큰 저장 실패: ${error.message}`);
}

// 만료 60초 전부터는 미리 갱신한다(딱 맞춰 만료되면 그 사이 요청이 실패할 수 있어서).
const EXPIRY_BUFFER_MS = 60 * 1000;

export async function getValidAccessToken(email) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('email', email)
    .maybeSingle();

  if (error) throw new Error(`토큰 조회 실패: ${error.message}`);
  if (!data) {
    throw Object.assign(new Error('로그인 토큰이 없습니다. 다시 로그인해주세요.'), { code: 'no_token' });
  }

  const expiresAt = new Date(data.expires_at).getTime();
  if (Date.now() < expiresAt - EXPIRY_BUFFER_MS) {
    return data.access_token; // 아직 유효함
  }

  // 만료됐거나 곧 만료됨 — refresh_token으로 새로 받는다.
  const refreshed = await refreshAccessToken(data.refresh_token);
  await saveTokens(email, refreshed);
  return refreshed.access_token;
}
