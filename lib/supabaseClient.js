// 브라우저(클라이언트 컴포넌트)에서 쓰는 Supabase 클라이언트.
// 예전 아티팩트의 window.claude.use('db') / use('assets') / use('downloads') 세 개를
// 여기 하나로 대체한다 — .from('table') 이 dbCap, .storage 가 assetsCap,
// 파일 다운로드는 일반 <a download> 로 대체(별도 capability 불필요).
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
