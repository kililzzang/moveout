// 표준가 "팀 전체 학습" — 예전 아티팩트의 computeLearnedStat/getLearnedStat을 그대로 옮긴 것.
// price_history 테이블(팀원 전체가 실제 하자에 매긴 금액 기록)에서 항목명(label) 기준으로
// 최빈값을 뽑아, SECTIONS에 박아둔 고정 표준가(seedStd)보다 우선한다 — 실제 청구 사례가
// 쌓일수록 그 항목의 표준가가 팀 전체 기준으로 자동 갱신되는 효과.
export async function fetchLearnedStats(supabase) {
  const { data, error } = await supabase.from('price_history').select('label, amount');
  if (error || !data) return {};
  const byLabel = {};
  data.forEach((r) => {
    if (!byLabel[r.label]) byLabel[r.label] = [];
    byLabel[r.label].push(r.amount);
  });
  const stats = {};
  Object.keys(byLabel).forEach((label) => {
    const freq = {};
    byLabel[label].forEach((v) => { freq[v] = (freq[v] || 0) + 1; });
    let bestVal = byLabel[label][0], bestCount = 0;
    Object.keys(freq).forEach((k) => {
      if (freq[k] > bestCount) { bestCount = freq[k]; bestVal = Number(k); }
    });
    stats[label] = { std: bestVal, count: byLabel[label].length };
  });
  return stats;
}

// 점검을 저장할 때 이번 회차에 하자로 표시하고 금액을 적은 항목들을 학습 기록으로 쌓는다.
export async function addPriceHistoryRecords(supabase, state, SECTIONS) {
  const records = [];
  const ts = new Date().toISOString();
  function uidLocal() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  SECTIONS.forEach((sec) => {
    sec.items.forEach((it, idx) => {
      const st = state.items[sec.id + ':' + idx];
      const amt = parseInt(st.amount, 10) || 0;
      if (st.status === 'bad' && amt > 0) {
        records.push({ id: uidLocal(), label: it.l, amount: amt, responsibility: st.responsibility || '', ts });
      }
    });
    (state.custom[sec.id] || []).forEach((c) => {
      const amt2 = parseInt(c.amount, 10) || 0;
      if (c.status === 'bad' && amt2 > 0) {
        records.push({ id: uidLocal(), label: c.label, amount: amt2, responsibility: c.responsibility || '', ts });
      }
    });
  });
  if (!records.length) return;
  await supabase.from('price_history').insert(records).catch(() => {});
}
