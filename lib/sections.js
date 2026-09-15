// moveout-checklist.html의 SECTIONS를 그대로 옮긴 것(2026-09-15 추출). 항목 텍스트·
// 표준가·책임소재 로직은 이 파일이 유일한 원본이 되고, 예전 아티팩트는 더 이상 건드리지
// 않는다 — 앞으로 항목 문구·표준가를 고칠 땐 여기(lib/sections.json)만 고치면 된다.
import SECTIONS from './sections.json';

export { SECTIONS };

export function findSection(id) {
  return SECTIONS.find(function (s) { return s.id === id; });
}
