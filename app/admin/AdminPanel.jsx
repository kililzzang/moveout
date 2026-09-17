'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '../../lib/supabaseClient';
import { fmtWon } from '../../lib/report';
import TopNav from '../_shared/TopNav';
import { syncOrderToNotion } from '../../lib/notionSyncClient';
import { suggestAssignees, DEFAULT_AUTO_ASSIGN_SETTINGS, CRITERIA_LABELS } from '../../lib/autoAssign';

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
// 2026-09-17 신설 — 자동 배정에서 "특정인 가중치" 기준이 쓰는 값(기본 1 = 보통,
// 높을수록 더 자주 추천됨). 타이핑할 때마다 저장하면 너무 잦으니 포커스를 벗어날
// 때(blur) 한 번만 저장한다.
function UserWeightInput({ user, onSave, disabled }) {
  const [value, setValue] = useState(String(user.assign_weight ?? 1));

  return (
    <input
      type="number"
      step="0.1"
      min="0"
      value={value}
      disabled={disabled}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const w = parseFloat(value);
        if (!Number.isNaN(w) && w !== (user.assign_weight ?? 1)) onSave(user, w);
      }}
      style={{ width: 56, height: 26, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--surface-alt)', color: 'var(--ink)', fontSize: 12, padding: '0 6px', textAlign: 'right' }}
    />
  );
}

function UserManagement({ users, onChanged }) {
  const [busyEmail, setBusyEmail] = useState(null);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRoles, setNewRoles] = useState([]);
  const [status, setStatus] = useState('');

  async function saveUser(email, name, roles, assignWeight) {
    setBusyEmail(email);
    setStatus('');
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, roles, assignWeight }),
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

  async function saveWeight(user, weight) {
    const roles = user.roles && user.roles.length ? user.roles : [user.role];
    await saveUser(user.email, user.name, roles, weight);
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
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {ROLE_OPTIONS.map((r) => (
              <label key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5 }}>
                <input type="checkbox" checked={hasRole(u, r.key)} disabled={busyEmail === u.email} onChange={() => toggleRole(u, r.key)} />
                {r.label}
              </label>
            ))}
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5, marginLeft: 'auto', color: 'var(--ink-soft)' }}>
              자동배정 가중치
              <UserWeightInput user={u} onSave={saveWeight} disabled={busyEmail === u.email} />
            </label>
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

// 2026-09-17 신설 — "담당자 자동 배정 기준" 설정 카드. 켠 기준들의 가중치를
// app_settings(key='auto_assign')에 저장해두면, 아래 각 작업의 "추천" 버튼이 이
// 설정을 그대로 쓴다.
function AutoAssignSettings({ settings, onSave, busy }) {
  const [criteria, setCriteria] = useState(settings.criteria);
  const [open, setOpen] = useState(false);

  useEffect(() => { setCriteria(settings.criteria); }, [settings]);

  function toggle(key) {
    setCriteria((c) => ({ ...c, [key]: { ...c[key], enabled: !c[key].enabled } }));
  }
  function setWeight(key, w) {
    setCriteria((c) => ({ ...c, [key]: { ...c[key], weight: w } }));
  }

  return (
    <div className="info-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 700 }}>담당자 자동 배정 기준</div>
        <button type="button" className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setOpen((v) => !v)}>{open ? '접기' : '설정 펼치기'}</button>
      </div>
      {open && (
        <>
          <div style={{ fontSize: 12, color: 'var(--ink-faint)', margin: '8px 0 12px' }}>
            켠 기준들의 가중치를 조합해 담당자를 점수로 줄세웁니다. 아래 각 작업의 "추천" 버튼을 누르면 이 설정대로 계산하지만, 실제 배정은 항상 관리자가 확인 후 "배정" 버튼을 눌러야 저장됩니다.
          </div>
          {Object.keys(CRITERIA_LABELS).map((key) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--line-soft)', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, width: 130, flexShrink: 0 }}>
                <input type="checkbox" checked={!!criteria[key]?.enabled} onChange={() => toggle(key)} />
                {CRITERIA_LABELS[key].label}
              </label>
              <input
                type="number" min="0" max="100"
                value={criteria[key]?.weight ?? 0}
                disabled={!criteria[key]?.enabled}
                onChange={(e) => setWeight(key, parseInt(e.target.value, 10) || 0)}
                style={{ width: 56, height: 28, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--surface-alt)', color: 'var(--ink)', fontSize: 12, padding: '0 6px', textAlign: 'right' }}
              />
              <span style={{ fontSize: 11.5, color: 'var(--ink-faint)', flex: 1, minWidth: 160 }}>{CRITERIA_LABELS[key].hint}</span>
            </div>
          ))}
          <div style={{ marginTop: 10 }}>
            <button type="button" className="btn primary" style={{ padding: '6px 14px', fontSize: 12.5 }} disabled={busy} onClick={() => onSave({ criteria })}>
              {busy ? '저장 중…' : '설정 저장'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function TrackAssignRow({ track, order, users, onAssign, busy, allOrders, buildingByUnitKey, autoAssignSettings }) {
  const status = order[track.statusField];
  const currentEmail = order[track.emailField] || '';
  const [email, setEmail] = useState(currentEmail);
  const [due, setDue] = useState(toDateInputValue(order[track.dueField]));
  const [suggestions, setSuggestions] = useState(null);
  const candidates = users.filter((u) => hasRole(u, track.role));
  const colors = STATUS_COLOR[status] || STATUS_COLOR.waiting;

  // 2026-09-17 신설 — "추천" 버튼: 설정된 기준으로 후보 점수를 매겨 1위를 담당자
  // 선택란에 채워준다. 여기서 바로 저장하지 않는다 — 관리자가 보고 "배정"을 눌러야
  // 확정된다(박길일님 요청: 추천만 하고 관리자가 확정).
  function handleSuggest() {
    if (!candidates.length) return;
    const ranked = suggestAssignees({
      candidates,
      track,
      allOrders,
      buildingByUnitKey,
      targetBuilding: buildingByUnitKey[order.unit_key],
      settings: autoAssignSettings,
    });
    setSuggestions(ranked.slice(0, 3));
    if (ranked[0]) setEmail(ranked[0].candidate.email);
  }

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
        <button type="button" className="btn" style={{ padding: '6px 12px', fontSize: 12.5 }} disabled={!candidates.length} onClick={handleSuggest}>추천</button>
        <button type="button" className="btn" style={{ padding: '6px 12px', fontSize: 12.5 }} disabled={!email || busy} onClick={() => onAssign(order, track, email, due)}>
          {busy ? '처리 중…' : (currentEmail ? '재배정' : '배정')}
        </button>
      </div>
      {suggestions && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink-faint)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {suggestions.map(({ candidate, score }, i) => (
            <span key={candidate.email}>{i + 1}위 {candidate.name || candidate.email} ({(score * 100).toFixed(0)}점)</span>
          ))}
        </div>
      )}
    </div>
  );
}

const PAYMENT_LABEL = { unbilled: '미청구', billed: '청구완료', paid: '입금완료' };

// 2026-09-16 신설 — 관리자 대시보드 금액 지표(박길일님 요청 ②). 이 화면에서 직접
// 청구금액·입금상태를 입력할 수 있게 해야 집계할 데이터가 생긴다(지금까지는
// invoice_amount/payment_status를 쓰는 곳이 이 화면 말고 없었다).
function BillingRow({ order, onSave, busy }) {
  const [amount, setAmount] = useState(order.invoice_amount ?? '');
  const [status, setStatus] = useState(order.payment_status || 'unbilled');

  return (
    <div style={{ padding: '8px 0', borderTop: '1px solid var(--line-soft)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ width: 40, fontSize: 12.5, fontWeight: 700 }}>청구</span>
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="청구금액"
        style={{ width: 110, height: 32, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-alt)', color: 'var(--ink)', fontSize: 12.5, padding: '0 8px' }}
      />
      <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ height: 32, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-alt)', color: 'var(--ink)', fontSize: 12.5, padding: '0 8px' }}>
        {Object.entries(PAYMENT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <button
        type="button"
        className="btn"
        style={{ padding: '6px 12px', fontSize: 12.5 }}
        disabled={busy}
        onClick={() => onSave(order, amount === '' ? null : parseInt(amount, 10), status)}
      >
        {busy ? '저장 중…' : '저장'}
      </button>
      {order.payment_status === 'paid' && order.paid_at && (
        <span style={{ fontSize: 11.5, color: 'var(--ok)' }}>{new Date(order.paid_at).toLocaleDateString('ko-KR')} 입금</span>
      )}
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
  const [autoAssignSettings, setAutoAssignSettings] = useState(DEFAULT_AUTO_ASSIGN_SETTINGS);
  const [settingsBusy, setSettingsBusy] = useState(false);

  function refreshUsers() {
    fetch('/api/admin/users').then((r) => r.json()).then((d) => setUsers(d.users || []));
  }

  useEffect(() => {
    fetch('/api/session').then((r) => r.json()).then((s) => setMe(s.loggedIn ? s : 'anon'));
    refreshUsers();
  }, []);

  // 2026-09-17: 자동 배정 기준 설정 — app_settings는 이 화면을 포함해 팀 전역
  // 설정용으로 새로 만든 범용 표라 다른 표들처럼 클라이언트에서 바로 읽고 쓴다.
  useEffect(() => {
    supabase.from('app_settings').select('value').eq('key', 'auto_assign').maybeSingle()
      .then(({ data }) => { if (data && data.value) setAutoAssignSettings(data.value); });
  }, [supabase]);

  async function handleSaveAutoAssignSettings(next) {
    setSettingsBusy(true);
    const { error } = await supabase.from('app_settings')
      .upsert({ key: 'auto_assign', value: next, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (!error) setAutoAssignSettings(next);
    setSettingsBusy(false);
  }

  const buildingByUnitKey = useMemo(() => {
    const map = {};
    Object.entries(units).forEach(([k, v]) => { map[k] = v.building; });
    return map;
  }, [units]);

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

  async function handleBilling(order, invoiceAmount, paymentStatus) {
    const key = order.id + ':billing';
    setBusyKey(key);
    const patch = { invoice_amount: invoiceAmount, payment_status: paymentStatus };
    if (paymentStatus === 'paid' && order.payment_status !== 'paid') patch.paid_at = new Date().toISOString();
    if (paymentStatus !== 'paid') patch.paid_at = null;
    const { error } = await supabase.from('work_orders').update(patch).eq('id', order.id);
    if (!error) {
      setOrders((os) => os.map((o) => (o.id === order.id ? { ...o, ...patch } : o)));
      syncOrderToNotion(order.id);
    }
    setBusyKey(null);
  }

  const visibleOrders = (orders || []).filter((o) => !hideCompleted || o.overall_status !== 'completed');

  // 2026-09-16: 총 청구액/미수금/이번달 매출 — 관리자 대시보드 금액 지표(박길일님
  // 요청 ②). work_orders.invoice_amount/payment_status/paid_at 기준으로 집계한다.
  const financials = useMemo(() => {
    const rows = orders || [];
    const totalBilled = rows.reduce((s, o) => s + (o.invoice_amount || 0), 0);
    const unpaid = rows.filter((o) => o.payment_status !== 'paid').reduce((s, o) => s + (o.invoice_amount || 0), 0);
    const now = new Date();
    const thisMonth = rows
      .filter((o) => o.payment_status === 'paid' && o.paid_at)
      .filter((o) => {
        const d = new Date(o.paid_at);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      })
      .reduce((s, o) => s + (o.invoice_amount || 0), 0);
    return { totalBilled, unpaid, thisMonth };
  }, [orders]);

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

          <AutoAssignSettings settings={autoAssignSettings} onSave={handleSaveAutoAssignSettings} busy={settingsBusy} />

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
            <div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>총 청구액</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700 }}>{fmtWon(financials.totalBilled)}원</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>미수금</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: financials.unpaid ? 'var(--warn)' : 'var(--ink)' }}>{fmtWon(financials.unpaid)}원</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>이번 달 매출</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: 'var(--ok)' }}>{fmtWon(financials.thisMonth)}원</div>
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
                <TrackAssignRow
                  key={t.key}
                  track={t}
                  order={order}
                  users={users}
                  onAssign={handleAssign}
                  busy={busyKey === order.id + ':' + t.key}
                  allOrders={orders || []}
                  buildingByUnitKey={buildingByUnitKey}
                  autoAssignSettings={autoAssignSettings}
                />
              ))}
              {order.overall_status !== 'received' && (
                <BillingRow order={order} onSave={handleBilling} busy={busyKey === order.id + ':billing'} />
              )}
            </div>
          ))}
        </>
      )}
      </div>
    </>
  );
}
