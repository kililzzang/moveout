// 로그인 화면. 서버 컴포넌트로 충분해서(버튼 하나는 그냥 링크) 'use client' 안 씀.
// 에러 사유는 콜백 라우트가 쿼리스트링(?error=...)으로 넘겨준다.
const ERROR_MESSAGES = {
  invalid_state: '로그인 요청이 만료됐거나 올바르지 않아요. 다시 시도해주세요.',
  token_exchange_failed: '네이버웍스 인증에 실패했어요. 잠시 후 다시 시도해주세요.',
  id_token_invalid: '로그인 정보를 확인하지 못했어요. 다시 시도해주세요.',
  no_email: '네이버웍스 계정에서 이메일 정보를 받지 못했어요. 관리자에게 문의해주세요.',
  lookup_failed: '권한 확인 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.',
  not_allowed: '이 계정은 아직 사용 권한이 등록되지 않았어요. 관리자(팀장님)에게 등록을 요청해주세요.',
};

export default function LoginPage({ searchParams }) {
  const error = searchParams?.error;
  const email = searchParams?.email;
  const message = error ? ERROR_MESSAGES[error] || '로그인 중 문제가 생겼어요. 다시 시도해주세요.' : null;

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          padding: '32px 28px',
          maxWidth: 360,
          width: '100%',
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>퇴실점검 클립보드</h1>
        <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', margin: '0 0 24px', lineHeight: 1.6 }}>
          네이버웍스 계정으로 로그인해주세요.
        </p>

        {message && (
          <div
            style={{
              background: '#FAE6E1',
              color: '#B23A26',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 12.5,
              lineHeight: 1.6,
              marginBottom: 18,
              textAlign: 'left',
            }}
          >
            {message}
            {error === 'not_allowed' && email && (
              <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 11.5 }}>({email})</div>
            )}
          </div>
        )}

        <a
          href="/api/auth/naverworks"
          style={{
            display: 'block',
            background: 'var(--accent)',
            color: '#fff',
            borderRadius: 8,
            padding: '12px 16px',
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          네이버웍스로 로그인
        </a>
      </div>
    </div>
  );
}
