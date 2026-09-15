// 이전 점검 이력 조회 — 정적 게시판 스냅샷(unit_history 테이블)과 이 앱에 실시간으로
// 저장된 점검(inspections 테이블) 중 더 최근 날짜인 것 하나만 돌려준다. moveout-checklist.html의
// findUnitHistory + fetchLiveHistoryForUnit + getLatestHistoryEntry를 Supabase 버전으로 합친 것.
export async function fetchLatestHistoryEntry(supabase, building, unit) {
  const b = (building || '').trim();
  const u = (unit || '').trim();
  if (!b || !u) return null;

  const [{ data: staticRows }, { data: liveRows }] = await Promise.all([
    supabase.from('unit_history').select('entries').eq('building', b).eq('unit', u).limit(1),
    supabase.from('inspections').select('date, items').eq('building', b).eq('unit', u).limit(1),
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
    };
  }

  if (live && (!staticLatest || (live.d || '') >= (staticLatest.d || ''))) return live;
  return staticLatest;
}
