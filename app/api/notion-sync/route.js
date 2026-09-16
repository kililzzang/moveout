import { NextResponse } from 'next/server';
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from '../../../lib/session';
import { createServiceClient } from '../../../lib/supabaseServer';
import { syncWorkOrderToNotion } from '../../../lib/notionSync';

// 2026-09-16 신설 — 노션팀 보안 가이드에 따른 동기화 라우트: 클라이언트는 시크릿을
// 전혀 못 보고, 쓸 노션 속성값도 직접 못 보낸다("어느 work_order를 동기화할지"만
// orderId로 알려줄 뿐 — 실제 동기화할 값은 이 라우트가 서버에서 DB를 다시 읽어
// 만든다). 그래서 로그인만 확인하면 된다(관리자 권한까지 요구할 필요 없음 —
// 보수/청소 작업자가 완료 처리할 때도 이 라우트를 호출해야 하므로).
export async function POST(request) {
  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionCookieValue(cookieValue);
  if (!session) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const orderId = body.orderId;
  if (!orderId) {
    return NextResponse.json({ error: 'orderId가 필요합니다.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: order, error: orderError } = await supabase.from('work_orders').select('*').eq('id', orderId).maybeSingle();
  if (orderError || !order) {
    return NextResponse.json({ error: `작업을 찾을 수 없습니다: ${orderError?.message || 'not found'}` }, { status: 404 });
  }

  let building = null;
  let room = null;
  if (order.unit_key) {
    const { data: insp } = await supabase.from('inspections').select('building, unit').eq('id', order.unit_key).maybeSingle();
    building = insp?.building || null;
    room = insp?.unit || null;
  }

  try {
    const pageId = await syncWorkOrderToNotion({ ...order, building, room });
    if (pageId && pageId !== order.notion_page_id) {
      await supabase.from('work_orders').update({ notion_page_id: pageId }).eq('id', order.id);
    }
    return NextResponse.json({ ok: true, notionPageId: pageId });
  } catch (err) {
    console.error('노션 동기화 실패:', err);
    return NextResponse.json({ error: `노션 동기화 실패: ${err.message}` }, { status: 500 });
  }
}
