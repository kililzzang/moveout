'use client';
import { useMemo, useState } from 'react';
import { createClient } from '../../lib/supabaseClient';
import { fetchLatestHistoryEntry, fetchCleaningHistoryForUnitKey } from '../../lib/history';
import { fmtWon } from '../../lib/report';
import { KNOWN_BUILDINGS } from '../../lib/checklistState';

// 2026-09-16 신설 — "청소완료 클립보드"(박길일님 설계). 하자보수 클립보드와 구조는
// 같되(호실 입력 → 최근 점검의 청소 대상 항목 불러와 체크), 청소는 일하면서 새로
// 발견하는 하자가 있을 수 있어서 그 자리에서 추가로 기록하는 기능이 하나 더 있다
// (박길일님 요청: "청소 시 발견된 하자내역 추가 가능").
export default function CleaningClipboard() {
  const supabase = useMemo(() => createClient(), []);
  const [building, setBuilding] = useState('');
  const [buildingOther, setBuildingOther] = useState('');
  const [unit, setUnit] = useState('');
  const [loading, setLoading] = useState(false);
  const [looked, setLooked] = useState(false);
  const [entry, setEntry] = useState(null);
  const [order, setOrder] = useState(null); // { id, cleaning_status, cleaning_items, cleaning_found_defects, cleaning_note }
  const [items, setItems] = useState([]);
  const [foundDefects, setFoundDefects] = useState([]);
  const [note, setNote] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newAmount, setNewAmount] = useState('');

  async function handleLookup() {
    const b = (building === '__other__' ? buildingOther : building).trim();
    const u = unit.trim();
    if (!b || !u) return;
    setLoading(true);
    setLooked(true);
    setSaveStatus('');
    const foundEntry = await fetchLatestHistoryEntry(supabase, b, u).catch(() => null);
    setEntry(foundEntry);
    if (foundEntry && foundEntry.id) {
      const wo = await fetchCleaningHistoryForUnitKey(supabase, foundEntry.id).catch(() => null);
      if (wo) {
        const { data: full } = await supabase
          .from('work_orders')
          .select('id, cleaning_status, cleaning_items, cleaning_found_defects, cleaning_note')
          .eq('unit_key', foundEntry.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        setOrder(full || null);
        setItems((full && full.cleaning_items) || []);
        setFoundDefects((full && full.cleaning_found_defects) || []);
        setNote((full && full.cleaning_note) || '');
      } else {
        setOrder(null);
        setItems([]);
        setFoundDefects([]);
        setNote('');
      }
    } else {
      setOrder(null);
      setItems([]);
      setFoundDefects([]);
      setNote('');
    }
    setLoading(false);
  }

  function toggleItem(idx) {
    setItems((its) => its.map((it, i) => (i === idx ? { ...it, done: !it.done } : it)));
  }

  function addFoundDefect() {
    if (!newLabel.trim()) return;
    setFoundDefects((f) => f.concat([{ label: newLabel.trim(), amount: parseInt(newAmount, 10) || 0 }]));
    setNewLabel('');
    setNewAmount('');
  }

  function removeFoundDefect(idx) {
    setFoundDefects((f) => f.filter((_, i) => i !== idx));
  }

  async function handleSave(markComplete) {
    if (!order) return;
    setSaveStatus('저장 중…');
    const patch = { cleaning_items: items, cleaning_found_defects: foundDefects, cleaning_note: note };
    if (markComplete) {
      patch.cleaning_status = 'completed';
      patch.cleaning_completed_at = new Date().toISOString();
    }
    const { error } = await supabase.from('work_orders').update(patch).eq('id', order.id);
    setSaveStatus(error ? '저장 실패 — 다시 시도해주세요' : (markComplete ? '완료 처리했어요' : '저장했어요'));
    if (!error && markComplete) setOrder((o) => ({ ...o, cleaning_status: 'completed' }));
  }

  return (
    <div className="wrap">
      <div className="masthead">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h1>청소완료 클립보드</h1>
          <a href="/api/auth/logout" className="btn" style={{ flexShrink: 0 }}>로그아웃</a>
        </div>
        <p>건물명·호실을 입력하면 가장 최근 점검에서 나온 청소 대상 항목을 불러옵니다. 청소하다 새로 발견한 하자가 있으면 그 자리에서 추가해주세요.</p>
      </div>

      <div className="info-card">
        <div className="info-grid">
          <div className="field building-field">
            <label>건물명</label>
            <select value={building} onChange={(e) => setBuilding(e.target.value)}>
              <option value="">선택하세요</option>
              {KNOWN_BUILDINGS.map((b) => <option value={b} key={b}>{b}</option>)}
              <option value="__other__">기타 (직접입력)</option>
            </select>
            {building === '__other__' && (
              <input type="text" value={buildingOther} onChange={(e) => setBuildingOther(e.target.value)} placeholder="건물명을 직접 입력하세요" style={{ marginTop: 6 }} />
            )}
          </div>
          <div className="field">
            <label>호실</label>
            <input type="text" inputMode="numeric" pattern="[0-9]*" value={unit} onChange={(e) => setUnit(e.target.value.replace(/[^0-9]/g, ''))} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn primary" onClick={handleLookup} disabled={loading}>
            {loading ? '조회 중…' : '조회'}
          </button>
        </div>
      </div>

      {looked && !loading && !entry && (
        <div className="cleanup-empty">이 호실의 점검 기록을 찾지 못했어요. 건물명·호실을 다시 확인해주세요.</div>
      )}

      {looked && !loading && entry && !order && (
        <div className="cleanup-empty">
          최근 점검({entry.d})은 찾았지만, 아직 이 앱의 작업 배정 데이터(work_orders)가 없는 기록이에요 — 담당자에게 직접 확인해주세요.
        </div>
      )}

      {looked && !loading && entry && order && (
        <>
          <div className="history-card">
            <b>{entry.d}{entry.co ? ' (퇴실)' : ' (입주 확인)'} 점검 기준</b>
            {order.cleaning_status === 'completed' && (
              <span className="section-flag" style={{ background: 'var(--ok-bg)', color: 'var(--ok)', marginLeft: 8 }}>청소 완료 처리됨</span>
            )}
          </div>

          {items.length === 0 ? (
            <div className="cleanup-empty">이 점검에는 청소 대상 항목(흡연·스티커·폐기물 등)이 없었어요.</div>
          ) : (
            <div className="info-card">
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {items.map((it, idx) => (
                  <li key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderTop: idx ? '1px solid var(--line-soft)' : 'none' }}>
                    <input
                      type="checkbox"
                      id={`cleaning-clip-item-${idx}`}
                      checked={!!it.done}
                      onChange={() => toggleItem(idx)}
                      style={{ marginTop: 3, width: 18, height: 18 }}
                    />
                    <label htmlFor={`cleaning-clip-item-${idx}`} style={{ flex: 1, textDecoration: it.done ? 'line-through' : 'none', color: it.done ? 'var(--ink-faint)' : 'var(--ink)' }}>
                      {it.label}{it.note ? ' — ' + it.note : ''}{it.amount ? ' (' + fmtWon(it.amount) + '원)' : ''}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="info-card">
            <label style={{ fontWeight: 700, display: 'block', marginBottom: 8 }}>청소 중 새로 발견한 하자</label>
            {foundDefects.length > 0 && (
              <ul style={{ listStyle: 'none', margin: '0 0 10px', padding: 0 }}>
                {foundDefects.map((d, i) => (
                  <li key={i} className="cleanup-item" style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{d.label}{d.amount ? ' (' + fmtWon(d.amount) + '원)' : ''}</span>
                    <button type="button" className="btn bad" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => removeFoundDefect(i)}>삭제</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="custom-add-row" style={{ padding: 0 }}>
              <input type="text" placeholder="항목명 (예: 벽지 얼룩)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
              <input type="number" placeholder="금액" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} style={{ width: 100 }} />
              <button type="button" className="btn" onClick={addFoundDefect}>추가</button>
            </div>
          </div>

          <div className="memo-card">
            <label style={{ fontWeight: 700, display: 'block', marginBottom: 8 }}>추가사항</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="특수청소 여부 등 특이사항을 적어주세요." />
          </div>

          <div className="footer-bar" style={{ position: 'static', marginTop: 0 }}>
            <div className="footer-stats"><span>{saveStatus}</span></div>
            <div className="footer-actions">
              <button type="button" className="btn" onClick={() => handleSave(false)}>저장만</button>
              <button type="button" className="btn primary" onClick={() => handleSave(true)}>완료 처리</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
