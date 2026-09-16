// 2026-09-16 신설 — 클라이언트 저장 지점(점검 저장/배정/완료처리)에서 부르는 얇은
// 헬퍼. 실패해도 저장 자체는 이미 끝난 뒤라 막지 않는다 — 노션 동기화는 부가
// 기능이라 여기서 실패해도 사용자에게는 방해가 안 되게 console에만 남긴다.
export function syncOrderToNotion(orderId) {
  if (!orderId) return;
  fetch('/api/notion-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId }),
  }).catch((err) => console.error('노션 동기화 요청 실패:', err));
}
