import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../lib/supabaseServer';

// 매일 한 번 Vercel Cron이 이 경로를 호출해서(vercel.json 설정), 네이버웍스에 이미
// 게시 완료(post_queue.status = 'posted')된 지 GRACE_DAYS일 지난 점검 기록의 사진과
// DB 행을 자동으로 지운다 -- Supabase 무료 플랜 용량(DB 500MB, 파일 저장소 1GB)을
// 아끼기 위함. '게시 완료' 표시 자체는 아직 이 앱이 스스로 하지 않고(실제 게시는
                                            // 여전히 브라우저 자동화로 진행), 게시를 마칠 때마다 post_queue 행의 status를
// 'posted'로, posted_at을 그 시각으로 수동 갱신해줘야 이 정리가 작동한다.
export const dynamic = 'force-dynamic';

const GRACE_DAYS = 1;

export async function GET(request) {
    // Vercel Cron이 보내는 요청인지 최소한으로 확인한다(민감한 삭제가 아니라 '이미
  // 게시 완료된 지 하루 지난 것'만 지우는 낮은 위험 작업이라 이 정도로 충분하다고
                                          // 판단 -- 더 엄격하게 하려면 CRON_SECRET 환경변수를 추가하면 된다).
    const ua = request.headers.get('user-agent') || '';
    if (!ua.includes('vercel-cron')) {
          return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
        }

    const supabase = createServiceClient();
    const cutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: posted, error } = await supabase
      .from('post_queue')
      .select('id')
      .eq('status', 'posted')
      .lt('posted_at', cutoff);

    if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

    const deletedIds = [];
    for (const row of posted || []) {
          const id = row.id;
          // 사진은 photos/<id>/ 아래에 올라온다는 규칙(체크리스트 화면 이식 시 이 규칙을
                                               // 그대로 따라야 함) -- 그 폴더를 통째로 비운다.
          const { data: files } = await supabase.storage.from('photos').list(id);
          if (files && files.length) {
                  const paths = files.map(function (f) { return id + '/' + f.name; });
                  await supabase.storage.from('photos').remove(paths);
                }
          await supabase.from('inspections').delete().eq('id', id);
          await supabase.from('post_queue').delete().eq('id', id);
          deletedIds.push(id);
        }

    return NextResponse.json({ deleted: deletedIds.length, ids: deletedIds });
  }
