'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '../../lib/supabaseClient';

// 2026-09-16 신설 — Notion팀이 설계한 work_orders 스키마 기반 "내 작업 배정" 화면.
// 점검/보수/청소 3개 트랙 중 로그인한 사람의 이메일이 담당자로 들어간 항목을 모아,
// status가 'assigned'(응답 대기)면 수락/거절, 'in_progress'(진행 중)면 완료 처리를
// 할 수 있게 한다. 관리자가 실제로 담당자를 배정하는 화면은 이 페이지 밖(Notion
// 쪽)이라, 여기는 "이미 나한테 배정된 것"에 응답만 한다.
const TRACKS = [
  { key: 'inspection', label: '점검', emailField: 'inspector_email', statusField: 'inspection_status', dueField: 'inspection_due_at', reasonField: 'inspection_reject_reason', completedField: 'inspection_completed_at' },
  { key: 'repair', label: '보수', emailField: 'repair_email', statusField: 'repair_status', dueField: 'repair_due_at', reasonField: 'repair_reject_reason', completedField: 'repair_completed_at' },
  { key: 'cleaning', label: '청소', emailField: 'cleaning_email', statusField: 'cleaning_status', dueField: 'cleaning_due_at', reasonField: 'cleaning_reject_reason', completedField: 'cleaning_completed_at' },
];
const TRACK_BADGE_BG = { inspection: 'var(--accent-bg)', repair: 'var(--warn-bg)', cleaning: 'var(--ok-bg)' };
const TRACK_BADGE_INK = { inspection: 'var(--accent-ink)', repair: 'var(--warn)', cleaning: 'var(--ok)' };

function fmtDue(iso) {
  if (!iso) return '마감기한 없음';
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AssignmentsPanel() {
  const supabase = useMemo(() => createClient(), []);
  const [me, setMe] = useState(null); // {email, name, role} | 'anon'
  const [orders, setOrders] = useState(null);
  const [units, setUnits] = useState({});
  const [rejecting, setRejecting] = useState(null); // { orderId, track }
  const [rejectReason, setRejectReason] = useState('');
  const [busyKey, setBusyKey] = useState(null);

  useEffect(() => {
    fetch('/api/session').then((r) => r.json()).then((s) => setMe(s.loggedIn ? s : 'anon'));
  }, []);

  useEffect(() => {
    if (!me || me === 'anon') return;
    supabase
      .from('work_orders')
      .select('id, unit_key, overall_status, inspector_email, inspection_status, inspection_due_at, inspection_reject_reason, repair_email, repair_status, repair_due_at, repair_reject_reason, cleaning_email, cleaning_status, cleaning_due_at, cleaning_reject_reason, created_at')
      .or(`inspector_email.eq.${me.email},repair_email.eq.${me.email},cleaning_email.eq.${me.email}`)
      .order('created_at', { ascending: false })
      .limit(200)
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
  }, [me, supabase]);

  // 각 work_order를 트랙별로 펼쳐서, "나"에게 해당하는 행만 뽑는다 — 한 건이
  // 여러 트랙(예: 점검+보수를 겸임)에 걸릴 수도 있어서 work_order당 최대 3행.
  const myRows = useMemo(() => {
    if (!orders || !me || me === 'anon') return [];
    const rows = [];
    orders.forEach((o) => {
      TRACKS.forEach((t) => {
        if (o[t.emailField] === me.email) {
          rows.push({
            orderId: o.id,
            unit: units[o.unit_key],
            track: t,
            status: o[t.statusField],
            due: o[t.dueField],
            reason: o[t.reasonField],
          });
        }
      });
    });
    return rows;
  }, [orders, me, units]);

  const pending = myRows.filter((r) => r.status === 'assigned');
  const active = myRows.filter((r) => r.status === 'in_progress');

  async function updateTrack(row, patch) {
    const key = row.orderId + ':' + row.track.key;
    setBusyKey(key);
    const { statusField, dueField: _d, reasonField, completedField } = row.track;
    const fields = {};
    if (patch.status) fields[statusField] = patch.status;
    if (patch.reason !== undefined) fields[reasonField] = patch.reason;
    if (patch.status === 'completed') fields[completedField] = new Date().toISOString();

    const { data: updated, error } = await supabase.from('work_orders').update(fields).eq('id', row.orderId).select().single();
    if (!error && updated && patch.status === 'completed') {
      // 2026-09-16: Notion팀이 확정한 규칙 — 청소 완료 AND (보수 완료 또는 보수
      // 해당없음)이면 전체 상태를 청구대기로 넘긴다(두 트랙이 fork-join으로
      // 합쳐지는 지점).
      const cleaningDone = updated.cleaning_status === 'completed';
      const repairDone = updated.repair_status === 'completed' || updated.repair_status === 'not_applicable';
      if (cleaningDone && repairDone && updated.overall_status !== 'billing_pending' && updated.overall_status !== 'completed') {
        await supabase.from('work_orders').update({ overall_status: 'billing_pending' }).eq('id', row.orderId);
      }
    }
    setOrders((os) => os.map((o) => (o.id === row.orderId ? { ...o, ...fields } : o)));
    setBusyKey(null);
  }

  function submitReject() {
    if (!rejectReason.trim()) return;
    const row = myRows.find((r) => r.orderId === rejecting.orderId && r.track.key === rejecting.track);
    updateTrack(row, { status: 'rejected', reason: rejectReason.trim() });
    setRejecting(null);
    setRejectReason('');
  }

  return (
    <div className="wrap">
      <div className="masthead">
        <h1>내 작업 배정</h1>
        <p>점검·보수·청소 중 나한테 배정된 작업만 모아 보여줍니다. 새 작업이 오면 아래에서 수락·거절하고, 진행 중인 작업은 끝나면 완료 처리하세요.</p>
      </div>

      {me === null && <div className="cleanup-empty">불러오는 중…</div>}
      {me === 'anon' && <div className="cleanup-empty">로그인이 필요합니다.</div>}

      {me && me !== 'anon' && orders === null && <div className="cleanup-empty">불러오는 중…</div>}

      {me && me !== 'anon' && orders !== null && (
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
          </div>

          {pending.length === 0 && active.length === 0 && (
            <div className="cleanup-empty">지금 응답 대기 중이거나 진행 중인 작업이 없어요.</div>
          )}

          {pending.map((row) => {
            const key = row.orderId + ':' + row.track.key;
            const isRejectingThis = rejecting && rejecting.orderId === row.orderId && rejecting.track === row.track.key;
            return (
              <div className="cleanup-item" key={key}>
                <div className="cleanup-item-head">
                  <span className="cleanup-item-title">
                    <span className="section-flag" style={{ background: TRACK_BADGE_BG[row.track.key], color: TRACK_BADGE_INK[row.track.key], marginRight: 6 }}>{row.track.label}</span>
                    {row.unit ? `${row.unit.building || '(건물명 없음)'} ${row.unit.unit}호` : '호실 정보 확인 중'}
                  </span>
                </div>
                <div className="cleanup-item-age">{fmtDue(row.due)}</div>
                {!isRejectingThis && (
                  <div className="cleanup-item-actions">
                    <button type="button" className="btn bad" onClick={() => { setRejecting({ orderId: row.orderId, track: row.track.key }); setRejectReason(''); }}>거절</button>
                    <button type="button" className="btn primary" disabled={busyKey === key} onClick={() => updateTrack(row, { status: 'in_progress' })}>
                      {busyKey === key ? '처리 중…' : '수락'}
                    </button>
                  </div>
                )}
                {isRejectingThis && (
                  <div className="note-box">
                    <textarea
                      placeholder="거절 사유를 입력해주세요 (필수)"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                    <div className="cleanup-item-actions">
                      <button type="button" className="btn" onClick={() => setRejecting(null)}>취소</button>
                      <button type="button" className="btn bad" disabled={!rejectReason.trim() || busyKey === key} onClick={submitReject}>거절 확정</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {active.map((row) => {
            const key = row.orderId + ':' + row.track.key;
            return (
              <div className="cleanup-item" key={key}>
                <div className="cleanup-item-head">
                  <span className="cleanup-item-title">
                    <span className="section-flag" style={{ background: TRACK_BADGE_BG[row.track.key], color: TRACK_BADGE_INK[row.track.key], marginRight: 6 }}>{row.track.label}</span>
                    {row.unit ? `${row.unit.building || '(건물명 없음)'} ${row.unit.unit}호` : '호실 정보 확인 중'}
                  </span>
                  <span className="section-flag" style={{ background: 'var(--ok-bg)', color: 'var(--ok)' }}>진행 중</span>
                </div>
                <div className="cleanup-item-age">{fmtDue(row.due)}</div>
                <div className="cleanup-item-actions">
                  <button type="button" className="btn primary" disabled={busyKey === key} onClick={() => updateTrack(row, { status: 'completed' })}>
                    {busyKey === key ? '처리 중…' : '완료 처리'}
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
