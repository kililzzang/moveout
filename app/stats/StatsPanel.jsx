'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '../../lib/supabaseClient';

// 이 페이지가 재는 건 딱 하나 -- "게시글 준비된 점검을 실제로 네이버웍스에 올리는 데
// 걸린 시간"(posting_started_at ~ posted_at). 청구 금액이나 체크리스트 입력 시간은
// 일부러 안 잰다 -- 그건 이 도구가 직접 만든 효과가 아니거나(입금은 세입자 사정),
// 이미 박길일님이 따로 관리하기로 한 영역이라서다. 자동화가 실제로 절약한 시간만
// 정직하게 보여주는 게 목적.
//
// "예전(수동) 방식" 기준을 하나의 뭉뚱그린 숫자 대신 박길일님이 실제로 짚어준 3단계로
// 쪼갠다(점검 자체 시간은 앱을 써도 동일하다는 전제라 아예 비교 대상에서 뺐다):
//   1) 이동시간 -- 컴퓨터/모바일로 작업 가능한 곳까지 이동. 지금 앱은 현장 모바일에서
//      바로 되니 이 시간은 새 방식에서 전부 사라진다고 본다(실측 대상이 아님).
//   2) 업로드·게시글 작성시간 -- 예전엔 사람이 직접 했고, 지금은 자동화 실측값
//      (posting_started_at~posted_at)과 직접 비교되는 부분.
//   3) 검토시간 -- 게시 전 확인. 새 방식에서도 여전히 필요하지만, 정돈된 체크리스트
//      덕에 줄어든다고 보고 기준치 전체를 절약분에 포함한다.
const BASELINE_KEY = 'moveout_stats_baseline_v2';
const DEFAULT_BASELINE = { travel: 10, upload: 10, review: 5 };

function loadBaseline() {
  try {
    const v = JSON.parse(localStorage.getItem(BASELINE_KEY));
    if (v && Number.isFinite(v.travel) && Number.isFinite(v.upload) && Number.isFinite(v.review)) return v;
  } catch {}
  return DEFAULT_BASELINE;
}

function fmtMin(min) {
  if (min < 60) return Math.round(min) + '분';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h + '시간' + (m ? ' ' + m + '분' : '');
}

export default function StatsPanel() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState(null);
  const [baseline, setBaseline] = useState(DEFAULT_BASELINE);

  useEffect(() => { setBaseline(loadBaseline()); }, []);

  useEffect(() => {
    supabase
      .from('post_queue')
      .select('id, building, unit, date, posting_started_at, posted_at')
      .not('posting_started_at', 'is', null)
      .not('posted_at', 'is', null)
      .order('posted_at', { ascending: false })
      .limit(200)
      .then(({ data, error }) => setRows(error ? [] : (data || [])));
  }, [supabase]);

  function changeBaseline(key, v) {
    const n = parseInt(v, 10);
    setBaseline((b) => {
      const next = { ...b, [key]: Number.isFinite(n) && n >= 0 ? n : 0 };
      try { localStorage.setItem(BASELINE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  const baselineTotal = baseline.travel + baseline.upload + baseline.review;

  const withDuration = (rows || []).map((r) => ({
    ...r,
    minutes: (new Date(r.posted_at) - new Date(r.posting_started_at)) / 60000,
  })).filter((r) => r.minutes >= 0);

  const count = withDuration.length;
  const avgMin = count ? withDuration.reduce((s, r) => s + r.minutes, 0) / count : 0;
  // 절약분 = (이동시간 전부 + 업로드작성 기준 - 실측 업로드시간 + 검토 기준), 0 밑으로는 안 내려감.
  const savedMin = withDuration.reduce((s, r) => {
    const perPost = baseline.travel + baseline.review + Math.max(0, baseline.upload - r.minutes);
    return s + perPost;
  }, 0);

  return (
    <div className="wrap">
      <div className="masthead">
        <h1>성과 대시보드</h1>
        <p>게시글 준비 완료 → 네이버웍스 게시 완료까지, 자동화가 실제로 걸린 시간만 기록합니다.</p>
      </div>

      <div className="info-card">
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 10 }}>
          예전(수동) 방식 건당 기준 — 점검 자체 시간은 동일하다고 보고 뺐습니다.
        </div>
        <div className="info-grid">
          <div className="field">
            <label>이동시간(분) — 컴퓨터/모바일 가능한 곳까지</label>
            <input type="number" value={baseline.travel} onChange={(e) => changeBaseline('travel', e.target.value)} />
          </div>
          <div className="field">
            <label>업로드·게시작성(분) — 숙달자 기준</label>
            <input type="number" value={baseline.upload} onChange={(e) => changeBaseline('upload', e.target.value)} />
          </div>
          <div className="field">
            <label>검토시간(분)</label>
            <input type="number" value={baseline.review} onChange={(e) => changeBaseline('review', e.target.value)} />
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 10 }}>
          건당 기준 합계: <b style={{ fontFamily: 'var(--font-mono)' }}>{fmtMin(baselineTotal)}</b>
        </div>
      </div>

      {rows === null && <div className="cleanup-empty">불러오는 중…</div>}

      {rows !== null && (
        <>
          <div className="info-card" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>기록된 게시 건수</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700 }}>{count}건</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>건당 평균 소요</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700 }}>{count ? fmtMin(avgMin) : '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>총 절약 시간</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: 'var(--ok)' }}>{fmtMin(savedMin)}</div>
            </div>
          </div>

          {count === 0 && (
            <div className="cleanup-empty">
              아직 기록이 없어요 — 이제부터 올리는 게시글부터 자동으로 쌓입니다.
            </div>
          )}

          {withDuration.map((r) => (
            <div className="cleanup-item" key={r.id}>
              <div className="cleanup-item-head">
                <span className="cleanup-item-title">{r.building || '(건물명 없음)'} {r.unit}호</span>
                <span className="section-flag" style={{ background: 'var(--ok-bg)', color: 'var(--ok)' }}>
                  {fmtMin(r.minutes)}
                </span>
              </div>
              <div className="cleanup-item-age">{r.date || '-'} · 게시 완료 {new Date(r.posted_at).toLocaleString('ko-KR')}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
