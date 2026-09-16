import { NextResponse } from 'next/server';
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from '../../../lib/session';
import { createServiceClient } from '../../../lib/supabaseServer';
import { buildMediaFromRow, buildDefectSummaryLines } from '../../../lib/postMedia';
import { buildArchiveHtml, buildArchivePdf, buildArchiveDocx } from '../../../lib/archive';

// 오늘 게시된 것 중 가장 최근 건을 PDF/HTML/DOCX 샘플로 만들어보는 실험용
// 라우트. ?format=pdf|html|docx 로 고른다. 확인 끝나면 지워도 된다.
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

const MIME = { pdf: 'application/pdf', html: 'text/html; charset=utf-8', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

export async function GET(request) {
  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionCookieValue(cookieValue);
  if (!session) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') || 'pdf';
  if (!MIME[format]) {
    return NextResponse.json({ error: 'format은 pdf, html, docx 중 하나여야 해요.' }, { status: 400 });
  }

  const { start, end } = todayRangeKST();
  const supabase = createServiceClient();
  const { data: rows, error } = await supabase
    .from('post_queue')
    .select('*')
    .eq('status', 'posted')
    .gte('posted_at', start)
    .lt('posted_at', end)
    .order('posted_at', { ascending: false })
    .limit(1);

  if (error) {
    return NextResponse.json({ error: `조회 실패: ${error.message}` }, { status: 500 });
  }
  const row = rows?.[0];
  if (!row) {
    return NextResponse.json({ error: '오늘 게시된 건이 없어요.' }, { status: 404 });
  }

  // 샘플 확인용이라 사진을 전부 원본 화질로 박아 넣으면 파일이 수십 MB로
  // 커진다(실사용 시엔 문제 없지만 지금은 그냥 형태만 보면 되므로) — 개수를
  // 제한한다. ?limit=0 이면 전체.
  const limit = parseInt(searchParams.get('limit') ?? '6', 10);
  const fullMedia = buildMediaFromRow(row);
  const media = limit > 0 ? fullMedia.slice(0, limit) : fullMedia;
  const defectSummaryLines = buildDefectSummaryLines(row);
  const args = { title: row.title, bodyText: row.body, media, defectSummaryLines };

  try {
    let fileBuf;
    if (format === 'pdf') fileBuf = await buildArchivePdf(args);
    else if (format === 'docx') fileBuf = await buildArchiveDocx(args);
    else fileBuf = Buffer.from(await buildArchiveHtml(args), 'utf-8');

    const safeTitle = (row.title || 'report').replace(/[^A-Za-z0-9가-힣_.\-]/g, '_').slice(0, 60);
    return new NextResponse(fileBuf, {
      headers: {
        'Content-Type': MIME[format],
        'Content-Disposition': `attachment; filename="${encodeURIComponent(safeTitle)}.${format}"`,
      },
    });
  } catch (err) {
    console.error('보관용 파일 생성 실패:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
