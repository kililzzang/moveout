// 점검 리포트를 PDF/HTML/DOCX로 "보관용 파일"로 만들어보는 실험 코드.
// 나중에 네이버웍스 드라이브에 자동 업로드하는 기능의 샘플 단계라, 지금은
// 사진을 전부 파일 안에 실제로 박아 넣는다(외부 저장소 URL이 나중에 사라져도
// 안전하게 보이도록) — 동영상만 용량 문제로 링크만 남긴다.
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel } from 'docx';
import { imageSize } from 'image-size';

// Pretendard(가변/CFF 폰트)는 pdf-lib에 딸린 fontkit 버전이 못 읽어서
// "topDict" 에러가 났다 — 고정폭 정적 TTF인 나눔고딕으로 바꿨다.
const KOREAN_FONT_URL =
  'https://raw.githubusercontent.com/google/fonts/main/ofl/nanumgothic/NanumGothic-Regular.ttf';

function isVideo(m) {
  return (m.contentType || '').indexOf('video') === 0;
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`다운로드 실패: ${url} (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function buildArchiveHtml({ title, bodyText, media, defectSummaryLines }) {
  const parts = [];
  parts.push(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="font-family:sans-serif;">`);
  parts.push(`<h1>${escapeHtml(title)}</h1>`);
  (bodyText || '').split('\n').forEach((line) => parts.push(`<p>${escapeHtml(line)}</p>`));

  let prevGroup = null;
  for (const m of media) {
    if (m.group && m.group !== prevGroup && (m.group === 'general' || m.group === 'defect')) {
      const label = m.group === 'defect' ? '하자사진' : '내부사진';
      parts.push(`<h2>-------------------------${label}</h2>`);
      if (m.group === 'defect' && defectSummaryLines?.length) {
        defectSummaryLines.forEach((l) => parts.push(`<p>${escapeHtml(l)}</p>`));
      }
    }
    prevGroup = m.group;

    parts.push(`<p>[${escapeHtml(m.label || '')}]</p>`);
    if (isVideo(m)) {
      parts.push(`<p>동영상 링크: <a href="${m.url}">${m.url}</a></p>`);
      continue;
    }
    const buf = await fetchBuffer(m.url);
    const b64 = buf.toString('base64');
    const mime = m.contentType || 'image/png';
    parts.push(`<img src="data:${mime};base64,${b64}" style="max-width:480px;width:100%;height:auto;" />`);
  }

  parts.push('</body></html>');
  return parts.join('\n');
}

export async function buildArchivePdf({ title, bodyText, media, defectSummaryLines }) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fontBytes = await fetch(KOREAN_FONT_URL).then((r) => r.arrayBuffer());
  const font = await pdfDoc.embedFont(fontBytes);

  const PAGE_W = 595;
  const PAGE_H = 842;
  const MARGIN = 40;
  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function newPageIfNeeded(needed) {
    if (y - needed < MARGIN) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  }

  function drawText(text, size = 11) {
    newPageIfNeeded(size + 6);
    page.drawText(text, { x: MARGIN, y, size, font, color: rgb(0, 0, 0) });
    y -= size + 6;
  }

  drawText(title, 18);
  y -= 6;
  (bodyText || '').split('\n').forEach((line) => line && drawText(line, 11));

  let prevGroup = null;
  for (const m of media) {
    if (m.group && m.group !== prevGroup && (m.group === 'general' || m.group === 'defect')) {
      const label = m.group === 'defect' ? '하자사진' : '내부사진';
      y -= 8;
      drawText(`------------------------- ${label}`, 14);
      if (m.group === 'defect' && defectSummaryLines?.length) {
        defectSummaryLines.forEach((l) => drawText(l, 10));
      }
    }
    prevGroup = m.group;

    drawText(`[${m.label || ''}]`, 10);
    if (isVideo(m)) {
      drawText(`동영상 링크: ${m.url}`, 9);
      continue;
    }

    const buf = await fetchBuffer(m.url);
    let embedded;
    try {
      embedded = await pdfDoc.embedJpg(buf);
    } catch {
      embedded = await pdfDoc.embedPng(buf);
    }
    const maxW = PAGE_W - MARGIN * 2;
    const scale = Math.min(1, maxW / embedded.width);
    const w = embedded.width * scale;
    const h = embedded.height * scale;

    newPageIfNeeded(h);
    page.drawImage(embedded, { x: MARGIN, y: y - h, width: w, height: h });
    y -= h + 12;
  }

  return pdfDoc.save();
}

export async function buildArchiveDocx({ title, bodyText, media, defectSummaryLines }) {
  const children = [];
  children.push(new Paragraph({ text: title, heading: HeadingLevel.HEADING1 }));
  (bodyText || '').split('\n').forEach((line) => {
    if (line) children.push(new Paragraph({ children: [new TextRun(line)] }));
  });

  let prevGroup = null;
  for (const m of media) {
    if (m.group && m.group !== prevGroup && (m.group === 'general' || m.group === 'defect')) {
      const label = m.group === 'defect' ? '하자사진' : '내부사진';
      children.push(new Paragraph({ text: `------------------------- ${label}`, heading: HeadingLevel.HEADING2 }));
      if (m.group === 'defect' && defectSummaryLines?.length) {
        defectSummaryLines.forEach((l) => children.push(new Paragraph({ children: [new TextRun(l)] })));
      }
    }
    prevGroup = m.group;

    children.push(new Paragraph({ children: [new TextRun({ text: `[${m.label || ''}]`, bold: true })] }));
    if (isVideo(m)) {
      children.push(new Paragraph({ children: [new TextRun(`동영상 링크: ${m.url}`)] }));
      continue;
    }

    const buf = await fetchBuffer(m.url);
    let width = 400;
    let height = 300;
    try {
      const dim = imageSize(buf);
      if (dim.width && dim.height) {
        const scale = Math.min(1, 400 / dim.width);
        width = Math.round(dim.width * scale);
        height = Math.round(dim.height * scale);
      }
    } catch {
      // 크기 판독 실패하면 기본값(400x300) 사용
    }

    children.push(
      new Paragraph({
        children: [new ImageRun({ data: buf, transformation: { width, height } })],
      })
    );
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}
