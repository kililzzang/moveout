'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '../../lib/supabaseClient';

// 2026-09-16 신설 — "담당별 대시보드"(박길일님 설계 1번): 역할에 따라 보이는 내용이
// 다르다. 점검원/보수작업자/청소작업자는 자기 트랙 기준 진행현황·납기·이달/누적
// 실적만, 관리자는 전체 현황(트랙별 상태 집계)과 모든 도구로 가는 링크를 본다.
// 실제 액션(수락/거절/체크)은 여기서 안 하고 각 도구(/assignments, /repair-clipboard
// 등)로 링크만 — 대시보드는 "한눈에 보기" 역할에 집중한다.
const TRACKS = [
  { key: 'inspection', label: '점검', emailField: 'inspector_email', statusField: 'inspection_status', dueField: 'inspection_due_at', completedField: 'inspection_completed_at' },
  { key: 'repair', label: '보수', emailField: 'repair_email', statusField: 'repair_status', dueField: 'repair_due_at', completedField: 'repair_completed_at' },
  { key: 'cleaning', label: '청소', emailField: 'cleaning_email', statusField: 'cleaning_status', dueField: 'cleaning_due_at', completedField: 'cleaning_completed_at' },
];
const TOOL_LINKS = [
  { href: '/', label: '호실점검 클립보드' },
  { href: '/repair-clipboard', label: '하자보수 클립보드' },
  { href: '/cleaning-clipboard', label: '청소완료 클립보드' },
  { href: '/assignments', label: '내 작업 배정' },
];
const STATUS_LABEL = { received: '접수', inspecting: '점검중', inspected: '점검완료', processing: '진행중', billing_pending: '청구대기', completed: '완료',
  assigned: '배정됨', rejected: '거절', waiting: '대기', in_progress: '진행중', not_applicable: '해당없음' };

function fmtDue(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}
function isThisMonth(iso) {
  if (!iso) return false;
  const d = new Date(iso), now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

export default function DashboardPanel() {
  const supabase = useMemo(() => createClient(), []);
  const [me, setMe] = useState(null);
  const [orders, setOrders] = useState(null);
  const [units, setUnits] = useState({});

  useEffect(() => {
    fetch('/api/session').then((r) => r.json()).then((s) => setMe(s.loggedIn ? s : 'anon'));
  }, []);

  useEffect(() => {
    if (!me || me === 'anon') return;
    const isAdmin = me.role === 'admin';
    const cols = 'id, unit_key, overall_status, inspector_email, inspection_status, inspection_due_at, inspection_completed_at, repair_email, repair_status, repair_due_at, repair_completed_at, cleaning_email, cleaning_status, cleaning_due_at, cleaning_completed_at, created_at';
    const query = isAdmin
      ? supabase.from('work_orders').select(cols).order('created_at', { ascending: false }).limit(500)
      : supabase.from('work_orders').select(cols)
          .or(`inspector_email.eq.${me.email},repair_email.eq.${me.email},cleaning_email.eq.${me.email}`)
          .order('created_at', { ascending: false }).limit(300);
    query.then(async ({ data, error }) => {
      const rows = error ? [] : (data || []);
      setOrders(rows);
      const unitKeys = [...new Set(rows.map((r) => r.unit_key).filter(Boolean))];
      if (unitKeys.length) {
        const { data: insp } = await supabase.from('inspections').select('id, building, unit').in('id', unitKeys);
        const map = {};
        (insp || []).forEach((r) => { map[r.id] = r; });
        setUnits(map);
      }
    });
  }, [me, supabase]);

  const isAdmin = me && me !== 'anon' && me.role === 'admin';

  // 내 트랙 행만 펼치기(관리자가 아닐 때) — /assignments와 같은 방식.
  const myRows = useMemo(() => {
    if (!orders || !me || me === 'anon' || isAdmin) return [];
    const rows = [];
    orders.forEach((o) => {
      TRACKS.forEach((t) => {
        if (o[t.emailField] === me.email) {
          rows.push({ orderId: o.id, unit: units[o.unit_key], track: t, status: o[t.statusField], due: o[t.dueField], completedAt: o[t.completedField] });
        }
      });
    });
    return rows;
  }, [orders, me, units, isAdmin]);

  const pending = myRows.filter((r) => r.status === 'assigned');
  const active = myRows.filter((r) => r.status === 'in_progress');
  const completedThisMonth = myRows.filter((r) => r.status === 'completed' && isThisMonth(r.completedAt));
  const completedTotal = myRows.filter((r) => r.status === 'completed');

  // 관리자용 트랙별 상태 집계.
  const adminStats = useMemo(() => {
    if (!orders || !isAdmin) return null;
    const stats = {};
    TRACKS.forEach((t) => { stats[t.key] = {}; });
    orders.forEach((o) => {
      TRACKS.forEach((t) => {
        const s = o[t.statusField];
        if (!s) return;
        stats[t.key][s] = (stats[t.key][s] || 0) + 1;
      });
    });
    return stats;
  }, [orders, isAdmin]);

  return (
    <div className="wrap">
      <div className="masthead">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h1>담당별 대시보드</h1>
          <a href="/api/auth/logout" className="btn" style={{ flexShrink: 0 }}>로그아웃</a>
        </div>
        <p>{me && me !== 'anon' ? `${me.name || me.email}님 (${me.role})` : '불러오는 중…'}</p>
      </div>

      {me === null && <div className="cleanup-empty">불러오는 중…</div>}
      {me === 'anon' && <div className="cleanup-empty">로그인이 필요합니다.</div>}

      {me && me !== 'anon' && orders === null && <div className="cleanup-empty">불러오는 중…</div>}

      {me && me !== 'anon' && orders !== null && !isAdmin && (
        <>
          <div className="info-card" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>응답 대기</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: 'var(--warn)' }}>{pending.length}건</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>진행 중</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700 }}>{active.length}건</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>이번 달 완료</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: 'var(--ok)' }}>{completedThisMonth.length}건</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>누적 완료</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700 }}>{completedTotal.length}건</div>
            </div>
          </div>

          {[...pending, ...active].length === 0 && <div className="cleanup-empty">지금 응답 대기 중이거나 진행 중인 작업이 없어요.</div>}

          {[...pending, ...active].sort((a, b) => (a.due || '9999') > (b.due || '9999') ? 1 : -1).map((row) => (
            <div className="cleanup-item" key={row.orderId + ':' + row.track.key}>
              <div className="cleanup-item-head">
                <span className="cleanup-item-title">
                  <span className="section-flag" style={{ marginRight: 6 }}>{row.track.label}</span>
                  {row.unit ? `${row.unit.building || '(건물명 없음)'} ${row.unit.unit}호` : '호실 확인 중'}
                </span>
                <span className="section-flag" style={{ background: row.status === 'assigned' ? 'var(--warn-bg)' : 'var(--ok-bg)', color: row.status === 'assigned' ? 'var(--warn)' : 'var(--ok)' }}>
                  {STATUS_LABEL[row.status] || row.status}
                </span>
              </div>
              <div className="cleanup-item-age">{fmtDue(row.due) ? '마감 ' + fmtDue(row.due) : '마감기한 없음'}</div>
            </div>
          ))}

          <div className="footer-actions" style={{ marginTop: 16, position: 'static' }}>
            <Link href="/assignments" className="btn primary">내 작업 배정에서 처리하기</Link>
          </div>
        </>
      )}

      {me && me !== 'anon' && orders !== null && isAdmin && adminStats && (
        <>
          <div className="info-card">
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 10 }}>전체 현황 (최근 {orders.length}건 기준)</div>
            {TRACKS.map((t) => (
              <div key={t.key} style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{t.label}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {Object.entries(adminStats[t.key]).map(([status, count]) => (
                    <span key={status} className="section-flag">{STATUS_LABEL[status] || status} {count}</span>
                  ))}
                  {Object.keys(adminStats[t.key]).length === 0 && <span style={{ fontSize: 12.5, color: 'var(--ink-faint)' }}>데이터 없음</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="info-card">
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 10 }}>모든 도구 바로가기</div>
            <div className="footer-actions" style={{ position: 'static' }}>
              {TOOL_LINKS.map((l) => <Link key={l.href} href={l.href} className="btn">{l.label}</Link>)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
