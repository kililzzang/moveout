'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '../lib/supabaseClient';
import { SECTIONS } from '../lib/sections';
import {
  INFO_FIELDS, KNOWN_BUILDINGS, defaultState, loadState, saveState, unitDocId, uid,
} from '../lib/checklistState';
import { fetchLatestHistoryEntry } from '../lib/history';
import {
  fmtWon, isCleaningCategory, collectIncompleteDefects, buildOfficialFormReport,
  buildNaverWorksTitle, buildNaverWorksBody, buildAttachmentPlan,
} from '../lib/report';
import { fetchLearnedStats, addPriceHistoryRecords } from '../lib/priceHistory';
import { buildChecklistImageV1, buildChecklistImageV2 } from '../lib/canvasImages';
// 건물명을 고르면 지번주소를 자동으로 채워준다 — 아는 만큼만 채워둔 표, 없는 건물은
// 그대로 직접 입력해야 한다(빈 문자열이면 자동채우기를 안 한다).
import { BUILDING_ADDRESS } from '../lib/buildingAddress';
import './checklist.css';

const STATUS_LABEL = { ok: '정상', bad: '하자', na: '해당없음' };
const RESP_LABEL = { tenant: '임차인', landlord: '임대인', negotiate: '협의필요' };
const MAX_PHOTO_MB = 20;
const IMAGE_MAX_DIM = 1600; // 이 크기보다 큰 사진은 업로드 전에 줄여서 20MB 제한에 덜 걸리게 한다

// ---- 사진 업로드(간단 압축 포함) ----
function compressImageIfNeeded(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return Promise.resolve(file);
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, IMAGE_MAX_DIM / Math.max(img.width, img.height));
      if (scale >= 1) { resolve(file); return; }
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        resolve(blob ? new File([blob], file.name, { type: 'image/jpeg' }) : file);
      }, 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

async function uploadPhoto(supabase, docId, file, isDefect) {
  const processed = await compressImageIfNeeded(file);
  if (processed.size > MAX_PHOTO_MB * 1024 * 1024) {
    throw new Error('파일이 ' + MAX_PHOTO_MB + 'MB를 넘어요: ' + file.name);
  }
  const safeName = file.name.replace(/[^A-Za-z0-9_.\-]/g, '_');
  const path = docId + '/' + uid() + '-' + safeName;
  const { error } = await supabase.storage.from('photos').upload(path, processed);
  if (error) throw error;
  const { data } = supabase.storage.from('photos').getPublicUrl(path);
  return { id: path, url: data.publicUrl, contentType: processed.type, isDefect: !!isDefect };
}

async function uploadGeneratedImage(supabase, docId, file) {
  const path = docId + '/_generated/' + file.name;
  await supabase.storage.from('photos').remove([path]).catch(() => {});
  const { error } = await supabase.storage.from('photos').upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from('photos').getPublicUrl(path);
  return data.publicUrl;
}

// ---- Toast ----
function Toast({ toasts }) {
  return (
    <div className="toast-stack">
      {toasts.map((t) => <div className="toast" key={t.id}>{t.text}</div>)}
    </div>
  );
}

// ---- Lightbox ----
function Lightbox({ item, onClose }) {
  if (!item) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <button type="button" className="lightbox-close" onClick={onClose}>×</button>
      {item.contentType && item.contentType.startsWith('video') ? (
        <video src={item.url} controls autoPlay onClick={(e) => e.stopPropagation()} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.url} alt="" onClick={(e) => e.stopPropagation()} />
      )}
    </div>
  );
}

function InfoGrid({ state, setInfo }) {
  return (
    <div className="info-card">
      <div className="info-grid">
        {INFO_FIELDS.map((f) => {
          if (f.id === 'building') {
            return (
              <div className="field" key={f.id}>
                <label>{f.label}</label>
                <input
                  list="known-buildings"
                  value={state.info.building}
                  onChange={(e) => setInfo('building', e.target.value)}
                  placeholder="선택 또는 직접입력"
                />
                <datalist id="known-buildings">
                  {KNOWN_BUILDINGS.map((b) => <option value={b} key={b} />)}
                </datalist>
              </div>
            );
          }
          return (
            <div className="field" key={f.id}>
              <label>{f.label}</label>
              <input
                type={f.type}
                value={state.info[f.id]}
                onChange={(e) => setInfo(f.id, e.target.value)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HistoryCard({ entry, building, unit }) {
  if (!entry) return null;
  return (
    <div className="history-card">
      <b>이전 점검 이력 발견 (최근 1건)</b> — {building} {unit}호 (참고용)
      <div style={{ marginTop: 8 }}>
        <b>{entry.d}{entry.co ? ' (퇴실)' : ' (입주 확인)'}</b>
        <div>
          {entry.i.map((it, i) => (
            <div key={i}>· {it[0]}{it[1] ? ' (' + fmtWon(it[1]) + '원)' : ''}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PhotoThumbs({ photos, onDelete, onOpen }) {
  if (!photos.length) return null;
  return (
    <div className="photo-thumbs">
      {photos.map((p, i) => {
        const isVideo = p.contentType && p.contentType.startsWith('video');
        return (
          <div className="photo-thumb" key={p.id} onClick={() => onOpen(p)}>
            {isVideo ? <video src={p.url} /> : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.url} alt="" />
            )}
            {isVideo && <div className="photo-thumb-play" />}
            {p.isDefect && <span className="photo-thumb-badge">하자</span>}
            <button type="button" className="photo-thumb-del" onClick={(e) => { e.stopPropagation(); onDelete(i); }}>×</button>
          </div>
        );
      })}
    </div>
  );
}

function DepCalculator({ meta, onApply }) {
  const [years, setYears] = useState('');
  if (!meta || !meta.dep || !meta.std) return null;
  const y = parseFloat(years) || 0;
  const fraction = Math.max(0, 1 - y / meta.dep);
  const computed = Math.round((meta.std * fraction) / 1000) * 1000;
  return (
    <div className="dep-row">
      <span>경과연수(내구연한 {meta.dep}년)</span>
      <input type="number" value={years} onChange={(e) => setYears(e.target.value)} placeholder="년" />
      <span className="dep-result">= {fmtWon(computed)}원</span>
      <button type="button" className="apply-btn" onClick={() => onApply(String(computed))}>적용</button>
    </div>
  );
}

function ItemRow({ label, hint, meta, entry, onChange, onDelete, docId, supabase, learnedStat, onLightbox, showToast }) {
  const [noteOpen, setNoteOpen] = useState(!!entry.note);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const generalInputRef = useRef(null);
  const defectInputRef = useRef(null);

  function setStatus(status) {
    onChange({ status: status === entry.status ? '' : status });
  }

  async function handleFiles(files, isDefect) {
    if (!files || !files.length) return;
    setBusy(true);
    const total = files.length;
    try {
      let photos = entry.photos || [];
      let done = 0;
      for (const file of Array.from(files)) {
        setUploadProgress({ done, total });
        const p = await uploadPhoto(supabase, docId, file, isDefect);
        photos = photos.concat([p]);
        onChange({ photos });
        done++;
        setUploadProgress({ done, total });
      }
      showToast(done + '장 업로드 완료');
    } catch (e) {
      showToast('업로드 실패: ' + e.message);
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  }

  function deletePhoto(idx) {
    if (!confirm('이 사진/동영상을 삭제할까요?')) return;
    const photos = (entry.photos || []).slice();
    const [removed] = photos.splice(idx, 1);
    onChange({ photos });
    if (removed) supabase.storage.from('photos').remove([removed.id]).catch(() => {});
  }

  const effectiveStd = learnedStat ? learnedStat.std : (meta && meta.std);
  const stdIsLearned = learnedStat && learnedStat.count > 0;

  return (
    <div className="item">
      <div className="item-label">{label}{onDelete && (
        <button type="button" onClick={onDelete} style={{ marginLeft: 6, border: 'none', background: 'none', color: 'var(--ink-faint)', cursor: 'pointer' }}>✕</button>
      )}</div>
      {hint && <div className="item-hint">{hint}</div>}
      <div className="chips">
        {['ok', 'bad', 'na'].map((s) => (
          <button
            type="button"
            key={s}
            className={'chip' + (entry.status === s ? ' active-' + s : '')}
            onClick={() => setStatus(s)}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
        <button type="button" className="chip" onClick={() => setNoteOpen((v) => !v)}>비고</button>
      </div>

      {noteOpen && (
        <div className="note-box">
          <textarea
            value={entry.note}
            onChange={(e) => onChange({ note: e.target.value })}
            placeholder="비고를 적어주세요"
          />
        </div>
      )}

      {entry.status === 'bad' && (
        <>
          <div className="amount-row">
            <input
              type="number"
              value={entry.amount}
              onChange={(e) => onChange({ amount: e.target.value })}
              placeholder="금액"
            />
            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>원</span>
            {effectiveStd ? (
              <button type="button" className="price-hint" onClick={() => onChange({ amount: String(effectiveStd) })}>
                표준가 적용 {fmtWon(effectiveStd)}원{meta && meta.unit ? ' (' + meta.unit + ')' : ''}
                {stdIsLearned ? ' · 팀 학습 ' + learnedStat.count + '건' : ''}
              </button>
            ) : null}
          </div>
          <DepCalculator meta={meta} onApply={(v) => onChange({ amount: v })} />
          <div className="chips">
            {['tenant', 'landlord', 'negotiate'].map((v) => (
              <button
                type="button"
                key={v}
                className={'resp-chip' + (entry.responsibility === v ? ' active-' + v : '')}
                onClick={() => onChange({ responsibility: v === entry.responsibility ? '' : v })}
              >
                {RESP_LABEL[v]}
              </button>
            ))}
          </div>
          {meta && meta.respNote && <div className="item-hint">{meta.respNote}</div>}
        </>
      )}

      <div className="photo-row">
        <PhotoThumbs photos={entry.photos || []} onDelete={deletePhoto} onOpen={onLightbox} />
        <div className="photo-add-row">
          <input ref={generalInputRef} type="file" accept="image/*,video/*" multiple hidden
            onChange={(e) => { handleFiles(e.target.files, false); e.target.value = ''; }} />
          <button type="button" className="btn" disabled={busy} onClick={() => generalInputRef.current.click()}>
            {uploadProgress ? (uploadProgress.done + 1) + '/' + uploadProgress.total + ' 업로드 중…' : '사진 추가'}
          </button>
          {entry.status === 'bad' && (
            <>
              <input ref={defectInputRef} type="file" accept="image/*,video/*" multiple hidden
                onChange={(e) => { handleFiles(e.target.files, true); e.target.value = ''; }} />
              <button type="button" className="btn bad" disabled={busy} onClick={() => defectInputRef.current.click()}>
                하자사진 추가
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionBlock({ sec, state, setItem, setCustomItem, addCustom, removeCustom, docId, supabase, open, onToggle, learnedStats, onLightbox, showToast }) {
  const [newLabel, setNewLabel] = useState('');
  const items = sec.items;
  const checked = items.filter((it, idx) => state.items[sec.id + ':' + idx].status).length;
  const hasBad = items.some((it, idx) => state.items[sec.id + ':' + idx].status === 'bad')
    || (state.custom[sec.id] || []).some((c) => c.status === 'bad');

  return (
    <div className="section">
      <button type="button" className="section-head" onClick={onToggle}>
        {sec.title}
        {hasBad && <span className="section-flag">하자 있음</span>}
        <span className="section-count">{checked}/{items.length}{open ? ' ▲' : ' ▼'}</span>
      </button>
      {open && (
        <div>
          {items.map((it, idx) => (
            <ItemRow
              key={idx}
              label={it.l}
              hint={it.h}
              meta={it}
              entry={state.items[sec.id + ':' + idx]}
              onChange={(patch) => setItem(sec.id, idx, patch)}
              docId={docId}
              supabase={supabase}
              learnedStat={learnedStats[it.l]}
              onLightbox={onLightbox}
              showToast={showToast}
            />
          ))}
          {(state.custom[sec.id] || []).map((c, cidx) => (
            <ItemRow
              key={'c' + cidx}
              label={c.label}
              entry={c}
              onChange={(patch) => setCustomItem(sec.id, cidx, patch)}
              onDelete={() => removeCustom(sec.id, cidx)}
              docId={docId}
              supabase={supabase}
              learnedStat={learnedStats[c.label]}
              onLightbox={onLightbox}
              showToast={showToast}
            />
          ))}
          <div className="custom-add-row">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="+ 항목 추가 (목록에 없는 항목)"
            />
            <button type="button" className="btn" onClick={() => { if (newLabel.trim()) { addCustom(sec.id, newLabel.trim()); setNewLabel(''); } }}>추가</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReportOverlay({ text, saveStatus, postStatus, imageStatus, onClose, onCopyAgain }) {
  return (
    <div className="overlay">
      <div className="report-box">
        <h3 style={{ marginTop: 0 }}>리포트</h3>
        <div className={'report-status-row ' + saveStatus.kind}>{saveStatus.text}</div>
        <div className={'report-status-row ' + imageStatus.kind}>{imageStatus.text}</div>
        <div className={'report-status-row ' + postStatus.kind}>{postStatus.text}</div>
        <textarea className="report-textarea" readOnly value={text} />
        <div className="report-actions">
          <button type="button" className="btn" onClick={onCopyAgain}>다시 복사</button>
          <button type="button" className="btn primary" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

export default function ChecklistApp() {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState(defaultState);
  const [openSection, setOpenSection] = useState(SECTIONS[0].id);
  const [historyEntry, setHistoryEntry] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState('');
  const [saveStatus, setSaveStatus] = useState({ kind: '', text: '' });
  const [postStatus, setPostStatus] = useState({ kind: '', text: '' });
  const [imageStatus, setImageStatus] = useState({ kind: '', text: '' });
  const [learnedStats, setLearnedStats] = useState({});
  const [lightboxItem, setLightboxItem] = useState(null);
  const [toasts, setToasts] = useState([]);

  function showToast(text) {
    const id = uid();
    setToasts((t) => t.concat([{ id, text }]));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }

  useEffect(() => { setState(loadState()); }, []);
  useEffect(() => { saveState(state); }, [state]);
  useEffect(() => { fetchLearnedStats(supabase).then(setLearnedStats).catch(() => {}); }, [supabase]);

  useEffect(() => {
    const b = state.info.building, u = state.info.unit;
    if (!b || !u) { setHistoryEntry(null); return; }
    const t = setTimeout(() => {
      fetchLatestHistoryEntry(supabase, b, u).then((entry) => setHistoryEntry(entry)).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [state.info.building, state.info.unit, supabase]);

  const docId = useMemo(() => unitDocId(state), [state.info.building, state.info.unit]);

  const totalItems = SECTIONS.reduce((sum, s) => sum + s.items.length, 0);
  const checkedItems = SECTIONS.reduce((sum, s) => sum + s.items.filter((it, idx) => state.items[s.id + ':' + idx].status).length, 0);
  let badCount = 0, badTotal = 0;
  SECTIONS.forEach((s) => {
    s.items.forEach((it, idx) => {
      const st = state.items[s.id + ':' + idx];
      if (st.status === 'bad') { badCount++; badTotal += parseInt(st.amount, 10) || 0; }
    });
    (state.custom[s.id] || []).forEach((c) => {
      if (c.status === 'bad') { badCount++; badTotal += parseInt(c.amount, 10) || 0; }
    });
  });

  function setInfo(id, value) {
    setState((s) => {
      const info = { ...s.info, [id]: value };
      // 건물명을 고르는 순간 지번주소를 자동으로 채운다 — 이미 직접 적어둔 주소는 덮어쓰지 않는다.
      if (id === 'building' && BUILDING_ADDRESS[value] && !s.info.jibunAddress) {
        info.jibunAddress = BUILDING_ADDRESS[value];
      }
      return { ...s, info };
    });
  }
  function setItem(secId, idx, patch) {
    const key = secId + ':' + idx;
    setState((s) => ({ ...s, items: { ...s.items, [key]: { ...s.items[key], ...patch } } }));
  }
  function setCustomItem(secId, cidx, patch) {
    setState((s) => {
      const arr = (s.custom[secId] || []).slice();
      arr[cidx] = { ...arr[cidx], ...patch };
      return { ...s, custom: { ...s.custom, [secId]: arr } };
    });
  }
  function addCustom(secId, label) {
    setState((s) => {
      const arr = (s.custom[secId] || []).slice();
      arr.push({ label, status: '', note: '', amount: '', responsibility: '', photos: [] });
      return { ...s, custom: { ...s.custom, [secId]: arr } };
    });
  }
  function removeCustom(secId, cidx) {
    setState((s) => {
      const arr = (s.custom[secId] || []).slice();
      arr.splice(cidx, 1);
      return { ...s, custom: { ...s.custom, [secId]: arr } };
    });
  }

  function buildInspectionRow() {
    let maintenanceTotal = 0, cleaningCategoryTotal = 0;
    const items = [];
    SECTIONS.forEach((sec) => {
      sec.items.forEach((it, idx) => {
        const st = state.items[sec.id + ':' + idx];
        if (st.status === 'bad') {
          const amt = parseInt(st.amount, 10) || 0;
          const cat = isCleaningCategory(it.l) ? 'cleaning' : 'maintenance';
          if (cat === 'cleaning') cleaningCategoryTotal += amt; else maintenanceTotal += amt;
          items.push({ label: it.l, amount: amt, note: st.note || '', category: cat });
        }
      });
      (state.custom[sec.id] || []).forEach((c) => {
        if (c.status === 'bad') {
          const amt2 = parseInt(c.amount, 10) || 0;
          const cat2 = isCleaningCategory(c.label) ? 'cleaning' : 'maintenance';
          if (cat2 === 'cleaning') cleaningCategoryTotal += amt2; else maintenanceTotal += amt2;
          items.push({ label: c.label, amount: amt2, note: c.note || '', category: cat2 });
        }
      });
    });
    const cleaningFee = parseInt(state.info.cleaningFee, 10) || 0;
    return {
      id: docId,
      building: state.info.building || '',
      unit: state.info.unit || '',
      date: state.info.date || '',
      check_time: state.info.checkTime || '',
      inspector: state.info.inspector || '',
      items,
      maintenance_total: maintenanceTotal,
      cleaning_total: cleaningFee + cleaningCategoryTotal,
      cleaning_fee: cleaningFee,
      final_note: state.finalNote || '',
      full_state: { info: state.info, items: state.items, custom: state.custom, finalNote: state.finalNote },
    };
  }

  async function handleSaveReport() {
    const incomplete = collectIncompleteDefects(state);
    if (incomplete.length) {
      const names = incomplete.slice(0, 6).join(', ') + (incomplete.length > 6 ? ' 외 ' + (incomplete.length - 6) + '건' : '');
      if (!confirm('확인이 필요한 하자 ' + incomplete.length + '건이 있어요: ' + names + '\n\n그래도 저장·복사할까요?')) return;
    }

    const text = buildOfficialFormReport(state, historyEntry);
    setReportText(text);
    setSaveStatus({ kind: '', text: '저장 확인 중…' });
    setPostStatus({ kind: '', text: '게시글 준비 확인 중…' });
    setImageStatus({ kind: '', text: '점검결과표 이미지 생성 중…' });
    setReportOpen(true);

    navigator.clipboard?.writeText(text).catch(() => {});

    supabase.from('inspections').upsert(buildInspectionRow())
      .then(({ error }) => {
        if (error) throw error;
        setSaveStatus({ kind: 'ok', text: '공유저장소 저장 완료' });
      })
      .catch(() => setSaveStatus({ kind: 'fail', text: '저장 실패 — 인터넷 연결 확인 후 다시 시도해주세요' }));

    addPriceHistoryRecords(supabase, state, SECTIONS).then(() => {
      fetchLearnedStats(supabase).then(setLearnedStats).catch(() => {});
    });

    try {
      const v1File = buildChecklistImageV1(state, SECTIONS);
      const v2File = buildChecklistImageV2(state, SECTIONS);
      const [v1Url, v2Url] = await Promise.all([
        uploadGeneratedImage(supabase, docId, v1File),
        uploadGeneratedImage(supabase, docId, v2File),
      ]);
      setImageStatus({ kind: 'ok', text: '점검결과표 이미지 생성 완료' });

      const plan = buildAttachmentPlan(state);
      const { error } = await supabase.from('post_queue').upsert({
        id: docId,
        building: state.info.building || '',
        unit: state.info.unit || '',
        date: state.info.date || '',
        title: buildNaverWorksTitle(state),
        body: buildNaverWorksBody(state, historyEntry),
        v1_image_url: v1Url,
        v2_image_url: v2Url,
        general_photos: plan.general,
        defects: plan.defects,
        status: 'pending',
        queued_at: new Date().toISOString(),
      });
      if (error) throw error;
      setPostStatus({ kind: 'ok', text: '게시글 준비 완료 — "게시글 올려줘"라고 하면 바로 올려드려요' });
    } catch (e) {
      setImageStatus({ kind: 'fail', text: '이미지 생성 실패: ' + e.message });
      setPostStatus({ kind: 'fail', text: '게시글 준비 실패 — 다시 시도해주세요' });
    }
  }

  return (
    <div className="wrap">
      <div className="masthead">
        <h1>퇴실점검 클립보드</h1>
        <p>항목마다 상태를 표시하고, 하자가 있으면 비고·금액을 적으세요. 사진·동영상은 각 항목에 바로 첨부할 수 있습니다(파일당 {MAX_PHOTO_MB}MB).</p>
      </div>

      <InfoGrid state={state} setInfo={setInfo} />
      <HistoryCard entry={historyEntry} building={state.info.building} unit={state.info.unit} />

      <div className="progress-bar">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: (totalItems ? (checkedItems / totalItems * 100) : 0) + '%' }} />
        </div>
        <span className="progress-label">{checkedItems}/{totalItems} 확인</span>
      </div>

      {SECTIONS.map((sec) => (
        <SectionBlock
          key={sec.id}
          sec={sec}
          state={state}
          setItem={setItem}
          setCustomItem={setCustomItem}
          addCustom={addCustom}
          removeCustom={removeCustom}
          docId={docId}
          supabase={supabase}
          open={openSection === sec.id}
          onToggle={() => setOpenSection(openSection === sec.id ? '' : sec.id)}
          learnedStats={learnedStats}
          onLightbox={setLightboxItem}
          showToast={showToast}
        />
      ))}

      <div className="memo-card">
        <label style={{ fontWeight: 700, display: 'block', marginBottom: 8 }}>기타사항</label>
        <textarea
          value={state.finalNote}
          onChange={(e) => setState((s) => ({ ...s, finalNote: e.target.value }))}
          placeholder="위 구분에 속하지 않는 특이사항을 자유롭게 적으세요."
        />
      </div>

      <div className="footer-bar">
        <div className="footer-stats">
          <span>하자 <b className={badCount ? 's-bad' : ''}>{badCount}건</b></span>
          <span>예상 금액 <b className="s-amount">{fmtWon(badTotal)}원</b></span>
        </div>
        <div className="footer-actions">
          <button type="button" className="btn" onClick={() => { if (confirm('새 점검을 시작할까요? 현재 입력 내용은 지워집니다.')) setState(defaultState()); }}>새 점검</button>
          <button type="button" className="btn primary" onClick={handleSaveReport}>리포트 저장·복사</button>
        </div>
      </div>

      {reportOpen && (
        <ReportOverlay
          text={reportText}
          saveStatus={saveStatus}
          postStatus={postStatus}
          imageStatus={imageStatus}
          onClose={() => setReportOpen(false)}
          onCopyAgain={() => navigator.clipboard?.writeText(reportText)}
        />
      )}
      <Lightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
      <Toast toasts={toasts} />
    </div>
  );
}
