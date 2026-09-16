'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '../../lib/supabaseClient';

// 2026-09-16 신설 — "관리자 클립보드"(박길일님 설계 5번, 가장 큰 작업): 각 work_order의
// 점검/보수/청소 트랙을 담당자에게 배정하고, 진행 상태·수락/거절 여부를 한눈에 본다.
// 노션 접수폼 → work_order 자동 생성 동기화는 Notion팀이 별도로 준비 중이라, 지금은
// 이 앱에서 점검을 저장할 때 만들어지는 work_order(보수/청소 트랙)부터 배정할 수 있다
// — 그 동기화가 붙으면 점검 배정도 여기서 똑같이 하면 된다.
const TRACKS = [
  { key: 'inspection', label: '점검', role: 'inspector', emailField: 'inspector_email', statusField: 'inspection_status', dueField: 'inspection_due_at', reasonField: 'inspection_reject_reason' },
  { key: 'repair', label: '보수', role: 'repair', emailField: 'repair_email', statusField: 'repair_status', dueField: 'repair_due_at', reasonField: 'repair_reject_reason' },
  { key: 'cleaning', label: '청소', role: 'cleaner', emailField: 'cleaning_email', statusField: 'cleaning_status', dueField: 'cleaning_due_at', reasonField: 'cleaning_reject_reason' },
];
const STATUS_LABEL = { assigned: '배정됨', rejected: '거절', waiting: '대기', in_progress: '진행중', completed: '완료', not_applicable: '해당없음' };
const STATUS_COLOR = {
  assigned: { bg: 'var(--accent-bg)', ink: 'var(--accent-ink)' },
  rejected: { bg: 'var(--bad-bg)', ink: 'var(--bad)' },
  waiting: { bg: 'var(--neutral-chip)', ink: 'var(--neutral-chip-ink)' },
  in_progress: { bg: 'var(--warn-bg)', ink: 'var(--warn)' },
  completed: { bg: 'var(--ok-bg)', ink: 'var(--ok)' },
  not_applicable: { bg: 'var(--neutral-chip)', ink: 'var(--ink-faint)' },
};
const OVERALL_LABEL = { received: '접수', inspecting: '점검중', inspected: '점검완료', processing: '진행중', billing_pending: '청구대기', completed: '완료' };

function toDateInputValue(iso) {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}

function TrackAssignRow({ track, order, users, onAssign, busy }) {
  const status = order[track.statusField];
  const currentEmail = order[track.emailField] || '';
  const [email, setEmail] = useState(currentEmail);
  const [due, setDue] = useState(toDateInputValue(order[track.dueField]));
  const candidates = users.filter((u) => u.role === track.role);
  const colors = STATUS_COLOR[status] || STATUS_COLOR.waiting;

  if (status === 'not_applicable') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
        <span style={{ width: 40, fontSize: 12.5, color: 'var(--ink-soft)' }}>{track.label}</span>
        <span className="section-flag" style={{ background: colors.bg, color: colors.ink }}>해당없음</span>
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 0', borderTop: '1px solid var(--line-soft)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ width: 40, fontSize: 12.5, fontWeight: 700 }}>{track.label}</span>
        <span className="section-flag" style={{ background: colors.bg, color: colors.ink }}>{STATUS_LABEL[status] || status}</span>
        {currentEmail && <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>현재: {users.find((u) => u.email === currentEmail)?.name || currentEmail}</span>}
      </div>
      {status === 'rejected' && order[track.reasonField] && (
        <div style={{ fontSize: 12, color: 'var(--bad)', marginBottom: 6 }}>거절 사유: {order[track.reasonField]}</div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={email} onChange={(e) => setEmail(e.target.value)} style={{ height: 32, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-alt)', color: 'var(--ink)', fontSize: 12.5, padding: '0 8px' }}>
          <option value="">담당자 선택</option>
          {candidates.map((u) => <option key={u.email} value={u.email}>{u.name || u.email}</option>)}
        </select>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ height: 32, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-alt)', color: 'var(--ink)', fontSize: 12.5, padding: '0 8px' }} />
        <button type="button" className="btn" style={{ padding: '6px 12px', fontSize: 12.5 }} disabled={!email || busy} onClick={() => onAssign(order, track, email, due)}>
          {busy ? '처리 중…' : (currentEmail ? '재배정' : '배정')}
        </button>
      </div>
    </div>
  );
}

export default function AdminPanel() {
  const supabase = useMemo(() => createClient(), []);
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [orders, setOrders] = useState(null);
  const [units, setUnits] = useState({});
  const [hideCompleted, setHideCompleted] = useState(true);
  const [busyKey, setBusyKey] = useState(null);

  useEffect(() => {
    fetch('/api/session').then((r) => r.json()).then((s) => setMe(s.loggedIn ? s : 'anon'));
    fetch('/api/admin/users').then((r) => r.json()).then((d) => setUsers(d.users || []));
  }, []);

  useEffect(() => {
    supabase
      .from('work_orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300)
      .then(async ({ data, error }) => {
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
  }, [supabase]);

  async function handleAssign(order, track, email, due) {
    const key = order.id + ':' + track.key;
    setBusyKey(key);
    const patch = { [track.emailField]: email, [track.statusField]: 'assigned' };
    if (due) patch[track.dueField] = new Date(due + 'T00:00:00').toISOString();
    const { error } = await supabase.from('work_orders').update(patch).eq('id', order.id);
    if (!error) {
      setOrders((os) => os.map((o) => (o.id === order.id ? { ...o, ...patch } : o)));
    }
    setBusyKey(null);
  }

  const visibleOrders = (orders || []).filter((o) => !hideCompleted || o.overall_status !== 'completed');

  return (
    <div className="wrap">
      <div className="masthead">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h1>관리자 클립보드</h1>
          <a href="/api/auth/logout" className="btn" style={{ flexShrink: 0 }}>로그아웃</a>
        </div>
        <p>각 작업(점검·보수·청소)을 담당자에게 배정하고, 진행 상태·수락/거절 여부를 확인합니다.</p>
      </div>

      {me === null && <div className="cleanup-empty">불러오는 중…</div>}
      {me === 'anon' && <div className="cleanup-empty">로그인이 필요합니다.</div>}
      {me && me !== 'anon' && me.role !== 'admin' && (
        <div className="cleanup-empty">관리자만 접근할 수 있는 화면이에요.</div>
      )}

      {me && me !== 'anon' && me.role === 'admin' && orders === null && <div className="cleanup-empty">불러오는 중…</div>}

      {me && me !== 'anon' && me.role === 'admin' && orders !== null && (
        <>
          <div className="info-card" style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>전체 건수</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700 }}>{orders.length}건</div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginLeft: 'auto' }}>
              <input type="checkbox" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)} />
              완료된 건 숨기기
            </label>
          </div>

          {visibleOrders.length === 0 && <div className="cleanup-empty">표시할 작업이 없어요.</div>}

          {visibleOrders.map((order) => (
            <div className="cleanup-item" key={order.id}>
              <div className="cleanup-item-head">
                <span className="cleanup-item-title">
                  {units[order.unit_key] ? `${units[order.unit_key].building || '(건물명 없음)'} ${units[order.unit_key].unit}호` : '호실 확인 중'}
                </span>
                <span className="section-flag">{OVERALL_LABEL[order.overall_status] || order.overall_status}</span>
              </div>
              <div className="cleanup-item-age">{new Date(order.created_at).toLocaleDateString('ko-KR')} 생성</div>
              {TRACKS.map((t) => (
                <TrackAssignRow key={t.key} track={t} order={order} users={users} onAssign={handleAssign} busy={busyKey === order.id + ':' + t.key} />
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
