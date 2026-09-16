'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '../../lib/supabaseClient';
import TopNav from '../_shared/TopNav';
import { syncOrderToNotion } from '../../lib/notionSyncClient';

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
const ROLE_OPTIONS = [
  { key: 'admin', label: '관리자' },
  { key: 'inspector', label: '점검원' },
  { key: 'repair', label: '보수' },
  { key: 'cleaner', label: '청소' },
];

function toDateInputValue(iso) {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}

function hasRole(user, role) {
  return (user.roles && user.roles.length ? user.roles : [user.role]).includes(role);
}

// 2026-09-16 신설 — "관리자가 SQL 없이 화면에서 직접 역할을 배정/해제"(박길일님 요청).
// 체크박스 하나 토글할 때마다 그 사람의 roles 배열 전체를 다시 저장한다(개별
// role만 따로 켜고 끄는 API를 만들기보다, 매번 "이 사람의 최종 역할 집합은
// 이거다"를 통째로 보내는 게 더 단순하고 꼬일 일이 없다).
function UserManagement({ users, onChanged }) {
  const [busyEmail, setBusyEmail] = useState(null);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRoles, setNewRoles] = useState([]);
  const [status, setStatus] = useState('');

  async function saveUser(email, name, roles) {
    setBusyEmail(email);
    setStatus('');
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, roles }),
    });
    const data = await res.json().catch(() => ({}));
    setStatus(res.ok ? '' : data.error || '저장 실패');
    setBusyEmail(null);
    if (res.ok) onChanged();
    return res.ok;
  }

  async function toggleRole(user, role) {
    const current = user.roles && user.roles.length ? user.roles : [user.role];
    const next = current.includes(role) ? current.filter((r) => r !== role) : current.concat([role]);
    if (next.length === 0) { setStatus('최소 1개 역할은 있어야 해요.'); return; }
    await saveUser(user.email, user.name, next);
  }

  async function handleDelete(email) {
    if (!confirm(email + ' 팀원을 삭제할까요? 로그인 권한이 즉시 사라집니다.')) return;
    setBusyEmail(email);
    const res = await fetch('/api/admin/users?email=' + encodeURIComponent(email), { method: 'DELETE' });
    setBusyEmail(null);
    if (res.ok) onChanged();
  }

  function toggleNewRole(role) {
    setNewRoles((rs) => (rs.includes(role) ? rs.filter((r) => r !== role) : rs.concat([role])));
  }

  async function handleAdd() {
    if (!newEmail.trim() || newRoles.length === 0) { setStatus('이메일과 역할을 입력해주세요.'); return; }
    const ok = await saveUser(newEmail.trim(), newName.trim(), newRoles);
    if (ok) { setNewEmail(''); setNewName(''); setNewRoles([]); }
  }

  return (
    <div className="info-card">
      <div style={{ fontWeight: 700, marginBottom: 10 }}>팀원 관리</div>
      {users.map((u) => (
        <div key={u.email} style={{ padding: '8px 0', borderTop: '1px solid var(--line-soft)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 13.5 }}><b>{u.name || '(이름 없음)'}</b> · {u.email}</span>
            <button type="button" className="btn bad" style={{ padding: '4px 10px', fontSize: 12 }} disabled={busyEmail === u.email} onClick={() => handleDelete(u.email)}>삭제</button>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {ROLE_OPTIONS.map((r) => (
              <label key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5 }}>
                <input type="checkbox" checked={hasRole(u, r.key)} disabled={busyEmail === u.email} onChange={() => toggleRole(u, r.key)} />
                {r.label}
              </label>
            ))}
          </div>
        </div>
      ))}

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>새 팀원 추가</div>
        <div className="custom-add-row" style={{ padding: 0, marginBottom: 8 }}>
          <input type="text" placeholder="이메일" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          <input type="text" placeholder="이름" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ maxWidth: 140 }} />
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          {ROLE_OPTIONS.map((r) => (
            <label key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5 }}>
              <input type="checkbox" checked={newRoles.includes(r.key)} onChange={() => toggleNewRole(r.key)} />
              {r.label}
            </label>
          ))}
        </div>
        <button type="button" className="btn primary" disabled={busyEmail !== null} onClick={handleAdd}>추가</button>
        {status && <span style={{ marginLeft: 10, fontSize: 12.5, color: 'var(--bad)' }}>{status}</span>}
      </div>
    </div>
  );
}

function TrackAssignRow({ track, order, users, onAssign, busy }) {
  const status = order[track.statusField];
  const currentEmail = order[track.emailField] || '';
  const [email, setEmail] = useState(currentEmail);
  const [due, setDue] = useState(toDateInputValue(order[track.dueField]));
  const candidates = users.filter((u) => hasRole(u, track.role));
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
  // 2026-09-16: work_orders 조회가 실패하면(네트워크 오류 등) 화면에 바로 보여준다 —
  // "0건"과 "조회 자체가 실패함"을 구분 못 하면 디버깅이 어렵다는 걸 실제로 겪었다
  // (RLS 정책이 이상 동작해서 에러 없이 빈 배열만 왔던 사례, 정책 재생성으로 해결).
  const [fetchError, setFetchError] = useState(null);
  const [units, setUnits] = useState({});
  const [hideCompleted, setHideCompleted] = useState(true);
  const [busyKey, setBusyKey] = useState(null);

  function refreshUsers() {
    fetch('/api/admin/users').then((r) => r.json()).then((d) => setUsers(d.users || []));
  }

  useEffect(() => {
    fetch('/api/session').then((r) => r.json()).then((s) => setMe(s.loggedIn ? s : 'anon'));
    refreshUsers();
  }, []);

  useEffect(() => {
    supabase
      .from('work_orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300)
      .then(async ({ data, error }) => {
        if (error) console.error('work_orders 조회 실패:', error);
        const rows = error ? [] : (data || []);
        setOrders(rows);
        setFetchError(error ? error.message : null);
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
      syncOrderToNotion(order.id);
    }
    setBusyKey(null);
  }

  const visibleOrders = (orders || []).filter((o) => !hideCompleted || o.overall_status !== 'completed');

  return (
    <>
      <TopNav />
      <div className="wrap">
      <div className="masthead">
        <h1>관리자 클립보드</h1>
        <p>각 작업(점검·보수·청소)을 담당자에게 배정하고, 진행 상태·수락/거절 여부를 확인합니다.</p>
      </div>

      {me === null && <div className="cleanup-empty">불러오는 중…</div>}
      {me === 'anon' && <div className="cleanup-empty">로그인이 필요합니다.</div>}
      {me && me !== 'anon' && !hasRole(me, 'admin') && (
        <div className="cleanup-empty">관리자만 접근할 수 있는 화면이에요.</div>
      )}

      {me && me !== 'anon' && hasRole(me, 'admin') && orders === null && <div className="cleanup-empty">불러오는 중…</div>}

      {me && me !== 'anon' && hasRole(me, 'admin') && orders !== null && (
        <>
          <UserManagement users={users} onChanged={refreshUsers} />

          {fetchError && (
            <div className="info-card" style={{ borderColor: 'var(--bad)', color: 'var(--bad)', fontSize: 13 }}>
              작업 목록 조회 실패: {fetchError}
            </div>
          )}

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
    </>
  );
}
