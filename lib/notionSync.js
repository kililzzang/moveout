import { Client } from '@notionhq/client';

// 2026-09-16 신설 — 노션팀이 만든 관리자 워크스페이스(작업관리/호실/건물/담당자 DB)와
// work_orders를 동기화한다. 노션팀 가이드대로, 이 시크릿을 쓰는 클라이언트-호출 가능한
// 공개 라우트는 만들지 않는다 — 저장 지점(handleSaveReport, 관리자 배정, 완료처리)에서
// 서버 사이드로만 이 함수를 호출한다.
const notion = new Client({ auth: process.env.NOTION_INTERNAL_INTEGRATION_SECRET });

const WORK_ORDER_DS_ID = '06ed96f7-fea7-47ac-9466-e245e65e9ceb';
const ROOM_DS_ID = 'b176d099-6d80-4854-bf0c-445452419f35';
const BUILDING_DS_ID = '766c806a-d655-4627-9ab3-570d3fb10913';
const ASSIGNEE_DS_ID = '59021a65-aaf5-40e7-a599-c06f10128da5';

// unitDocId/sanitizeUnitKey와 동일한 알고리즘(lib/checklistState.js) — 노션팀에
// 공유한 스펙 그대로. work_orders.unit_key를 그대로 넘기면 이 계산은 필요 없다.
function computeUnitKey(building, room) {
  const raw = `${building.trim()}_${room.trim()}`;
  let h = 5381;
  for (let i = 0; i < raw.length; i += 1) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
  const hash = h.toString(36);
  let ascii = raw.replace(/[^A-Za-z0-9_\-.~:@+]/g, '');
  if (!ascii) ascii = 'u';
  return `${ascii}-${hash}`.slice(0, 200);
}

const OVERALL_STATUS_MAP = { received: '접수', inspecting: '점검중', inspected: '점검완료', processing: '처리중', billing_pending: '청구대기', completed: '완료' };
const INSPECTION_STATUS_MAP = { assigned: '배정됨', rejected: '거절', in_progress: '진행중', completed: '완료' };
const REPAIR_STATUS_MAP = { not_applicable: '해당없음', assigned: '배정됨', rejected: '거절', waiting: '대기', in_progress: '진행중', completed: '완료' };
const CLEANING_STATUS_MAP = { assigned: '배정됨', rejected: '거절', waiting: '대기', in_progress: '진행중', completed: '완료' };
const PAYMENT_STATUS_MAP = { unbilled: '미청구', billed: '청구완료', paid: '입금완료' };

async function findRoomPageId(unitKey) {
  if (!unitKey) return null;
  const res = await notion.dataSources.query({ data_source_id: ROOM_DS_ID, filter: { property: 'unit_key', rich_text: { equals: unitKey } } });
  return res.results[0]?.id ?? null;
}

async function findOrCreateBuildingPageId(buildingName) {
  if (!buildingName) return null;
  const res = await notion.dataSources.query({ data_source_id: BUILDING_DS_ID, filter: { property: '이름', title: { equals: buildingName } } });
  if (res.results[0]) return res.results[0].id;
  const page = await notion.pages.create({ parent: { data_source_id: BUILDING_DS_ID }, properties: { 이름: { title: [{ text: { content: buildingName } }] } } });
  return page.id;
}

const relationProp = (id) => ({ relation: id ? [{ id }] : [] });

async function findOrCreateRoomPageId({ building, room, unitKey }) {
  const key = unitKey || (building && room ? computeUnitKey(building, room) : null);
  if (!key) return null;
  const existing = await findRoomPageId(key);
  if (existing) return existing;
  if (!building || !room) return null;
  const buildingPageId = await findOrCreateBuildingPageId(building);
  const page = await notion.pages.create({
    parent: { data_source_id: ROOM_DS_ID },
    properties: {
      '건물|호실': { title: [{ text: { content: `${building}|${room}` } }] },
      unit_key: { rich_text: [{ text: { content: key } }] },
      건물: relationProp(buildingPageId),
    },
  });
  return page.id;
}

async function findAssigneePageId(email) {
  if (!email) return null;
  const res = await notion.dataSources.query({ data_source_id: ASSIGNEE_DS_ID, filter: { property: '이메일', email: { equals: email } } });
  return res.results[0]?.id ?? null;
}

const dateProp = (v) => ({ date: v ? { start: v } : null });
const selectProp = (v) => ({ select: v ? { name: v } : null });

function itemsToMarkdown(title, items) {
  if (!items?.length) return '';
  const lines = items.map((it) => {
    const amountValue = it.actual_amount ?? it.amount;
    return `- [${it.done ? 'x' : ' '}] ${it.label}${it.note ? ` — ${it.note}` : ''}${amountValue ? ` (${Number(amountValue).toLocaleString()}원)` : ''}${it.done_note ? `\n  ↳ ${it.done_note}` : ''}${it.photo_url ? `\n  📷 ${it.photo_url}` : ''}`;
  });
  return `\n\n**${title}**\n${lines.join('\n')}`;
}

function markdownToBlocks(md) {
  return md.split('\n').filter((l) => l.trim()).map((line) => {
    if (line.startsWith('- [')) return { object: 'block', type: 'to_do', to_do: { rich_text: [{ text: { content: line.slice(6).trim() } }], checked: line[3] === 'x' } };
    if (line.startsWith('**') && line.endsWith('**')) return { object: 'block', type: 'heading_3', heading_3: { rich_text: [{ text: { content: line.replace(/\*\*/g, '') } }] } };
    return { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: line } }] } };
  });
}

async function appendReplacingBody(pageId, bodyMd) {
  const children = await notion.blocks.children.list({ block_id: pageId });
  await Promise.all(children.results.map((b) => notion.blocks.delete({ block_id: b.id })));
  await notion.blocks.children.append({ block_id: pageId, children: markdownToBlocks(bodyMd) });
}

// wo: work_orders 행 + building/room(보통 inspections 조회로 채움). 반환값은 노션
// 페이지 id — 새로 만들어졌다면 호출 측에서 work_orders.notion_page_id에 저장해야
// 다음 호출부터 새로 만들지 않고 그 페이지를 갱신한다.
export async function syncWorkOrderToNotion(wo) {
  const [roomPageId, inspectorPageId, repairPageId, cleaningPageId] = await Promise.all([
    findOrCreateRoomPageId({ building: wo.building, room: wo.room, unitKey: wo.unit_key }),
    findAssigneePageId(wo.inspector_email),
    findAssigneePageId(wo.repair_email),
    findAssigneePageId(wo.cleaning_email),
  ]);
  const properties = {
    이름: { title: [{ text: { content: wo.title || wo.unit_key || 'work order' } }] },
    호실: relationProp(roomPageId),
    전체상태: selectProp(OVERALL_STATUS_MAP[wo.overall_status]),
    점검상태: selectProp(INSPECTION_STATUS_MAP[wo.inspection_status]),
    점검자: relationProp(inspectorPageId),
    점검마감기한: dateProp(wo.inspection_due_at),
    점검거절사유: { rich_text: wo.inspection_reject_reason ? [{ text: { content: wo.inspection_reject_reason } }] : [] },
    점검완료일: dateProp(wo.inspection_completed_at),
    보수상태: selectProp(REPAIR_STATUS_MAP[wo.repair_status]),
    보수자: relationProp(repairPageId),
    보수마감기한: dateProp(wo.repair_due_at),
    보수거절사유: { rich_text: wo.repair_reject_reason ? [{ text: { content: wo.repair_reject_reason } }] : [] },
    보수완료일: dateProp(wo.repair_completed_at),
    청소상태: selectProp(CLEANING_STATUS_MAP[wo.cleaning_status]),
    청소자: relationProp(cleaningPageId),
    청소마감기한: dateProp(wo.cleaning_due_at),
    청소거절사유: { rich_text: wo.cleaning_reject_reason ? [{ text: { content: wo.cleaning_reject_reason } }] : [] },
    청소완료일: dateProp(wo.cleaning_completed_at),
    청구금액: { number: wo.invoice_amount ?? null },
    입금상태: selectProp(PAYMENT_STATUS_MAP[wo.payment_status]),
    입금일: dateProp(wo.paid_at),
    접수사진링크: { url: wo.photo_url ?? null },
  };
  const bodyMd = [
    wo.repair_note ? `**보수 메모**\n${wo.repair_note}` : '',
    itemsToMarkdown('보수 항목', wo.repair_items),
    wo.cleaning_note ? `**청소 메모**\n${wo.cleaning_note}` : '',
    itemsToMarkdown('청소 체크리스트', wo.cleaning_items),
    itemsToMarkdown('청소 중 신규 발견 하자', wo.cleaning_found_defects),
  ].filter(Boolean).join('\n\n');

  if (wo.notion_page_id) {
    await notion.pages.update({ page_id: wo.notion_page_id, properties });
    if (bodyMd) await appendReplacingBody(wo.notion_page_id, bodyMd);
    return wo.notion_page_id;
  }
  const page = await notion.pages.create({ parent: { data_source_id: WORK_ORDER_DS_ID }, properties, children: bodyMd ? markdownToBlocks(bodyMd) : [] });
  return page.id;
}
