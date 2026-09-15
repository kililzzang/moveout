'use client';
import { useState } from 'react';

export default function StatsPasswordForm() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/stats-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '실패했어요.');
        return;
      }
      // 쿠키가 방금 설정됐으니 새로고침하면 서버 컴포넌트가 인증된 걸로 다시 렌더한다.
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="info-card">
      <div className="field">
        <label>비밀번호</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
      </div>
      {error && <p style={{ color: 'var(--bad)', fontSize: 13, marginTop: 8 }}>{error}</p>}
      <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 12, width: '100%' }}>
        {busy ? '확인 중…' : '입장'}
      </button>
    </form>
  );
}
