// 2026-09-17 신설 — 관리자 클립보드 "담당자 자동 배정"(박길일님 요청). 여러 기준을
// 팀이 원하는 만큼 켜고 끄고 가중치를 조절해서 조합할 수 있게 만들었다("전부 고를
// 수 있게 하자" — 하나의 고정 알고리즘이 아니라 조합 가능한 점수 체계). 자동으로
// 배정을 확정하지 않는다 — 여기서 나온 결과는 항상 "추천"이고, 관리자가 화면에서
// 보고 "배정" 버튼을 눌러야 실제로 저장된다(app_settings 테이블 참고).
//
// 각 기준은 후보자(candidate)마다 0~1 사이 점수를 매기고(높을수록 그 기준에서 더
// 적합), 켜져 있는 기준들의 가중 평균을 최종 점수로 쓴다. 새 기준을 추가하려면
// CRITERIA에 항목 하나만 더 추가하면 된다.

export const DEFAULT_AUTO_ASSIGN_SETTINGS = {
  criteria: {
    workload: { enabled: true, weight: 30 },
    route: { enabled: true, weight: 20 },
    personWeight: { enabled: true, weight: 15 },
    dueSoonAvoid: { enabled: true, weight: 15 },
    rotation: { enabled: true, weight: 10 },
    rejectionAvoid: { enabled: false, weight: 5 },
    random: { enabled: false, weight: 5 },
  },
};

export const CRITERIA_LABELS = {
  workload: { label: '업무량 균형', hint: '지금 진행중·응답대기 건수가 적은 사람을 우선합니다.' },
  route: { label: '동선 최적화', hint: '같은 건물을 최근에 맡은 적 있는 사람을 우선합니다(이동 동선 절약).' },
  personWeight: { label: '특정인 가중치', hint: '팀원 관리에서 설정한 가중치가 높은 사람을 우선합니다.' },
  dueSoonAvoid: { label: '마감임박 회피', hint: '3일 안에 마감인 다른 작업이 많은 사람은 낮게 평가합니다.' },
  rotation: { label: '최근배정 회피', hint: '바로 직전에 배정받은 사람은 한 번 건너뛰어 돌아가면서 배정합니다.' },
  rejectionAvoid: { label: '최근거절 회피', hint: '거절 이력이 많은 사람은 낮게 평가합니다.' },
  random: { label: '랜덤', hint: '무작위성을 조금 섞어서 매번 똑같은 사람으로 쏠리지 않게 합니다.' },
};

const DUE_SOON_DAYS = 3;
const ROUTE_LOOKBACK_DAYS = 30;
const ACTIVE_STATUSES = ['assigned', 'in_progress'];

function daysFromNow(iso) {
  if (!iso) return Infinity;
  return (new Date(iso).getTime() - Date.now()) / 86400000;
}

function scoreWorkload(candidate, track, allOrders) {
  const active = allOrders.filter((o) => o[track.emailField] === candidate.email && ACTIVE_STATUSES.includes(o[track.statusField])).length;
  return 1 / (1 + active);
}

function scoreRoute(candidate, track, allOrders, buildingByUnitKey, targetBuilding) {
  if (!targetBuilding) return 0.5; // 건물 정보를 모르면 이 기준은 중립으로 둔다.
  const cutoff = Date.now() - ROUTE_LOOKBACK_DAYS * 86400000;
  const hasRecentSameBuilding = allOrders.some((o) => {
    if (o[track.emailField] !== candidate.email) return false;
    const b = buildingByUnitKey[o.unit_key];
    if (!b || b !== targetBuilding) return false;
    const status = o[track.statusField];
    if (ACTIVE_STATUSES.includes(status)) return true;
    return status === 'completed' && new Date(o.created_at).getTime() >= cutoff;
  });
  return hasRecentSameBuilding ? 1 : 0;
}

function scorePersonWeight(candidate, allCandidates) {
  const maxWeight = Math.max(1, ...allCandidates.map((c) => c.assign_weight || 1));
  return (candidate.assign_weight || 1) / maxWeight;
}

function scoreDueSoonAvoid(candidate, track, allOrders) {
  const soonCount = allOrders.filter((o) => {
    if (o[track.emailField] !== candidate.email) return false;
    if (!ACTIVE_STATUSES.includes(o[track.statusField])) return false;
    return daysFromNow(o[track.dueField]) <= DUE_SOON_DAYS;
  }).length;
  return 1 / (1 + soonCount);
}

function scoreRotation(candidate, track, allOrders) {
  // 각 후보의 "가장 최근에 이 트랙으로 배정된 시각"을 비교해서, 가장 최근인 사람만
  // 낮게 평가한다(assigned_at 컬럼이 없어서 work_order의 created_at으로 근사).
  const lastAssignedAt = {};
  allOrders.forEach((o) => {
    const email = o[track.emailField];
    if (!email || o[track.statusField] === 'rejected') return;
    const t = new Date(o.created_at).getTime();
    if (!lastAssignedAt[email] || t > lastAssignedAt[email]) lastAssignedAt[email] = t;
  });
  const times = Object.values(lastAssignedAt);
  if (!times.length) return 1;
  const mostRecent = Math.max(...times);
  return lastAssignedAt[candidate.email] === mostRecent ? 0 : 1;
}

function scoreRejectionAvoid(candidate, track, allOrders) {
  const rejections = allOrders.filter((o) => o[track.emailField] === candidate.email && o[track.statusField] === 'rejected').length;
  return 1 / (1 + rejections);
}

const CRITERIA = {
  workload: (candidate, ctx) => scoreWorkload(candidate, ctx.track, ctx.allOrders),
  route: (candidate, ctx) => scoreRoute(candidate, ctx.track, ctx.allOrders, ctx.buildingByUnitKey, ctx.targetBuilding),
  personWeight: (candidate, ctx) => scorePersonWeight(candidate, ctx.candidates),
  dueSoonAvoid: (candidate, ctx) => scoreDueSoonAvoid(candidate, ctx.track, ctx.allOrders),
  rotation: (candidate, ctx) => scoreRotation(candidate, ctx.track, ctx.allOrders),
  rejectionAvoid: (candidate, ctx) => scoreRejectionAvoid(candidate, ctx.track, ctx.allOrders),
  random: () => Math.random(),
};

// candidates: 이 트랙 역할을 가진 팀원 목록. track: TRACKS 항목 하나. allOrders: 전체
// work_orders. buildingByUnitKey: {unit_key: building}. targetBuilding: 지금 배정할
// 호실의 건물명. settings: DEFAULT_AUTO_ASSIGN_SETTINGS 모양.
// 반환값: [{ candidate, score, breakdown }] 점수 높은 순으로 정렬.
export function suggestAssignees({ candidates, track, allOrders, buildingByUnitKey, targetBuilding, settings }) {
  const criteria = (settings && settings.criteria) || DEFAULT_AUTO_ASSIGN_SETTINGS.criteria;
  const enabled = Object.entries(criteria).filter(([, c]) => c && c.enabled && c.weight > 0);
  const totalWeight = enabled.reduce((s, [, c]) => s + c.weight, 0);

  const ctx = { track, allOrders, buildingByUnitKey, targetBuilding, candidates };

  const ranked = candidates.map((candidate) => {
    const breakdown = {};
    let score = 0;
    if (totalWeight > 0) {
      enabled.forEach(([key, c]) => {
        const fn = CRITERIA[key];
        const raw = fn ? fn(candidate, ctx) : 0;
        breakdown[key] = raw;
        score += (raw * c.weight) / totalWeight;
      });
    }
    return { candidate, score, breakdown };
  });

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}
