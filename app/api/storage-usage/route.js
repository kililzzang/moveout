import { NextResponse } from 'next/server';
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from '../../../lib/session';
import { createServiceClient } from '../../../lib/supabaseServer';
import { buildMediaFromRow } from '../../../lib/postMedia';

// 오늘(KST) 게시된 점검 건들이 Supabase Storage를 얼마나 썼는지 확인하는 1회성
// 조회 라우트. 저장소 자체엔 "오늘 올라온 파일 용량"을 바로 보여주는 화면이
// 없어서, post_queue에서 오늘 게시된 행을 찾고 그 사진/동영상 URL마다 HEAD
// 요청으로 Content-Length를 읽어 합산한다. 확인 끝나면 지워도 된다.
function todayRangeKST() {
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kstNow.getUTCFullYear();
  const m = kstNow.getUTCMonth();
  const d = kstNow.getUTCDate();
  const startKST = Date.UTC(y, m, d, 0, 0, 0) - 9 * 60 * 60 * 1000;
  const endKST = startKST + 24 * 60 * 60 * 1000;
  return { start: new Date(startKST).toISOString(), end: new Date(endKST).toISOString() };
}

export async function GET(request) {
  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionCookieValue(cookieValue);
  if (!session) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const { start, end } = todayRangeKST();
  const supabase = createServiceClient();
  const { data: rows, error } = await supabase
    .from('post_queue')
    .select('*')
    .eq('status', 'posted')
    .gte('posted_at', start)
    .lt('posted_at', end);

  if (error) {
    return NextResponse.json({ error: `조회 실패: ${error.message}` }, { status: 500 });
  }

  const urls = new Set();
  for (const row of rows || []) {
    for (const m of buildMediaFromRow(row)) {
      if (m.url) urls.add(m.url);
    }
  }

  let totalBytes = 0;
  let checked = 0;
  let failed = 0;
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      const len = res.headers.get('content-length');
      if (res.ok && len) {
        totalBytes += parseInt(len, 10);
        checked++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return NextResponse.json({
    ok: true,
    date_kst: start.slice(0, 10),
    postedCount: (rows || []).length,
    fileCount: urls.size,
    checkedFiles: checked,
    failedFiles: failed,
    totalBytes,
    totalMB: Math.round((totalBytes / 1024 / 1024) * 100) / 100,
  });
}
