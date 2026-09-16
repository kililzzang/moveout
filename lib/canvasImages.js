// moveout-checklist.html의 buildChecklistImageV1/V2(캔버스로 그리는 점검결과표 이미지)를
// 그대로 옮긴 것 — 네이버웍스 게시글에 반드시 필요한 두 이미지. V1은 전체 항목표(종이
// 양식과 동일), V2는 하자만 책임소재별로 묶은 요약표. 브라우저에서만 동작(canvas 필요).
import { fmtWon, isCleaningCategory } from './report';

function truncateText(ctx, text, maxWidth) {
  text = text || '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

// buildHistorySummaryImage 전용 — 줄바꿈 문자(\n)와 폭 초과를 둘 다 처리해서 여러
// 줄로 쪼갠다(다른 캔버스 함수들은 한 줄씩만 다뤄서 truncateText로 충분했지만, 비고
// 란은 사용자가 자유롭게 여러 줄 쓸 수 있어서 새로 만들었다).
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  (text || '').split('\n').forEach((paragraph) => {
    if (!paragraph) { lines.push(''); return; }
    let line = '';
    for (const ch of paragraph) {
      const next = line + ch;
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line = next;
      }
    }
    lines.push(line);
  });
  return lines;
}

function dataURLtoFile(dataUrl, filename) {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new File([u8arr], filename, { type: mime });
}

const STATUS_LABEL = { ok: '정상', bad: '하자', na: '해당없음' };
const STATUS_COLOR = { ok: '#3F8F5F', bad: '#B23A26', na: '#8B98A0' };

export function buildChecklistImageV1(state, SECTIONS) {
  const col = { sec: 64, item: 200, status: 56, note: 280, amount: 110 };
  const pad = 20;
  const rowH = 26;
  const noteLineH = 15;
  const tableHeadH = 28;
  const totalW = pad * 2 + col.sec + col.item + col.status + col.note + col.amount;

  const rows = [];
  SECTIONS.forEach((sec) => {
    sec.items.forEach((it, idx) => {
      rows.push({ sec: sec.title, first: idx === 0, label: it.l, entry: state.items[sec.id + ':' + idx] });
    });
    (state.custom[sec.id] || []).forEach((c, cidx) => {
      rows.push({ sec: sec.title, first: sec.items.length === 0 && cidx === 0, label: c.label, entry: c });
    });
  });

  // 2026-09-16: 비고가 길면 한 줄로 잘려서 "…" 뒤 내용이 안 보이는 문제(박길일님 피드백,
  // 실사례: "국소 오염 1건 국소 도배 까짐 소 1건 : 10,000 국소 …"). 비고 칸만 여러 줄로
  // 줄바꿈하고, 그만큼 그 행의 높이를 늘린다. 줄바꿈 폭을 재려면 캔버스가 먼저 있어야
  // 하는데 캔버스 크기(canvasH)는 각 행 높이의 합이라 서로 맞물려서, 측정 전용 임시
  // 캔버스로 먼저 줄바꿈·행높이를 계산한 뒤에야 진짜 캔버스를 만든다
  // (buildHistorySummaryImage와 같은 방식).
  const ctxMeasure = document.createElement('canvas').getContext('2d');
  ctxMeasure.font = '12px sans-serif';
  const rowsWithHeight = rows.map((row) => {
    const noteLines = wrapText(ctxMeasure, row.entry.note || '', col.note - 16);
    return { ...row, noteLines, h: Math.max(rowH, noteLines.length * noteLineH + 10) };
  });
  const rowsH = rowsWithHeight.reduce((s, r) => s + r.h, 0);

  // footH 100: 기타사항 줄 + 청소/보수 줄 + 총 비용 줄, 세 줄이 들어갈 여유(2026-09-15
  // 청소/보수 분리 + 총 비용 줄 추가하면서 70 → 90으로, 이후 가독성 위해 글씨를
  // 키우면서(박길일님 요청) 90 → 100으로 다시 늘림 — 안 늘리면 마지막 줄이 잘림).
  const headH = 100, footH = 100;
  const canvasH = pad + headH + tableHeadH + rowsH + footH + pad;
  const canvas = document.createElement('canvas');
  const scale = 2;
  canvas.width = totalW * scale;
  canvas.height = canvasH * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, totalW, canvasH);
  ctx.textBaseline = 'middle';

  let y = pad;
  ctx.fillStyle = '#15202B';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('호실점검 CHECK LIST', pad, y + 12);
  y += 34;
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#57666F';
  ctx.fillText('건물명: ' + (state.info.building || '-') + '    호실: ' + (state.info.unit || '-') + '    점검일: ' + (state.info.date || '-'), pad, y);
  y += 18;
  ctx.fillText('세대비번: ' + (state.info.passcode || '-') + '    담당자: ' + (state.info.inspector || '-') + '    주차리모컨: ' + (state.info.parkingRemote || '-'), pad, y);
  y += 26;

  const headerRowY = y;
  const cols = [['구분', col.sec], ['하자내용', col.item], ['상태', col.status], ['비고', col.note], ['금액', col.amount]];
  let cx = pad;
  ctx.strokeStyle = '#8B98A0';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#15202B';
  cols.forEach((c) => {
    ctx.strokeRect(cx, headerRowY, c[1], tableHeadH);
    ctx.fillText(c[0], cx + 8, headerRowY + tableHeadH / 2);
    cx += c[1];
  });
  y = headerRowY + tableHeadH;

  ctx.font = '12px sans-serif';
  rowsWithHeight.forEach((row) => {
    const rh = row.h;
    cx = pad;
    ctx.strokeStyle = '#D3DCE0';
    ctx.fillStyle = '#15202B';
    ctx.strokeRect(cx, y, col.sec, rh);
    if (row.first) ctx.fillText(truncateText(ctx, row.sec, col.sec - 10), cx + 6, y + rh / 2);
    cx += col.sec;

    ctx.strokeRect(cx, y, col.item, rh);
    ctx.fillText(truncateText(ctx, row.label, col.item - 12), cx + 8, y + rh / 2);
    cx += col.item;

    ctx.strokeRect(cx, y, col.status, rh);
    const stLabel = STATUS_LABEL[row.entry.status] || '-';
    ctx.fillStyle = STATUS_COLOR[row.entry.status] || '#8B98A0';
    ctx.fillText(stLabel, cx + 12, y + rh / 2);
    ctx.fillStyle = '#15202B';
    cx += col.status;

    ctx.strokeRect(cx, y, col.note, rh);
    if (row.noteLines.length <= 1) {
      ctx.fillText(row.noteLines[0] || '', cx + 8, y + rh / 2);
    } else {
      const startY = y + (rh - row.noteLines.length * noteLineH) / 2 + noteLineH / 2;
      row.noteLines.forEach((line, i) => ctx.fillText(line, cx + 8, startY + i * noteLineH));
    }
    cx += col.note;

    ctx.strokeRect(cx, y, col.amount, rh);
    const amt = parseInt(row.entry.amount, 10) || 0;
    const amtTxt = amt ? fmtWon(amt) + '원' : '';
    const amtW = ctx.measureText(amtTxt).width;
    ctx.fillText(amtTxt, cx + col.amount - amtW - 8, y + rh / 2);

    y += rh;
  });

  y += 18;
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#15202B';
  ctx.fillText('기타사항: ' + truncateText(ctx, state.finalNote || '-', totalW - pad * 2 - 90), pad, y);
  y += 24;
  // 2026-09-15: "청소 추가금액" 수동입력 필드는 삭제하고, 대신 하자 금액을 청소/보수로
  // 나눠 보여준 뒤 합계(총 비용)까지 표기한다(박길일님 요청). 이후 가독성을 높이려고
  // 글씨를 키우고, 청소=파란색·보수=초록색·총비용=빨간색으로 색을 나눴다(박길일님
  // 요청) — 한 fillText 안에서는 색을 하나만 쓸 수 있어서, 세그먼트별로 폭을 재서
  // (measureText) 이어붙이는 식으로 그린다.
  let cleaningTotal = 0, maintenanceTotal = 0;
  rows.forEach((row) => {
    const amt = parseInt(row.entry.amount, 10) || 0;
    if (isCleaningCategory(row.label)) cleaningTotal += amt; else maintenanceTotal += amt;
  });
  ctx.font = 'bold 15px sans-serif';
  const cleaningTxt = '청소 ' + fmtWon(cleaningTotal) + '원';
  const sepTxt = '   ·   ';
  const maintenanceTxt = '보수 ' + fmtWon(maintenanceTotal) + '원';
  let cx3 = pad;
  ctx.fillStyle = '#2A5C8A'; // 청소 = 파란색
  ctx.fillText(cleaningTxt, cx3, y);
  cx3 += ctx.measureText(cleaningTxt).width;
  ctx.fillStyle = '#8B98A0';
  ctx.fillText(sepTxt, cx3, y);
  cx3 += ctx.measureText(sepTxt).width;
  ctx.fillStyle = '#3F8F5F'; // 보수 = 초록색
  ctx.fillText(maintenanceTxt, cx3, y);
  y += 28;
  ctx.font = 'bold 20px sans-serif';
  ctx.fillStyle = '#B23A26'; // 총 비용 = 빨간색
  ctx.fillText('총 비용: ' + fmtWon(cleaningTotal + maintenanceTotal) + '원', pad, y);

  // 파일명은 영문/숫자만 — Supabase Storage 키에 한글이 섞이면 "Invalid key" 오류가
  // 난다(실제 배포에서 발견). 한글 이름이 필요한 곳(오프라인 빈 양식 다운로드)은 이
  // 파일이 스토리지로 안 올라가고 브라우저에서 바로 다운로드되니까 괜찮다.
  return dataURLtoFile(canvas.toDataURL('image/png'), 'checklist-v1.png');
}

// 오프라인 빈 양식 — 인터넷이 안 되는 현장에서 종이 대신 쓸 수 있게, 상태 칸이 전부
// 빈칸인 체크리스트 표를 출력한다. buildChecklistImageV1과 레이아웃은 같고 값만 비운다.
export function buildBlankTemplateImage(SECTIONS) {
  const col = { sec: 64, item: 200, status: 56, note: 280, amount: 110 };
  const pad = 20;
  const rowH = 26;
  const tableHeadH = 28;
  const totalW = pad * 2 + col.sec + col.item + col.status + col.note + col.amount;

  const rows = [];
  SECTIONS.forEach((sec) => {
    sec.items.forEach((it, idx) => {
      rows.push({ sec: sec.title, first: idx === 0, label: it.l });
    });
  });

  const headH = 76, footH = 40;
  const canvasH = pad + headH + tableHeadH + rows.length * rowH + footH + pad;
  const canvas = document.createElement('canvas');
  const scale = 2;
  canvas.width = totalW * scale;
  canvas.height = canvasH * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, totalW, canvasH);
  ctx.textBaseline = 'middle';

  let y = pad;
  ctx.fillStyle = '#15202B';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('호실점검 CHECK LIST (빈 양식)', pad, y + 12);
  y += 34;
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#57666F';
  ctx.fillText('건물명: ________________    호실: ______    점검일: ________', pad, y);
  y += 26;

  const headerRowY = y;
  const cols = [['구분', col.sec], ['하자내용', col.item], ['상태', col.status], ['비고', col.note], ['금액', col.amount]];
  let cx = pad;
  ctx.strokeStyle = '#8B98A0';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#15202B';
  cols.forEach((c) => {
    ctx.strokeRect(cx, headerRowY, c[1], tableHeadH);
    ctx.fillText(c[0], cx + 8, headerRowY + tableHeadH / 2);
    cx += c[1];
  });
  y = headerRowY + tableHeadH;

  ctx.font = '12px sans-serif';
  rows.forEach((row) => {
    cx = pad;
    ctx.strokeStyle = '#D3DCE0';
    ctx.fillStyle = '#15202B';
    ctx.strokeRect(cx, y, col.sec, rowH);
    if (row.first) ctx.fillText(truncateText(ctx, row.sec, col.sec - 10), cx + 6, y + rowH / 2);
    cx += col.sec;
    ctx.strokeRect(cx, y, col.item, rowH);
    ctx.fillText(truncateText(ctx, row.label, col.item - 12), cx + 8, y + rowH / 2);
    cx += col.item;
    ctx.strokeRect(cx, y, col.status, rowH);
    cx += col.status;
    ctx.strokeRect(cx, y, col.note, rowH);
    cx += col.note;
    ctx.strokeRect(cx, y, col.amount, rowH);
    y += rowH;
  });

  y += 20;
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#15202B';
  ctx.fillText('기타사항: ______________________________________________', pad, y);

  return dataURLtoFile(canvas.toDataURL('image/png'), '오프라인_빈양식.png');
}

const RESP_LABEL = { tenant: '임차인', landlord: '임대인', negotiate: '협의필요', '': '미지정' };

export function buildChecklistImageV2(state, SECTIONS) {
  const W = 860, pad = 30, scale = 2;

  const allRows = [];
  SECTIONS.forEach((sec) => {
    sec.items.forEach((it, idx) => allRows.push({ sec: sec.title, label: it.l, entry: state.items[sec.id + ':' + idx] }));
    (state.custom[sec.id] || []).forEach((c) => allRows.push({ sec: sec.title, label: c.label, entry: c }));
  });
  const badRows = allRows.filter((r) => r.entry.status === 'bad');
  const okNames = allRows.filter((r) => r.entry.status === 'ok').map((r) => r.label)
    .concat(allRows.filter((r) => r.entry.status === 'na').map((r) => r.label + '(해당없음)'));
  let totalAmt = 0, cleaningTotal = 0, maintenanceTotal = 0;
  const respGroups = { tenant: [], landlord: [], negotiate: [], '': [] };
  badRows.forEach((r) => {
    const amt = parseInt(r.entry.amount, 10) || 0;
    totalAmt += amt;
    if (isCleaningCategory(r.label)) cleaningTotal += amt; else maintenanceTotal += amt;
    const key = respGroups[r.entry.responsibility] ? r.entry.responsibility : '';
    respGroups[key].push({ sec: r.sec, label: r.label, note: r.entry.note, amount: amt });
  });
  const okLine = okNames.join(', ');
  const maxOkLines = 6;

  // 2026-09-16: 예전엔 캔버스 높이를 고정(1216px)해두고 하단 통계를 캔버스 맨 아래에
  // 붙여서, 하자가 적은 호실은 "정상 확인" 목록과 합계 사이에 여백이 크게 남았다
  // (박길일님 피드백). 내용 길이에 맞춰 캔버스 높이를 미리 계산해서 만들고, 하단
  // 통계는 내용 바로 아래에 붙인다(buildChecklistImageV1과 같은 2단계 측정 방식 —
  // "정상 확인" 줄바꿈만 실제 폭 측정이 필요해서 임시 캔버스로 먼저 줄 수를 센다).
  const ctxMeasure = document.createElement('canvas').getContext('2d');
  ctxMeasure.font = '10.5px sans-serif';
  let okLineCount = 0;
  {
    let remaining = okLine;
    for (let i = 0; i < maxOkLines && remaining; i++) {
      let cut = remaining.length;
      while (cut > 0 && ctxMeasure.measureText(remaining.slice(0, cut)).width > W - pad * 2) cut--;
      remaining = remaining.slice(Math.max(cut, 1));
      okLineCount++;
    }
  }
  let yM = pad + 36 + 26 + 20; // 제목 + 메타 + 첫 구분선
  ['tenant', 'landlord', 'negotiate', ''].forEach((key) => {
    const items = respGroups[key];
    if (!items.length) return;
    yM += 20 + items.length * 18 + 10;
  });
  yM += 20 + 18 + okLineCount * 14; // 둘째 구분선 + '정상 확인' 줄 + 목록 줄바꿈
  yM += 6 + 24 + 30; // 셋째 구분선 + 하단 통계 첫 줄→둘째 줄 간격
  const H = yM + 16 + pad; // 마지막 줄 아래 여백 + 하단 패딩

  const canvas = document.createElement('canvas');
  canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle';

  let y = pad;
  ctx.fillStyle = '#15202B';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('하자요약표', pad, y + 14);
  y += 36;
  ctx.font = '12.5px sans-serif';
  ctx.fillStyle = '#57666F';
  ctx.fillText('건물명: ' + (state.info.building || '-') + '    호실: ' + (state.info.unit || '-') + '    점검일: ' + (state.info.date || '-'), pad, y);
  y += 26;
  ctx.strokeStyle = '#D3DCE0';
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
  y += 20;

  ['tenant', 'landlord', 'negotiate', ''].forEach((key) => {
    const items = respGroups[key];
    if (!items.length) return;
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = key === 'tenant' ? '#2A5C8A' : key === 'landlord' ? '#B5790E' : '#57666F';
    ctx.fillText(RESP_LABEL[key] + ' 책임 (' + items.length + '건)', pad, y);
    y += 20;
    ctx.font = '12px sans-serif';
    items.forEach((it) => {
      // 2026-09-15: 하자요약표도 V1 점검표 하단(청소=파랑·보수=초록·금액=빨강)과
      // 색상을 통일해달라는 요청(박길일님, "원래 아티팩트였을 때의 요약표처럼") —
      // 항목 텍스트는 청소/보수 분류에 따라 파랑·초록, 금액은 빨강으로 나눠 그린다.
      // 한 fillText엔 색을 하나만 줄 수 있어서 폭을 재 이어붙인다.
      const prefix = '· [' + it.sec + '] ' + it.label + (it.note ? ' - ' + it.note : '');
      const amountTxt = it.amount ? ' (' + fmtWon(it.amount) + '원)' : '';
      const maxWidth = W - pad * 2 - 10;
      const amountW = ctx.measureText(amountTxt).width;
      const truncatedPrefix = truncateText(ctx, prefix, Math.max(20, maxWidth - amountW));
      ctx.fillStyle = isCleaningCategory(it.label) ? '#2A5C8A' : '#3F8F5F';
      ctx.fillText(truncatedPrefix, pad + 6, y);
      const prefixW = ctx.measureText(truncatedPrefix).width;
      ctx.fillStyle = '#B23A26';
      ctx.fillText(amountTxt, pad + 6 + prefixW, y);
      y += 18;
    });
    y += 10;
  });

  ctx.strokeStyle = '#D3DCE0';
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
  y += 20;
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#3F8F5F';
  ctx.fillText('정상 확인 ' + okNames.length + '건', pad, y);
  y += 18;
  ctx.font = '10.5px sans-serif';
  ctx.fillStyle = '#57666F';
  let remaining = okLine;
  for (let i = 0; i < maxOkLines && remaining; i++) {
    let cut = remaining.length;
    while (cut > 0 && ctx.measureText(remaining.slice(0, cut)).width > W - pad * 2) cut--;
    ctx.fillText(remaining.slice(0, cut), pad, y);
    remaining = remaining.slice(cut);
    y += 14;
  }

  y += 6;
  ctx.strokeStyle = '#D3DCE0';
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
  y += 24;
  // 2026-09-16: 하단 통계를 V1 점검표와 통일 — "총 예상 비용" 한 줄이 아니라 청소/보수를
  // 나눠 보여주고, 글씨도 키움(박길일님 요청: "총 청소 얼마 / 보수 얼마 / 총 얼마").
  ctx.font = 'bold 15px sans-serif';
  const cleaningTxt = '청소 ' + fmtWon(cleaningTotal) + '원';
  const sepTxt = '   ·   ';
  const maintenanceTxt = '보수 ' + fmtWon(maintenanceTotal) + '원';
  let cx3 = pad;
  ctx.fillStyle = '#2A5C8A'; // 청소 = 파란색
  ctx.fillText(cleaningTxt, cx3, y);
  cx3 += ctx.measureText(cleaningTxt).width;
  ctx.fillStyle = '#8B98A0';
  ctx.fillText(sepTxt, cx3, y);
  cx3 += ctx.measureText(sepTxt).width;
  ctx.fillStyle = '#3F8F5F'; // 보수 = 초록색
  ctx.fillText(maintenanceTxt, cx3, y);
  y += 30;
  ctx.font = 'bold 20px sans-serif';
  ctx.fillStyle = '#B23A26'; // 총 비용 = 빨간색
  ctx.fillText('하자 ' + badRows.length + '건 · 총 ' + fmtWon(totalAmt) + '원', pad, y);

  return dataURLtoFile(canvas.toDataURL('image/png'), 'checklist-v2.png');
}

// 2026-09-15: 게시글 맨 앞에 들어가는 새 이미지(박길일님 요청) — "이전 호실 점검
// 내역"(최근 1건, lib/history.js fetchLatestHistoryEntry 결과), "하자보수 완료내역"
// (아직 데이터 연동 전 — 추후 보증금 정산내역서와 자동 대조하는 기능을 별도로 만들
// 예정이라 지금은 자리표시자), "비고(의견)"(state.historyRemark, 체크리스트 화면의
// HistoryPanel에서 입력) 세 구획을 위아래로 쌓아서 그린다. V1/V2와 같은 스타일.
export function buildHistorySummaryImage(state, historyEntry, repairHistory) {
  const W = 700, pad = 24, scale = 2;
  const lineH = 20;
  const ctxMeasure = document.createElement('canvas').getContext('2d');
  ctxMeasure.font = '13px sans-serif';

  const entryLines = historyEntry
    ? historyEntry.i.map((it) => '· ' + it[0] + (it[1] ? ' (' + fmtWon(it[1]) + '원)' : ''))
    : ['이전 점검 기록이 없어요.'];
  const remarkLines = wrapText(ctxMeasure, state.historyRemark && state.historyRemark.trim() ? state.historyRemark.trim() : '작성된 의견이 없어요.', W - pad * 2);

  // 2026-09-16: work_orders.repair_items(항목별 done)가 있으면 실제 조치완료/미조치를
  // 보여주고, 없으면 예전처럼 안내문구(박길일님 요청 — 다음 점검 때 "이전 하자가 실제로
  // 고쳐졌는지" 항목별로 확인 가능하게).
  const repairItems = repairHistory && Array.isArray(repairHistory.repair_items) ? repairHistory.repair_items : null;
  const repairLines = repairItems && repairItems.length
    ? repairItems.map((it) => ({
        text: (it.done ? '✓ ' : '⚠ ') + it.label + (it.note ? ' ' + it.note : '') + (it.amount ? ' (' + fmtWon(it.amount) + '원)' : '') + (it.done ? '' : ' — 미조치'),
        done: !!it.done,
      }))
    : [{ text: repairItems ? '이전 점검에 보수 대상 하자가 없었어요.' : '아직 연동된 데이터가 없어요.', done: true }];

  const headH = 96;
  const sec1H = 24 + (historyEntry ? 20 : 0) + entryLines.length * lineH + (historyEntry ? 4 + lineH : 0) + 20;
  const sec2H = 24 + repairLines.length * lineH + 20;
  const sec3H = 24 + remarkLines.length * lineH + 8;
  const canvasH = pad + headH + sec1H + sec2H + sec3H + pad;

  const canvas = document.createElement('canvas');
  canvas.width = W * scale; canvas.height = canvasH * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, canvasH);
  ctx.textBaseline = 'middle';

  let y = pad;
  ctx.fillStyle = '#15202B';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('이전 점검 · 하자보수 이력', pad, y + 12);
  y += 34;
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#57666F';
  ctx.fillText('건물명: ' + (state.info.building || '-') + '    호실: ' + (state.info.unit || '-'), pad, y);
  y += 26;
  ctx.strokeStyle = '#D3DCE0';
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
  y += 24;

  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = '#2A5C8A';
  ctx.fillText('이전 호실 점검 내역', pad, y);
  y += 20;
  if (historyEntry) {
    ctx.font = 'bold 12.5px sans-serif';
    ctx.fillStyle = '#15202B';
    ctx.fillText(historyEntry.d + (historyEntry.co ? ' (퇴실)' : ' (입주 확인)'), pad, y);
    y += 20;
  }
  // 2026-09-16: 글씨 키우고 볼드 처리 + 합계 줄 추가(박길일님 요청) — 이전 점검 때
  // 합계가 얼마였는지 한눈에 보이게.
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = '#15202B';
  entryLines.forEach((line) => { ctx.fillText(line, pad, y); y += lineH; });
  if (historyEntry) {
    const entryTotal = historyEntry.i.reduce((s, it) => s + (parseInt(it[1], 10) || 0), 0);
    y += 4;
    const label = '합계 ';
    ctx.fillStyle = '#15202B';
    ctx.fillText(label, pad, y);
    ctx.fillStyle = '#B23A26';
    ctx.fillText(fmtWon(entryTotal) + '원', pad + ctx.measureText(label).width, y);
    y += lineH;
  }
  y += 12;
  ctx.strokeStyle = '#D3DCE0';
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
  y += 24;

  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = '#2A5C8A';
  ctx.fillText('하자보수 완료내역', pad, y);
  y += 20;
  repairLines.forEach((line) => {
    ctx.font = line.done ? '12.5px sans-serif' : 'bold 12.5px sans-serif';
    ctx.fillStyle = line.done ? '#15202B' : '#B23A26';
    ctx.fillText(line.text, pad, y);
    y += lineH;
  });
  y += 12;
  ctx.strokeStyle = '#D3DCE0';
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
  y += 24;

  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = '#2A5C8A';
  ctx.fillText('비고(의견)', pad, y);
  y += 20;
  ctx.font = '12.5px sans-serif';
  ctx.fillStyle = '#15202B';
  remarkLines.forEach((line) => { ctx.fillText(line, pad, y); y += lineH; });

  return dataURLtoFile(canvas.toDataURL('image/png'), 'checklist-history.png');
}
