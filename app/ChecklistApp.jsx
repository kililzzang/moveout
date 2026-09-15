'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
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
import { buildChecklistImageV1, buildChecklistImageV2, buildBlankTemplateImage } from '../lib/canvasImages';
import { BUILDING_ADDRESS } from '../lib/buildingAddress';
import CleanupPanel from './CleanupPanel';
import './checklist.css';

const STATUS_LABEL = { ok: '정상', bad: '하자', na: '해당없음' };
const RESP_LABEL = { tenant: '임차인', landlord: '임대인', negotiate: '협의필요' };
// 수파베이스 무료 플랜의 파일당 업로드 한도(50MB)에 맞춘 값 — 이보다 크면 애초에
// 업로드가 안 되므로, 그 전에 안내 문구로 걸러서 사용자가 다시 줄여서 올리게 한다.
const MAX_PHOTO_MB = 50;
const IMAGE_MAX_DIM = 1600;

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
    throw new Error(
      file.name + ' 용량이 ' + MAX_PHOTO_MB + 'MB를 넘어요. 영상이면 길이를 줄이거나 '
      + '갤러리 앱에서 압축한 뒤 다시 올려주세요.'
    );
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

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function Toast({ toasts }) {
  return (
    <div className="toast-stack">
      {toasts.map((t) => <div className="toast" key={t.id}>{t.text}</div>)}
    </div>
  );
}

// 2026-09-15: 네이버웍스 게시 중 로딩 화면(박길일님 요청) — 사진 개수에 따라
// 게시가 몇 초 걸릴 수 있어서, 버튼 글자만 바뀌는 것보다 화면을 덮는 표시가 더
// 분명하다. ReportOverlay 위에 한 번 더 겹쳐서 그 아래 버튼도 못 누르게 막는다.
function PostingOverlay() {
  return (
    <div className="posting-overlay">
      <div className="posting-box">
        <div className="spinner" />
        <p>네이버웍스에 게시 중입니다…<br />잠시만 기다려주세요.</p>
      </div>
    </div>
  );
}

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

// 건물명 드롭박스 + "기타(직접입력)" — moveout-checklist.html의 buildBuildingField와 동일한 UX.
function BuildingField({ value, onChange }) {
  const isKnown = KNOWN_BUILDINGS.includes(value);
  const isOther = value !== '' && !isKnown;
  const [showOther, setShowOther] = useState(isOther);

  return (
    <div className="field building-field">
      <label>건물명</label>
      <select
        value={showOther ? '__other__' : value}
        onChange={(e) => {
          if (e.target.value === '__other__') { setShowOther(true); onChange(''); }
          else { setShowOther(false); onChange(e.target.value); }
        }}
      >
        <option value="">선택하세요</option>
        {KNOWN_BUILDINGS.map((b) => <option value={b} key={b}>{b}</option>)}
        <option value="__other__">기타 (직접입력)</option>
      </select>
      {showOther && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="건물명을 직접 입력하세요"
        />
      )}
    </div>
  );
}

function InfoGrid({ state, setInfo }) {
  // 지번주소는 건물별로 정해진 고정값이라, 건물명이 표에 있는 주소를 갖고 있으면
  // 자동으로 채우고 수정 못 하게 잠근다(건물명을 바꾸면 그 즉시 따라서 바뀜) —
  // 표에 아직 주소가 없는 건물이거나 "기타 직접입력"일 때만 직접 타이핑할 수 있다.
  const addressLocked = !!BUILDING_ADDRESS[state.info.building];
  return (
    <div className="info-card">
      <div className="info-grid">
        {INFO_FIELDS.map((f) => {
          if (f.id === 'building') {
            return <BuildingField key={f.id} value={state.info.building} onChange={(v) => setInfo('building', v)} />;
          }
          if (f.id === 'jibunAddress') {
            return (
              <div className="field" key={f.id}>
                <label>{f.label}{addressLocked ? ' (건물별 고정값)' : ''}</label>
                <input
                  type="text"
                  value={state.info.jibunAddress}
                  readOnly={addressLocked}
                  onChange={(e) => setInfo('jibunAddress', e.target.value)}
                  placeholder={addressLocked ? undefined : '아직 등록 안 된 건물 — 직접 입력'}
                />
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

// 2026-09-15: 박길일님 요청으로 "이전호실점검내역"과 "하자보수완료내역"을 한 화면에
// 같이 보여주고, 그 밑에 비고(의견)란을 붙였다. 하자보수완료내역은 아직 연동된
// 데이터가 없어서(추후 데이터 반영 예정) 지금은 안내 문구만 있는 자리표시자다.
function PrevInspectionCard({ entry }) {
  return (
    <div className="history-card">
      <b>이전 호실 점검 내역</b>
      {entry ? (
        <div style={{ marginTop: 8 }}>
          <b>{entry.d}{entry.co ? ' (퇴실)' : ' (입주 확인)'}</b>
          <div>
            {entry.i.map((it, i) => (
              <div key={i}>· {it[0]}{it[1] ? ' (' + fmtWon(it[1]) + '원)' : ''}</div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 8, color: 'var(--ink-soft)' }}>이전 점검 기록이 없어요.</div>
      )}
    </div>
  );
}

function RepairHistoryCard() {
  return (
    <div className="history-card">
      <b>하자보수 완료내역</b>
      <div style={{ marginTop: 8, color: 'var(--ink-soft)' }}>
        아직 연동된 데이터가 없어요 — 추후 실제 보수 완료 내역이 여기에 표시될 예정입니다.
      </div>
    </div>
  );
}

function HistoryPanel({ entry, building, unit, remark, onRemarkChange }) {
  if (!building || !unit) return null;
  return (
    <div className="history-panel-wrap">
      <div className="history-panel-caption">{building} {unit}호 (참고용)</div>
      <div className="history-panel">
        <PrevInspectionCard entry={entry} />
        <RepairHistoryCard />
      </div>
      <div className="memo-card" style={{ marginTop: 0 }}>
        <label style={{ fontWeight: 700, display: 'block', marginBottom: 8 }}>비고(의견)</label>
        <textarea
          value={remark}
          onChange={(e) => onRemarkChange(e.target.value)}
          placeholder="위 이력을 보고 참고할 의견을 적어주세요."
        />
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

function ItemRow({ label, hint, meta, entry, onChange, onDelete, docId, supabase, onLightbox, showToast, isLast, onAdvance }) {
  const [noteOpen, setNoteOpen] = useState(!!entry.note);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const generalInputRef = useRef(null);
  const defectInputRef = useRef(null);

  function setStatus(status) {
    // 마지막 항목은 상태만 바꾸고는 다음 섹션으로 자동 넘어가지 않는다 — 사진을 아직
    // 안 올렸을 수 있어서(사진 업로드가 끝나야 넘어감). 사진이 필요 없으면 사용자가
    // 직접 스크롤하면 된다.
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
      if (isLast && onAdvance) onAdvance();
    } catch (e) {
      // 안내 문구라 기본 토스트(3.2초)보다 좀 더 오래 보여준다 -- 읽고 다시 시도할
      // 시간을 준다.
      showToast('업로드 실패: ' + e.message, 6000);
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

  // 2026-09-15: 단가 학습기능(팀 학습 표준가) 삭제 — 이제 표준가는 SECTIONS에 박힌
  // 고정 시드값(meta.std) 하나만 쓴다. 대신 게시글의 최종 청구액과 실제 입금액을
  // 대조해서 정확도를 올리는 방식으로 바꿀 예정(박길일님 요청, 별도 기능으로 진행).
  const effectiveStd = meta && meta.std;

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
        <button type="button" className="chip" onClick={() => setNoteOpen((v) => !v)}>내용입력</button>
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
          {/* 2026-09-15: 하자로 체크된 항목은 "사진 추가"(일반) 버튼을 없애고 "하자사진
              추가" 하나만 남긴다 — 예전엔 하자 항목에서도 두 버튼이 같이 떠서, 일반
              버튼으로 올린 사진이 report.js의 게시글 조립에서 하자 캡션 없이 general
              쪽에만 실리는 경우가 있었다(박길일님 요청: 하자 체크 항목의 사진/동영상은
              하자사진에만 들어가야 함). */}
          {entry.status === 'bad' ? (
            <>
              <input ref={defectInputRef} type="file" accept="image/*,video/*" multiple hidden
                onChange={(e) => { handleFiles(e.target.files, true); e.target.value = ''; }} />
              <button type="button" className="btn bad" disabled={busy} onClick={() => defectInputRef.current.click()}>
                {uploadProgress ? (uploadProgress.done + 1) + '/' + uploadProgress.total + ' 업로드 중…' : '하자사진 추가'}
              </button>
            </>
          ) : (
            <>
              <input ref={generalInputRef} type="file" accept="image/*,video/*" multiple hidden
                onChange={(e) => { handleFiles(e.target.files, false); e.target.value = ''; }} />
              <button type="button" className="btn" disabled={busy} onClick={() => generalInputRef.current.click()}>
                {uploadProgress ? (uploadProgress.done + 1) + '/' + uploadProgress.total + ' 업로드 중…' : '사진 추가'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionBlock({ sec, state, setItem, setCustomItem, addCustom, removeCustom, docId, supabase, open, onToggle, onLightbox, showToast, onAdvance, sectionRef }) {
  const [newLabel, setNewLabel] = useState('');
  const items = sec.items;
  const checked = items.filter((it, idx) => state.items[sec.id + ':' + idx].status).length;
  const hasBad = items.some((it, idx) => state.items[sec.id + ':' + idx].status === 'bad')
    || (state.custom[sec.id] || []).some((c) => c.status === 'bad');
  const lastIdx = items.length - 1;

  return (
    <div className="section" ref={sectionRef}>
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
              onLightbox={onLightbox}
              showToast={showToast}
              isLast={idx === lastIdx}
              onAdvance={onAdvance}
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

function ReportOverlay({ text, saveStatus, postStatus, imageStatus, onClose, onCopyAgain, onPost, posting, posted }) {
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
          {/* 2026-09-15: 네이버웍스 자동게시(API 직접 호출) 버튼 — 로그인한 사람 계정으로
              바로 게시된다. 로그인 필요, /api/naverworks/post 호출. */}
          <button type="button" className="btn" onClick={onPost} disabled={posting || posted}>
            {posted ? '게시 완료' : posting ? '게시 중…' : '네이버웍스에 게시'}
          </button>
          <button type="button" className="btn primary" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

export default function ChecklistApp() {
  const supabase = useMemo(() => createClient(), []);
  // localStorage 읽기를 useState의 지연 초기값으로 처리 — 예전엔 마운트 후
  // useEffect에서 비동기로 불러오다가, 그 사이(초기 렌더의 빈 state)에 저장 이펙트가
  // 먼저 한 번 실행되면서 순간적으로 localStorage를 빈 값으로 덮어쓰는 경합이 있었다
  // (실제로 새로고침 후 입력이 사라지는 현상으로 나타남). 지연 초기값은 첫 렌더 때
  // 동기적으로 실행되어 그 경합 자체가 생기지 않는다.
  const [state, setState] = useState(() => loadState());
  const [openSection, setOpenSection] = useState(SECTIONS[0].id);
  const [historyEntry, setHistoryEntry] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState('');
  const [saveStatus, setSaveStatus] = useState({ kind: '', text: '' });
  const [postStatus, setPostStatus] = useState({ kind: '', text: '' });
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);
  const [imageStatus, setImageStatus] = useState({ kind: '', text: '' });
  const [lightboxItem, setLightboxItem] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const sectionRefs = useRef({});

  function showToast(text, ms) {
    const id = uid();
    setToasts((t) => t.concat([{ id, text }]));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms || 3200);
  }

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

  // 섹션을 열 때(수동 클릭이든 자동 진행이든) 화면을 그 섹션 맨 위로 스크롤한다 —
  // 새로 열린 섹션의 "끝부분"이 아니라 "시작"이 보여야 한다는 요청 반영.
  function openSectionAndScroll(id) {
    setOpenSection(id);
    requestAnimationFrame(() => {
      const el = sectionRefs.current[id];
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function advanceToNextSection(fromId) {
    const idx = SECTIONS.findIndex((s) => s.id === fromId);
    const next = SECTIONS[idx + 1];
    if (next) openSectionAndScroll(next.id);
  }

  function setInfo(id, value) {
    setState((s) => {
      const info = { ...s.info, [id]: value };
      // 지번주소는 건물의 고정값 — 건물명이 바뀌면 무조건 그 건물의 주소로 맞춘다
      // (표에 없는 건물이면 비워서 직접 입력할 수 있게 둔다).
      if (id === 'building') {
        info.jibunAddress = BUILDING_ADDRESS[value] || '';
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
    return {
      id: docId,
      building: state.info.building || '',
      unit: state.info.unit || '',
      date: state.info.date || '',
      check_time: state.info.checkTime || '',
      inspector: state.info.inspector || '',
      items,
      maintenance_total: maintenanceTotal,
      // 2026-09-15: "청소 추가금액" 수동입력 필드는 삭제(박길일님 요청) — cleaning_total은
      // 이제 청소 카테고리 하자 항목 합산액 그대로다(cleaning_fee 컬럼은 기본값 0으로
      // Supabase에 남겨두고 여기서는 더 안 채움).
      cleaning_total: cleaningCategoryTotal,
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
    setPosted(false);
    setReportOpen(true);

    navigator.clipboard?.writeText(text).catch(() => {});

    supabase.from('inspections').upsert(buildInspectionRow())
      .then(({ error }) => {
        if (error) throw error;
        setSaveStatus({ kind: 'ok', text: '공유저장소 저장 완료' });
      })
      .catch(() => setSaveStatus({ kind: 'fail', text: '저장 실패 — 인터넷 연결 확인 후 다시 시도해주세요' }));

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
      setPostStatus({ kind: 'ok', text: '게시글 준비 완료 — 아래 "네이버웍스에 게시" 버튼을 누르면 바로 올라가요' });
    } catch (e) {
      setImageStatus({ kind: 'fail', text: '이미지 생성 실패: ' + e.message });
      setPostStatus({ kind: 'fail', text: '게시글 준비 실패 — 다시 시도해주세요' });
    }
  }

  // 2026-09-15: 네이버웍스 자동게시 버튼. 로그인한 사람 계정으로 API를 직접 호출해서
  // 게시한다(더 이상 "게시글 올려줘"라고 말해서 브라우저 자동화를 거칠 필요 없음).
  // 로그인 세션은 쿠키로 자동 전달되므로 별도로 토큰을 넘길 필요는 없다.
  async function handlePostToNaverWorks() {
    setPosting(true);
    setPostStatus({ kind: '', text: '네이버웍스에 게시 중…' });
    try {
      const res = await fetch('/api/naverworks/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: docId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('게시 실패: ' + res.status));
      setPosted(true);
      setPostStatus({ kind: 'ok', text: '네이버웍스 게시 완료' });
      showToast('네이버웍스에 게시했어요');
    } catch (e) {
      setPostStatus({ kind: 'fail', text: '게시 실패: ' + e.message });
    } finally {
      setPosting(false);
    }
  }

  // "새 점검" — 지우기 전에 정말 지울지만 확인한다. 예전엔 여기서 이번에 적어둔 하자
  // 금액을 "표준가 학습 데이터"로 저장할지 한 번 더 물었는데, 그 단가 학습기능 자체를
  // 삭제(박길일님 요청)하면서 이 단계도 함께 뺐다.
  function handleReset() {
    if (!confirm('새 점검을 시작할까요? 현재 입력 내용은 지워집니다.')) return;
    setState(defaultState());
    setOpenSection(SECTIONS[0].id);
  }

  return (
    <div className="wrap">
      <div className="masthead">
        <h1>퇴실점검 클립보드</h1>
        <p>항목마다 상태를 표시하고, 하자가 있으면 비고·금액을 적으세요. 사진·동영상은 각 항목에 바로 첨부할 수 있습니다(파일당 {MAX_PHOTO_MB}MB).</p>
      </div>

      <InfoGrid state={state} setInfo={setInfo} />
      <HistoryPanel
        entry={historyEntry}
        building={state.info.building}
        unit={state.info.unit}
        remark={state.historyRemark}
        onRemarkChange={(v) => setState((s) => ({ ...s, historyRemark: v }))}
      />

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
          onToggle={() => openSectionAndScroll(openSection === sec.id ? '' : sec.id)}
          onLightbox={setLightboxItem}
          showToast={showToast}
          onAdvance={() => advanceToNextSection(sec.id)}
          sectionRef={(el) => { sectionRefs.current[sec.id] = el; }}
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
          <button type="button" className="btn" onClick={handleReset}>새 점검</button>
          <button type="button" className="btn" onClick={() => downloadFile(buildBlankTemplateImage(SECTIONS))}>오프라인 빈 양식</button>
          <button type="button" className="btn" onClick={() => setCleanupOpen(true)}>정리함</button>
          <Link href="/repair" target="_blank" className="btn">보수작업 목록</Link>
          <Link href="/cleaning" target="_blank" className="btn">청소작업 목록</Link>
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
          onPost={handlePostToNaverWorks}
          posting={posting}
          posted={posted}
        />
      )}
      {cleanupOpen && (
        <CleanupPanel
          supabase={supabase}
          onClose={() => setCleanupOpen(false)}
          onLoad={(fullState) => {
            setState((s) => ({
              info: { ...defaultState().info, ...fullState.info },
              items: { ...defaultState().items, ...fullState.items },
              open: s.open,
              custom: fullState.custom || defaultState().custom,
              finalNote: fullState.finalNote || '',
              historyRemark: fullState.historyRemark || '',
            }));
            showToast('불러왔습니다');
          }}
        />
      )}
      <Lightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
      <Toast toasts={toasts} />
      {posting && <PostingOverlay />}
    </div>
  );
}
