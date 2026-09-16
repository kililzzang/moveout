import { NextResponse } from 'next/server';
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from '../../../lib/session';
import { createServiceClient } from '../../../lib/supabaseServer';
import { buildMediaFromRow, buildDefectSummaryLines } from '../../../lib/postMedia';
import { buildArchiveHtml, buildArchivePdf, buildArchiveDocx } from '../../../lib/archive';

// 가장 최근 게시된 건을 PDF/HTML/DOCX 샘플로 만들어보는 실험용 라우트.
// ?format=pdf|html|docx 로 고른다. 확인 끝나면 지워도 된다.
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

  // 자정(KST)이 지나면 "오늘"이 비어서 샘플을 못 만드니, 그냥 가장 최근
  // 게시된 건 하나를 쓴다(날짜 제한 없음) — 확인용 샘플이라 상관없다.
  const supabase = createServiceClient();
  const { data: rows, error } = await supabase.from('post_queue').select('*').limit(20);

  if (error) {
    return NextResponse.json({ error: `조회 실패: ${error.message}` }, { status: 500 });
  }
  if (searchParams.get('debug') === '1') {
    return NextResponse.json({
      count: rows?.length || 0,
      rows: (rows || []).map((r) => ({ id: r.id, status: r.status, posted_at: r.posted_at, title: r.title })),
    });
  }
  const posted = (rows || []).filter((r) => r.status === 'posted' && r.posted_at);
  posted.sort((a, b) => new Date(b.posted_at) - new Date(a.posted_at));
  const row = posted[0] || rows?.[0];
  if (!row) {
    return NextResponse.json({ error: '게시된 건이 없어요.' }, { status: 404 });
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

    // 브라우저로 큰 파일을 직접 다운로드하면(특히 사진 전체 포함) 중간에
    // 끊기거나 이상한 임시파일로 남는 문제가 있어서, ?upload=1이면 다운로드
    // 대신 Supabase Storage에 올리고 공개 URL을 돌려준다 — 그 URL은 그냥
    // curl로 바로 받을 수 있다. 확인용 임시 파일이라 나중에 지워야 한다.
    if (searchParams.get('upload') === '1') {
      const path = `_archive_samples/${Date.now()}-sample.${format}`;
      const { error: uploadErr } = await supabase.storage.from('photos').upload(path, fileBuf, {
        contentType: MIME[format],
      });
      if (uploadErr) throw uploadErr;
      const { data } = supabase.storage.from('photos').getPublicUrl(path);
      return NextResponse.json({ ok: true, path, url: data.publicUrl, bytes: fileBuf.length });
    }

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
