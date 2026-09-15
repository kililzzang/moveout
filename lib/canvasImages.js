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

  // footH 90: 기타사항 줄 + 청소/보수 줄 + 총 비용 줄, 세 줄이 들어갈 여유(2026-09-15
  // 청소/보수 분리 + 총 비용 줄 추가하면서 70 → 90으로 늘림 — 안 늘리면 마지막 줄이 잘림).
  const headH = 100, footH = 90;
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
    const stLabel = STATUS_LABEL[row.entry.status] || '-';
    ctx.fillStyle = STATUS_COLOR[row.entry.status] || '#8B98A0';
    ctx.fillText(stLabel, cx + 12, y + rowH / 2);
    ctx.fillStyle = '#15202B';
    cx += col.status;

    ctx.strokeRect(cx, y, col.note, rowH);
    ctx.fillText(truncateText(ctx, row.entry.note || '', col.note - 12), cx + 8, y + rowH / 2);
    cx += col.note;

    ctx.strokeRect(cx, y, col.amount, rowH);
    const amt = parseInt(row.entry.amount, 10) || 0;
    const amtTxt = amt ? fmtWon(amt) + '원' : '';
    const amtW = ctx.measureText(amtTxt).width;
    ctx.fillText(amtTxt, cx + col.amount - amtW - 8, y + rowH / 2);

    y += rowH;
  });

  y += 18;
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#15202B';
  ctx.fillText('기타사항: ' + truncateText(ctx, state.finalNote || '-', totalW - pad * 2 - 90), pad, y);
  y += 22;
  // 2026-09-15: "청소 추가금액" 수동입력 필드는 삭제하고, 대신 하자 금액을 청소/보수로
  // 나눠 보여준 뒤 합계(총 비용)까지 표기한다(박길일님 요청).
  let cleaningTotal = 0, maintenanceTotal = 0;
  rows.forEach((row) => {
    const amt = parseInt(row.entry.amount, 10) || 0;
    if (isCleaningCategory(row.label)) cleaningTotal += amt; else maintenanceTotal += amt;
  });
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#57666F';
  ctx.fillText('청소 ' + fmtWon(cleaningTotal) + '원   ·   보수 ' + fmtWon(maintenanceTotal) + '원', pad, y);
  y += 20;
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = '#2A5C8A';
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
  const W = 860, H = 1216, pad = 30, scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle';

  const allRows = [];
  SECTIONS.forEach((sec) => {
    sec.items.forEach((it, idx) => allRows.push({ sec: sec.title, label: it.l, entry: state.items[sec.id + ':' + idx] }));
    (state.custom[sec.id] || []).forEach((c) => allRows.push({ sec: sec.title, label: c.label, entry: c }));
  });
  const badRows = allRows.filter((r) => r.entry.status === 'bad');
  const okNames = allRows.filter((r) => r.entry.status === 'ok').map((r) => r.label)
    .concat(allRows.filter((r) => r.entry.status === 'na').map((r) => r.label + '(해당없음)'));
  let totalAmt = 0;
  const respGroups = { tenant: [], landlord: [], negotiate: [], '': [] };
  badRows.forEach((r) => {
    const amt = parseInt(r.entry.amount, 10) || 0;
    totalAmt += amt;
    const key = respGroups[r.entry.responsibility] ? r.entry.responsibility : '';
    respGroups[key].push({ sec: r.sec, label: r.label, note: r.entry.note, amount: amt });
  });

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
      ctx.fillStyle = '#15202B';
      const line = '· [' + it.sec + '] ' + it.label + (it.note ? ' - ' + it.note : '') + (it.amount ? ' (' + fmtWon(it.amount) + '원)' : '');
      ctx.fillText(truncateText(ctx, line, W - pad * 2 - 10), pad + 6, y);
      y += 18;
      if (y > H - 140) return; // 넘치면 아래 정상목록·합계 공간을 지키기 위해 멈춤
    });
    y += 10;
  });

  y = Math.min(y, H - 130);
  ctx.strokeStyle = '#D3DCE0';
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
  y += 20;
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#3F8F5F';
  ctx.fillText('정상 확인 ' + okNames.length + '건', pad, y);
  y += 18;
  ctx.font = '10.5px sans-serif';
  ctx.fillStyle = '#57666F';
  const okLine = okNames.join(', ');
  const maxLines = 6;
  let remaining = okLine;
  for (let i = 0; i < maxLines && remaining; i++) {
    let cut = remaining.length;
    while (cut > 0 && ctx.measureText(remaining.slice(0, cut)).width > W - pad * 2) cut--;
    ctx.fillText(remaining.slice(0, cut), pad, y);
    remaining = remaining.slice(cut);
    y += 14;
  }

  y = H - 60;
  ctx.strokeStyle = '#D3DCE0';
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
  y += 26;
  ctx.font = 'bold 16px sans-serif';
  ctx.fillStyle = '#2A5C8A';
  ctx.fillText('하자 ' + badRows.length + '건 · 총 예상 비용 ' + fmtWon(totalAmt) + '원', pad, y);

  return dataURLtoFile(canvas.toDataURL('image/png'), 'checklist-v2.png');
}

// 2026-09-15: 게시글 맨 앞에 들어가는 새 이미지(박길일님 요청) — "이전 호실 점검
// 내역"(최근 1건, lib/history.js fetchLatestHistoryEntry 결과), "하자보수 완료내역"
// (아직 데이터 연동 전 — 추후 보증금 정산내역서와 자동 대조하는 기능을 별도로 만들
// 예정이라 지금은 자리표시자), "비고(의견)"(state.historyRemark, 체크리스트 화면의
// HistoryPanel에서 입력) 세 구획을 위아래로 쌓아서 그린다. V1/V2와 같은 스타일.
export function buildHistorySummaryImage(state, historyEntry) {
  const W = 700, pad = 24, scale = 2;
  const lineH = 20;
  const ctxMeasure = document.createElement('canvas').getContext('2d');
  ctxMeasure.font = '13px sans-serif';

  const entryLines = historyEntry
    ? historyEntry.i.map((it) => '· ' + it[0] + (it[1] ? ' (' + fmtWon(it[1]) + '원)' : ''))
    : ['이전 점검 기록이 없어요.'];
  const remarkLines = wrapText(ctxMeasure, state.historyRemark && state.historyRemark.trim() ? state.historyRemark.trim() : '작성된 의견이 없어요.', W - pad * 2);

  const headH = 96;
  const sec1H = 24 + (historyEntry ? 20 : 0) + entryLines.length * lineH + 20;
  const sec2H = 24 + lineH + 20;
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
  ctx.font = '12.5px sans-serif';
  ctx.fillStyle = '#15202B';
  entryLines.forEach((line) => { ctx.fillText(line, pad, y); y += lineH; });
  y += 12;
  ctx.strokeStyle = '#D3DCE0';
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
  y += 24;

  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = '#2A5C8A';
  ctx.fillText('하자보수 완료내역', pad, y);
  y += 20;
  ctx.font = '12.5px sans-serif';
  ctx.fillStyle = '#8B98A0';
  ctx.fillText('아직 연동된 데이터가 없어요 (추후 반영 예정)', pad, y);
  y += lineH + 12;
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
