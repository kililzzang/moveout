// 서버(API 라우트)에서만 쓰는 관리자 권한 Supabase 클라이언트. service_role 키를 쓰므로
// RLS(행 단위 보안)를 무시하고 모든 테이블에 접근 가능 — 절대 브라우저로 내려보내면 안 되고,
// app/api/** 라우트 안에서만 import 해서 쓴다. 나중에 네이버웍스 API를 서버에서 직접
// 호출하는 코드도 이 파일 근처(app/api/naverworks/*)에 들어갈 예정.
import { createClient } from '@supabase/supabase-js';

export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}
