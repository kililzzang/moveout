'use client';
import { useEffect, useState } from 'react';

// 정리함 — moveout-checklist.html의 "정리함" 패널을 그대로 옮긴 것. "리포트 저장·복사"를
// 누를 때마다 쌓이는 inspections 기록을 목록으로 보여주고, 불러오기·삭제를 할 수 있다.
// 게시글 올린 지(=post_queue.status가 'posted'가 된 지) 1일 지난 것은 "정리 가능"으로
// 표시한다(실제 삭제는 서버 Cron이 자동으로 하지만, 여기서 수동으로도 지울 수 있다).
function daysAgo(iso) {
  if (!iso) return null;
  const d = (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
  return d;
}

export default function CleanupPanel({ supabase, onClose, onLoad }) {
  const [rows, setRows] = useState(null);
  const [postedIds, setPostedIds] = useState({});
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    supabase.from('inspections').select('id, building, unit, date, inspector, saved_at').order('saved_at', { ascending: false }).limit(50)
      .then(({ data, error }) => {
        if (error) { setRows([]); return; }
        setRows(data || []);
      });
    supabase.from('post_queue').select('id, status, posted_at').eq('status', 'posted')
      .then(({ data }) => {
        const map = {};
        (data || []).forEach((r) => { map[r.id] = r.posted_at; });
        setPostedIds(map);
      });
  }, [supabase]);

  async function handleDelete(id) {
    if (!confirm('이 점검 기록(공유 저장소)을 삭제할까요? 사진은 마이박스에서 따로 지워야 해요.')) return;
    setBusyId(id);
    await supabase.from('inspections').delete().eq('id', id);
    await supabase.from('post_queue').delete().eq('id', id);
    setRows((r) => r.filter((x) => x.id !== id));
    setBusyId(null);
  }

  async function handleLoad(id) {
    const { data, error } = await supabase.from('inspections').select('full_state').eq('id', id).single();
    if (error || !data || !data.full_state) { alert('불러오기에 실패했어요.'); return; }
    onLoad(data.full_state);
    onClose();
  }

  return (
    <div className="overlay">
      <div className="cleanup-box">
        <h3 style={{ marginTop: 0 }}>정리함</h3>
        <p className="cleanup-hint">
          "리포트 저장·복사"를 누를 때마다 저장된 점검 기록이 여기 모여요. 게시글 올린 지
          1일 지난 기록은 서버가 매일 밤 자동으로 정리하지만, 사진은 마이박스 폴더에서
          <b> 직접</b> 지워주세요.
        </p>
        {rows === null && <div className="cleanup-empty">불러오는 중…</div>}
        {rows && rows.length === 0 && <div className="cleanup-empty">저장된 점검 기록이 없어요.</div>}
        {rows && rows.map((r) => {
          const postedAt = postedIds[r.id];
          const stale = postedAt && daysAgo(postedAt) >= 1;
          return (
            <div className="cleanup-item" key={r.id}>
              <div className="cleanup-item-head">
                <span className="cleanup-item-title">{r.building || '(건물명 없음)'} {r.unit}호</span>
                {stale && <span className="section-flag">정리 가능</span>}
              </div>
              <div className="cleanup-item-age">{r.date || '-'} · {r.inspector || '담당자 미기재'}</div>
              <div className="cleanup-item-actions">
                <button type="button" className="btn" onClick={() => handleLoad(r.id)}>불러오기</button>
                <button type="button" className="btn bad" disabled={busyId === r.id} onClick={() => handleDelete(r.id)}>
                  {busyId === r.id ? '삭제 중…' : '이 기록 삭제'}
                </button>
              </div>
            </div>
          );
        })}
        <div className="cleanup-close-row">
          <button type="button" className="btn" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
