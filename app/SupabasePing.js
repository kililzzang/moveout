'use client';
import { useEffect, useState } from 'react';
import { createClient } from '../lib/supabaseClient';

// Supabase 연결이 실제로 됐는지 화면에서 바로 확인하기 위한 최소 컴포넌트.
// 환경변수(.env.local)가 아직 없으면 "설정 필요"로, 있으면 unit_history 테이블 행 수를
// 세어서 보여준다 — 0이면 스키마는 있지만 아직 import-unit-history.js를 안 돌린 상태.
export default function SupabasePing() {
  const [status, setStatus] = useState('확인 중…');

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      setStatus('⚠️ .env.local 설정 필요 (.env.local.example 참고)');
      return;
    }
    const supabase = createClient();
    supabase
      .from('unit_history')
      .select('*', { count: 'exact', head: true })
      .then(({ count, error }) => {
        if (error) setStatus('❌ 연결 실패: ' + error.message);
        else setStatus('✅ Supabase 연결됨 — unit_history 테이블 ' + count + '행');
      });
  }, []);

  return <p style={{ fontFamily: 'monospace', fontSize: 13 }}>{status}</p>;
}
