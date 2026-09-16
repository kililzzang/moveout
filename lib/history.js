// 이전 점검 이력 조회 — 정적 게시판 스냅샷(unit_history 테이블)과 이 앱에 실시간으로
// 저장된 점검(inspections 테이블) 중 더 최근 날짜인 것 하나만 돌려준다. moveout-checklist.html의
// findUnitHistory + fetchLiveHistoryForUnit + getLatestHistoryEntry를 Supabase 버전으로 합친 것.
export async function fetchLatestHistoryEntry(supabase, building, unit) {
  const b = (building || '').trim();
  const u = (unit || '').trim();
  if (!b || !u) return null;

  const [{ data: staticRows }, { data: liveRows }] = await Promise.all([
    supabase.from('unit_history').select('entries').eq('building', b).eq('unit', u).limit(1),
    supabase.from('inspections').select('id, date, items').eq('building', b).eq('unit', u).limit(1),
  ]);

  const staticEntries = staticRows && staticRows[0] ? staticRows[0].entries : [];
  const staticLatest = staticEntries.length ? staticEntries[staticEntries.length - 1] : null;

  let live = null;
  if (liveRows && liveRows[0]) {
    const row = liveRows[0];
    live = {
      d: row.date || '',
      co: 1, // 이 도구는 퇴실점검 전용이라 저장된 점검은 항상 퇴실 기록
      i: (row.items || []).map((it) => [it.label + (it.note ? ' ' + it.note : ''), it.amount || null]),
      // 2026-09-16: 이 점검(inspections)의 id를 같이 돌려준다 — 하자보수 완료내역을
      // 보여주려면 work_orders.unit_key로 다시 조회해야 하는데, 그때 이 id가
      // 조인 키가 된다(fetchRepairHistoryForUnitKey 참고). 정적 스냅샷(unit_history)
      // 쪽엔 대응하는 work_orders가 없으니 id를 안 준다.
      id: row.id,
    };
  }

  if (live && (!staticLatest || (live.d || '') >= (staticLatest.d || ''))) return live;
  return staticLatest;
}

// 2026-09-16: "이전 점검 때 있었던 하자가 실제로 보수됐는지" 보여주기 위한 조회 —
// historyEntry.id(직전 점검의 inspections.id)로 그 점검이 만든 work_orders 행을
// 찾아 repair_items(항목별 완료 여부)를 돌려준다. 같은 unit_key로 여러 번
// 점검·저장했을 수 있어 최신 것 하나만 쓴다. work_orders가 아예 없으면(구버전
// 데이터, 또는 아직 안 만들어졌으면) null — 호출부는 "연동된 데이터 없음"으로
// 처리하면 된다.
export async function fetchRepairHistoryForUnitKey(supabase, unitKey) {
  if (!unitKey) return null;
  const { data, error } = await supabase
    .from('work_orders')
    .select('repair_status, repair_items, repair_completed_at')
    .eq('unit_key', unitKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}
