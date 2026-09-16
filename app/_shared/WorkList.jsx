'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '../../lib/supabaseClient';
import { fmtWon, formatDateKorean } from '../../lib/report';
import { KNOWN_BUILDINGS } from '../../lib/checklistState';

// 보수작업자/청소작업자 기준 페이지가 공유하는 화면 — 둘 다 "inspections" 표에서
// 호실별 최신 점검 하나(items 배열)를 가져와 category('maintenance'|'cleaning')로
// 걸러 보여주기만 하는 점이 똑같아서 컴포넌트 하나로 합쳤다. inspections는 호실당
// 딱 1행(같은 건물_호실이면 점검할 때마다 덮어쓰기)이라 항상 "지금 이 순간 그
// 호실에 남아있는 작업"만 보인다 — 예전 점검에서 고쳐진 항목은 다음 점검에서
// 자동으로 빠진다.
export default function WorkList({ category, title, subtitle, emptyText }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState(null);
  const [building, setBuilding] = useState('');

  useEffect(() => {
    supabase
      .from('inspections')
      .select('id, building, unit, date, inspector, items, maintenance_total, cleaning_total, final_note, saved_at')
      .order('saved_at', { ascending: false })
      .limit(300)
      .then(({ data, error }) => setRows(error ? [] : (data || [])));
  }, [supabase]);

  const units = useMemo(() => {
    if (!rows) return [];
    return rows
      .map((r) => ({
        ...r,
        catItems: (r.items || []).filter((it) => it.category === category),
        catTotal: category === 'cleaning' ? r.cleaning_total : r.maintenance_total,
      }))
      .filter((r) => r.catItems.length > 0)
      .filter((r) => !building || r.building === building);
  }, [rows, category, building]);

  const buildingsInData = useMemo(() => {
    if (!rows) return [];
    const set = new Set(rows.map((r) => r.building).filter(Boolean));
    return KNOWN_BUILDINGS.filter((b) => set.has(b));
  }, [rows]);

  const totalItems = units.reduce((s, u) => s + u.catItems.length, 0);
  const totalAmount = units.reduce((s, u) => s + (u.catTotal || 0), 0);

  return (
    <div className="wrap">
      <div className="masthead">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h1>{title}</h1>
          <a href="/api/auth/logout" className="btn" style={{ flexShrink: 0 }}>로그아웃</a>
        </div>
        <p>{subtitle}</p>
      </div>

      {rows === null && <div className="cleanup-empty">불러오는 중…</div>}

      {rows !== null && (
        <>
          <div className="info-card" style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>대상 호실</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700 }}>{units.length}건</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>총 작업 항목</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700 }}>{totalItems}개</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>합계 예상 비용</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>{fmtWon(totalAmount)}원</div>
            </div>
            {buildingsInData.length > 1 && (
              <div style={{ marginLeft: 'auto' }}>
                <select
                  value={building}
                  onChange={(e) => setBuilding(e.target.value)}
                  style={{ height: 36, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-alt)', color: 'var(--ink)', fontSize: 13, padding: '0 10px' }}
                >
                  <option value="">건물 전체</option>
                  {buildingsInData.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            )}
          </div>

          {units.length === 0 && <div className="cleanup-empty">{emptyText}</div>}

          {units.map((u) => (
            <div className="cleanup-item" key={u.id}>
              <div className="cleanup-item-head">
                <span className="cleanup-item-title">{u.building || '(건물명 없음)'} {u.unit}호</span>
                <span className="section-flag">{fmtWon(u.catTotal || 0)}원</span>
              </div>
              <div className="cleanup-item-age">
                {u.date ? formatDateKorean(u.date) : '-'} · 담당 {u.inspector || '-'}
              </div>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7 }}>
                {u.catItems.map((it, i) => (
                  <li key={i}>
                    {it.label}
                    {it.note ? ' — ' + it.note : ''}
                    {it.amount ? <span style={{ color: 'var(--ink-soft)' }}> ({fmtWon(it.amount)}원)</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
