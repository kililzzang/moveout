// moveout-checklist.html의 리포트·네이버웍스 게시 조립 로직을 그대로 옮긴 순수 함수
// 모음. 원본은 전역 state/UNIT_HISTORY 클로저를 썼지만, 여기서는 전부 인자로 받는다
// (Supabase 조회 같은 비동기 작업은 컴포넌트에서 먼저 끝내고, 그 결과만 넘겨준다).
import { SECTIONS } from './sections';

export function fmtWon(n) {
  n = parseInt(n, 10);
  if (!n || isNaN(n)) return '0';
  return n.toLocaleString('ko-KR');
}

// 2026-09-15: sections.json에 별도 "청소"(cleaning) 섹션이 생기면서(흡연 여부, 스티커
// 부착여부, 폐기물 여부, 추가 청소비용 여부, 반려동물 청소 여부 — 박길일님 요청으로
// 기존 다른 섹션에서 빼서 여기로 모았다), 이 5개 항목만 "청소" 비용으로, 그 외 하자는
// 전부 "유지보수" 비용으로 분류한다.
export function isCleaningCategory(label) {
  return /폐기물|스티커|부착물|흡연|반려동물|청소비용/.test(label || '');
}

export function formatDateKorean(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
  const dow = ['일', '월', '화', '수', '목', '금', '토'][new Date(y, m - 1, d).getDay()];
  return y + '.' + m + '.' + d + '(' + dow + ')';
}

export function numberCircled(n) {
  const circled = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
  return circled[n - 1] || '(' + n + ')';
}

// SECTIONS를 순회하며 현재 하자(status==='bad') 항목만 모아 금액 합계를 함께 낸다 —
// 여러 함수에서 반복되던 순회를 하나로 합쳤다(원본엔 없던 정리, 로직은 동일).
function forEachDefect(state, fn) {
  SECTIONS.forEach((sec) => {
    sec.items.forEach((it, idx) => {
      const st = state.items[sec.id + ':' + idx];
      if (st && st.status === 'bad') fn(it.l, st, sec);
    });
    (state.custom[sec.id] || []).forEach((c) => {
      if (c.status === 'bad') fn(c.label, c, sec);
    });
  });
}

export function collectIncompleteDefects(state) {
  const incomplete = [];
  function check(label, entry) {
    if (entry.status !== 'bad') return;
    const missing = [];
    const hasDefectPhoto = (entry.photos || []).some((p) => p.isDefect);
    if (!hasDefectPhoto) missing.push('하자사진');
    if (!(entry.note && entry.note.trim())) missing.push('비고');
    if (!(parseInt(entry.amount, 10) > 0)) missing.push('금액');
    if (missing.length) incomplete.push(label + '(' + missing.join('·') + ' 없음)');
  }
  SECTIONS.forEach((sec) => {
    sec.items.forEach((it, idx) => check(it.l, state.items[sec.id + ':' + idx]));
    (state.custom[sec.id] || []).forEach((c) => check(c.label, c));
  });
  return incomplete;
}

// 팀 공유용 "공식양식" 리포트 텍스트(지금 "리포트 저장·복사"가 클립보드에 복사하는 것) —
// 네이버웍스 확정양식과는 별개로, 점검원이 빠르게 훑어보는 요약 텍스트다.
export function buildOfficialFormReport(state, latestEntry) {
  const lines = [];
  lines.push('■ 퇴실점검 리포트');
  lines.push('건물명: ' + (state.info.building || '-'));
  lines.push('호실: ' + (state.info.unit || '-'));
  lines.push('점검일: ' + (state.info.date || '-') + ' ' + (state.info.checkTime || ''));
  lines.push('담당자: ' + (state.info.inspector || '-'));
  lines.push('');
  lines.push('[하자 내역]');

  let maintenanceTotal = 0, cleaningCategoryTotal = 0;
  const defectLines = [];
  forEachDefect(state, (label, st) => {
    const amt = parseInt(st.amount, 10) || 0;
    if (isCleaningCategory(label)) cleaningCategoryTotal += amt; else maintenanceTotal += amt;
    defectLines.push(label + (amt ? '(' + fmtWon(amt) + ')' : '') + (st.note ? ' - ' + st.note : '') + ((st.photos || []).length ? ' [사진 ' + st.photos.length + '장]' : ''));
  });
  lines.push(...(defectLines.length ? defectLines : ['특이사항 없음']));
  lines.push('');
  // 2026-09-15: "청소 추가금액" 수동입력 필드는 삭제(박길일님 요청) — 이제 청소비용은
  // 하자 항목 중 청소 카테고리(isCleaningCategory)만 그대로 합산한 값이다. 예전엔
  // 여기서 maintenanceTotal에서 cleaningCategoryTotal을 한 번 더 빼고 있었는데,
  // maintenanceTotal은 애초에 청소 카테고리를 빼고 쌓은 값이라 이중으로 빼지는
  // 버그였다 — 같이 고쳤다. 청소/보수를 나눠 보여주고, 총 비용도 함께 표기한다.
  lines.push('청소 ' + (cleaningCategoryTotal ? fmtWon(cleaningCategoryTotal) : 'X'));
  lines.push('보수 ' + fmtWon(maintenanceTotal));
  lines.push('총 비용 ' + fmtWon(cleaningCategoryTotal + maintenanceTotal));
  lines.push('');
  lines.push('기타사항: ' + (state.finalNote && state.finalNote.trim() ? state.finalNote.trim() : '-'));

  if (latestEntry) {
    lines.push('');
    lines.push('※ 이 호실 이전 점검 이력 (최근 1건, 참고용)');
    const itemsStr = latestEntry.i.map((it) => it[0] + (it[1] ? '(' + fmtWon(it[1]) + '원)' : '')).join(' / ');
    lines.push(latestEntry.d + (latestEntry.co ? ' 퇴실' : ' 입주확인') + ': ' + (itemsStr || '특이사항 없음'));
  }
  return lines.join('\n');
}

// ---- naverworks-post-format.md 확정 양식 ----
export function buildNaverWorksTitle(state) {
  const addr = (state.info.jibunAddress || '').trim();
  const building = (state.info.building || '').trim();
  const unit = (state.info.unit || '').trim();
  const loc = [addr, building].filter(Boolean).join(' ');
  return '[ ' + loc + (unit ? ' ' + unit + '호' : '') + ' ] 퇴실 관리_체크완료_📸';
}

function buildCurrentDamageBlock(state) {
  const lines = [];
  lines.push(formatDateKorean(state.info.date) + (state.info.checkTime ? '  ' + state.info.checkTime : ''));
  let maintenanceTotal = 0, cleaningCategoryTotal = 0;
  SECTIONS.forEach((sec) => {
    const secLines = [];
    sec.items.forEach((it, idx) => {
      const st = state.items[sec.id + ':' + idx];
      if (st.status !== 'bad') return;
      const amt = parseInt(st.amount, 10) || 0;
      if (isCleaningCategory(it.l)) cleaningCategoryTotal += amt; else maintenanceTotal += amt;
      secLines.push('- ' + it.l + (st.note ? ' ' + st.note : '') + (amt ? ' (' + fmtWon(amt) + ')' : ''));
    });
    (state.custom[sec.id] || []).forEach((c) => {
      if (c.status !== 'bad') return;
      const amt2 = parseInt(c.amount, 10) || 0;
      if (isCleaningCategory(c.label)) cleaningCategoryTotal += amt2; else maintenanceTotal += amt2;
      secLines.push('- ' + c.label + (c.note ? ' ' + c.note : '') + (amt2 ? ' (' + fmtWon(amt2) + ')' : ''));
    });
    if (secLines.length) { lines.push(sec.title); lines.push(...secLines); }
  });
  return {
    text: lines.join('\n'),
    cleaningTotal: cleaningCategoryTotal,
    maintenanceTotal,
  };
}

export function buildDamageSection(state, latestEntry) {
  const current = buildCurrentDamageBlock(state);
  const blocks = [];
  if (latestEntry) {
    const itemsStr = latestEntry.i.map((it) => it[0] + (it[1] ? '(' + fmtWon(it[1]) + '원)' : '')).join('\n');
    blocks.push(latestEntry.d + '\n' + itemsStr);
  }
  blocks.push(current.text);
  let out = blocks.join('\n\n');
  out += '\n청소 ' + (current.cleaningTotal ? fmtWon(current.cleaningTotal) : 'X');
  out += '\n보수 ' + fmtWon(current.maintenanceTotal);
  out += '\n총 비용 ' + fmtWon(current.cleaningTotal + current.maintenanceTotal);
  return out;
}

export function buildNaverWorksBody(state, latestEntry) {
  const addr = (state.info.jibunAddress || '').trim();
  const building = (state.info.building || '').trim();
  const unit = (state.info.unit || '').trim();
  const lines = [];
  lines.push('1. 퇴실관리 주소및 세대/호수');
  lines.push([addr, building, unit ? unit + '호' : ''].filter(Boolean).join(' '));
  lines.push('');
  lines.push('2. 퇴실관리 현장체크 날짜');
  lines.push(formatDateKorean(state.info.date) + (state.info.checkTime ? '  ' + state.info.checkTime : ''));
  lines.push('');
  lines.push('3. 퇴실관리 형태체크');
  lines.push('퇴실');
  lines.push('');
  lines.push('4. 파손사항 체크');
  lines.push(buildDamageSection(state, latestEntry));
  lines.push('');
  lines.push('5. 점검후 수리 내역');
  lines.push('-');
  lines.push('');
  lines.push('6. 기타사항');
  lines.push(state.finalNote && state.finalNote.trim() ? state.finalNote.trim() : '-');
  return lines.join('\n');
}

// 사진 순서 계획: 일반사진(SECTIONS·항목 순서, 정상 포함) + 하자별 캡션·사진
// (항목당 번호 하나, 사진 여러 장이어도 번호는 안 늘어남).
export function buildAttachmentPlan(state) {
  const general = [];
  const defects = [];
  let n = 0;
  function handle(label, entry) {
    // 2026-09-15: 하자사진(isDefect)으로 올린 건 general에 중복으로 넣지 않는다 —
    // 예전엔 여기서 필터 없이 전부 general에 넣어서, 하자로 체크하고 올린 사진이
    // general(그냥 나열)과 defects(캡션 붙은 하자 사진) 양쪽에 두 번 실리고 있었다.
    (entry.photos || []).filter((p) => !p.isDefect).forEach((p) => {
      general.push({ url: p.url, contentType: p.contentType, label });
    });
    if (entry.status === 'bad') {
      n++;
      const amt = parseInt(entry.amount, 10) || 0;
      defects.push({
        n,
        mark: numberCircled(n),
        label,
        note: entry.note || '',
        amount: amt,
        caption: label + (entry.note ? ' - ' + entry.note : '') + (amt ? ' (' + fmtWon(amt) + '원)' : ''),
        photos: (entry.photos || []).filter((p) => p.isDefect),
      });
    }
  }
  SECTIONS.forEach((sec) => {
    sec.items.forEach((it, idx) => handle(it.l, state.items[sec.id + ':' + idx]));
    (state.custom[sec.id] || []).forEach((c) => handle(c.label, c));
  });
  return { general, defects };
}
