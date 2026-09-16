'use client';
import { useMemo, useState } from 'react';
import { createClient } from '../../lib/supabaseClient';
import { fetchLatestHistoryEntry, fetchRepairHistoryForUnitKey } from '../../lib/history';
import { fmtWon } from '../../lib/report';
import { KNOWN_BUILDINGS } from '../../lib/checklistState';
import TopNav from '../_shared/TopNav';
import { syncOrderToNotion } from '../../lib/notionSyncClient';

// 2026-09-16 신설 — "하자보수 클립보드"(박길일님 설계): /assignments가 "나한테
// 배정된 것만" 보여주는 것과 달리, 여기는 호실을 직접 입력하면 그 호실의 가장
// 최근 점검에서 나온 하자 목록을 바로 불러와 체크할 수 있다. 관리자 배정 화면이
// 아직 없어도(work_orders에 담당자가 안 정해져 있어도) 보수 작업자가 바로 쓸 수
// 있게 하려는 목적 — 대신 로그인만 하면 누구나 쓸 수 있어서(이 팀 전체 공유
// 정책과 동일), "내 담당" 개념 없이 그 호실을 실제로 고친 사람이 체크하면 된다.
export default function RepairClipboard() {
  const supabase = useMemo(() => createClient(), []);
  const [building, setBuilding] = useState('');
  const [buildingOther, setBuildingOther] = useState('');
  const [unit, setUnit] = useState('');
  const [loading, setLoading] = useState(false);
  const [looked, setLooked] = useState(false);
  const [entry, setEntry] = useState(null);
  const [order, setOrder] = useState(null); // { id, repair_status, repair_items, repair_note }
  const [items, setItems] = useState([]);
  const [note, setNote] = useState('');
  const [saveStatus, setSaveStatus] = useState('');

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
      const wo = await fetchRepairHistoryForUnitKey(supabase, foundEntry.id).catch(() => null);
      // fetchRepairHistoryForUnitKey는 repair_status/repair_items/repair_completed_at만
      // 돌려주니, id·repair_note는 따로 한 번 더 조회한다(수정 시 필요).
      if (wo) {
        const { data: full } = await supabase
          .from('work_orders')
          .select('id, repair_status, repair_items, repair_note')
          .eq('unit_key', foundEntry.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        setOrder(full || null);
        setItems((full && full.repair_items) || []);
        setNote((full && full.repair_note) || '');
      } else {
        setOrder(null);
        setItems([]);
        setNote('');
      }
    } else {
      setOrder(null);
      setItems([]);
      setNote('');
    }
    setLoading(false);
  }

  function toggleItem(idx) {
    setItems((its) => its.map((it, i) => (i === idx ? { ...it, done: !it.done } : it)));
  }

  async function handleSave(markComplete) {
    if (!order) return;
    setSaveStatus('저장 중…');
    const patch = { repair_items: items, repair_note: note };
    if (markComplete) {
      patch.repair_status = 'completed';
      patch.repair_completed_at = new Date().toISOString();
    }
    const { error } = await supabase.from('work_orders').update(patch).eq('id', order.id);
    setSaveStatus(error ? '저장 실패 — 다시 시도해주세요' : (markComplete ? '완료 처리했어요' : '저장했어요'));
    if (!error && markComplete) setOrder((o) => ({ ...o, repair_status: 'completed' }));
    if (!error) syncOrderToNotion(order.id);
  }

  return (
    <>
      <TopNav />
      <div className="wrap">
      <div className="masthead">
        <h1>하자보수 클립보드</h1>
        <p>건물명·호실을 입력하면 가장 최근 점검에서 나온 보수 대상 하자를 불러옵니다. 고친 항목을 체크하고, 필요하면 추가사항을 적어주세요.</p>
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
            {order.repair_status === 'completed' && (
              <span className="section-flag" style={{ background: 'var(--ok-bg)', color: 'var(--ok)', marginLeft: 8 }}>보수 완료 처리됨</span>
            )}
          </div>

          {items.length === 0 ? (
            <div className="cleanup-empty">이 점검에는 보수 대상 하자가 없었어요.</div>
          ) : (
            <div className="info-card">
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {items.map((it, idx) => (
                  <li key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderTop: idx ? '1px solid var(--line-soft)' : 'none' }}>
                    <input
                      type="checkbox"
                      id={`repair-clip-item-${idx}`}
                      checked={!!it.done}
                      onChange={() => toggleItem(idx)}
                      style={{ marginTop: 3, width: 18, height: 18 }}
                    />
                    <label htmlFor={`repair-clip-item-${idx}`} style={{ flex: 1, textDecoration: it.done ? 'line-through' : 'none', color: it.done ? 'var(--ink-faint)' : 'var(--ink)' }}>
                      {it.label}{it.note ? ' — ' + it.note : ''}{it.amount ? ' (' + fmtWon(it.amount) + '원)' : ''}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="memo-card">
            <label style={{ fontWeight: 700, display: 'block', marginBottom: 8 }}>추가사항</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="자재 교체 내역, 특이사항 등을 적어주세요." />
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
    </>
  );
}
