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
import './checklist.css';

const STATUS_LABEL = { ok: '정상', bad: '하자', na: '해당없음' };
const MAX_PHOTO_MB = 20;

// ---- 사진 업로드 ----
async function uploadPhoto(supabase, docId, file, isDefect) {
  if (file.size > MAX_PHOTO_MB * 1024 * 1024) {
    throw new Error('파일이 ' + MAX_PHOTO_MB + 'MB를 넘어요: ' + file.name);
  }
  const safeName = file.name.replace(/[^A-Za-z0-9_.\-]/g, '_');
  const path = docId + '/' + uid() + '-' + safeName;
  const { error } = await supabase.storage.from('photos').upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from('photos').getPublicUrl(path);
  return { id: path, url: data.publicUrl, contentType: file.type, isDefect: !!isDefect };
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

function PhotoThumbs({ photos, onDelete }) {
  if (!photos.length) return null;
  return (
    <div className="photo-thumbs">
      {photos.map((p, i) => (
        <div className="photo-thumb" key={p.id}>
          {p.contentType && p.contentType.startsWith('video') ? (
            <video src={p.url} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.url} alt="" />
          )}
          <button type="button" className="photo-thumb-del" onClick={() => onDelete(i)}>×</button>
        </div>
      ))}
    </div>
  );
}

function ItemRow({ label, hint, meta, entry, onChange, onDelete, docId, supabase }) {
  const [noteOpen, setNoteOpen] = useState(!!entry.note);
  const [busy, setBusy] = useState(false);
  const generalInputRef = useRef(null);
  const defectInputRef = useRef(null);

  function setStatus(status) {
    onChange({ status: status === entry.status ? '' : status });
  }

  async function handleFiles(files, isDefect) {
    if (!files || !files.length) return;
    setBusy(true);
    try {
      let photos = entry.photos || [];
      for (const file of Array.from(files)) {
        const p = await uploadPhoto(supabase, docId, file, isDefect);
        photos = photos.concat([p]);
        onChange({ photos });
      }
    } catch (e) {
      alert('업로드 실패: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  function deletePhoto(idx) {
    const photos = (entry.photos || []).slice();
    const [removed] = photos.splice(idx, 1);
    onChange({ photos });
    if (removed) supabase.storage.from('photos').remove([removed.id]).catch(() => {});
  }

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
            {meta && meta.std ? (
              <button type="button" className="price-hint" onClick={() => onChange({ amount: String(meta.std) })}>
                표준가 적용 {fmtWon(meta.std)}원{meta.unit ? ' (' + meta.unit + ')' : ''}
              </button>
            ) : null}
          </div>
          <div className="chips">
            {[['tenant', '임차인'], ['landlord', '임대인'], ['negotiate', '협의필요']].map(([v, l]) => (
              <button
                type="button"
                key={v}
                className={'resp-chip' + (entry.responsibility === v ? ' active-' + v : '')}
                onClick={() => onChange({ responsibility: v === entry.responsibility ? '' : v })}
              >
                {l}
              </button>
            ))}
          </div>
          {meta && meta.respNote && <div className="item-hint">{meta.respNote}</div>}
        </>
      )}

      <div className="photo-row">
        <PhotoThumbs photos={entry.photos || []} onDelete={deletePhoto} />
        <div className="photo-add-row">
          <input ref={generalInputRef} type="file" accept="image/*,video/*" multiple hidden
            onChange={(e) => { handleFiles(e.target.files, false); e.target.value = ''; }} />
          <button type="button" className="btn" disabled={busy} onClick={() => generalInputRef.current.click()}>
            {busy ? '업로드 중…' : '사진 추가'}
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

function SectionBlock({ sec, state, setItem, setCustomItem, addCustom, removeCustom, docId, supabase, open, onToggle }) {
  const [newLabel, setNewLabel] = useState('');
  const items = sec.items;
  const checked = items.filter((it, idx) => state.items[sec.id + ':' + idx].status).length;

  return (
    <div className="section">
      <button type="button" className="section-head" onClick={onToggle}>
        {sec.title}
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

function ReportOverlay({ text, saveStatus, postStatus, onClose, onCopyAgain }) {
  return (
    <div className="overlay">
      <div className="report-box">
        <h3 style={{ marginTop: 0 }}>리포트</h3>
        <div className={'report-status-row ' + saveStatus.kind}>{saveStatus.text}</div>
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

  useEffect(() => { setState(loadState()); }, []);
  useEffect(() => { saveState(state); }, [state]);

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

  function setInfo(id, value) {
    setState((s) => ({ ...s, info: { ...s.info, [id]: value } }));
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
    setPostStatus({ kind: '', text: '게시글 준비 중…' });
    setReportOpen(true);

    navigator.clipboard?.writeText(text).catch(() => {});

    supabase.from('inspections').upsert(buildInspectionRow())
      .then(({ error }) => {
        if (error) throw error;
        setSaveStatus({ kind: 'ok', text: '공유저장소 저장 완료' });
      })
      .catch(() => setSaveStatus({ kind: 'fail', text: '저장 실패 — 인터넷 연결 확인 후 다시 시도해주세요' }));

    const plan = buildAttachmentPlan(state);
    supabase.from('post_queue').upsert({
      id: docId,
      building: state.info.building || '',
      unit: state.info.unit || '',
      date: state.info.date || '',
      title: buildNaverWorksTitle(state),
      body: buildNaverWorksBody(state, historyEntry),
      general_photos: plan.general,
      defects: plan.defects,
      status: 'pending',
      queued_at: new Date().toISOString(),
    }).then(({ error }) => {
      if (error) throw error;
      setPostStatus({ kind: 'ok', text: '게시글 준비 완료 — "게시글 올려줘"라고 하면 바로 올려드려요' });
    }).catch(() => setPostStatus({ kind: 'fail', text: '게시글 준비 실패 — 다시 시도해주세요' }));
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
        <button type="button" className="btn" onClick={() => { if (confirm('새 점검을 시작할까요? 현재 입력 내용은 지워집니다.')) setState(defaultState()); }}>새 점검</button>
        <button type="button" className="btn primary" onClick={handleSaveReport}>리포트 저장·복사</button>
      </div>

      {reportOpen && (
        <ReportOverlay
          text={reportText}
          saveStatus={saveStatus}
          postStatus={postStatus}
          onClose={() => setReportOpen(false)}
          onCopyAgain={() => navigator.clipboard?.writeText(reportText)}
        />
      )}
    </div>
  );
}
