'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// 2026-09-16 신설 — 박길일님 요청("화면 간 이동할 방법이 없다") 대응. 지금까지는
// 체크리스트 맨 아래 버튼으로만 다른 화면에 갈 수 있었고, 그마저도 개발자 계정만
// 보였다. 모든 "클립보드 가족" 화면 위에 공통으로 얹는 얇은 메뉴바 — 역할/is_dev에
// 따라 갈 수 있는 곳만 보여주고, 로그아웃도 여기 하나로 모은다(각 화면 마스트헤드에
// 따로 넣었던 로그아웃 버튼은 제거).
const PAGES = [
  { href: '/', label: '체크리스트', always: true },
  { href: '/repair-clipboard', label: '하자보수', dev: true },
  { href: '/cleaning-clipboard', label: '청소완료', dev: true },
  { href: '/assignments', label: '내 작업', dev: true },
  { href: '/dashboard', label: '대시보드', dev: true },
  { href: '/admin', label: '관리자', dev: true, admin: true },
];

function hasRole(session, role) {
  if (!session || session === 'anon') return false;
  const roles = session.roles && session.roles.length ? session.roles : [session.role];
  return roles.includes(role);
}

export default function TopNav() {
  const pathname = usePathname();
  const [me, setMe] = useState(null);

  useEffect(() => {
    fetch('/api/session').then((r) => r.json()).then((s) => setMe(s.loggedIn ? s : 'anon')).catch(() => setMe('anon'));
  }, []);

  if (me === null || me === 'anon') return null; // 로그인 전엔 아무것도 안 보여준다(어차피 proxy.js가 막음)

  const isDev = !!me.is_dev;
  const isAdmin = hasRole(me, 'admin');
  const visiblePages = PAGES.filter((p) => p.always || (isDev && (!p.admin || isAdmin)));

  return (
    <div className="topnav">
      <div className="topnav-links">
        {visiblePages.map((p) => (
          <Link key={p.href} href={p.href} className={'topnav-link' + (pathname === p.href ? ' active' : '')}>
            {p.label}
          </Link>
        ))}
      </div>
      <div className="topnav-right">
        <span className="topnav-user">{me.name || me.email}</span>
        <a href="/api/auth/logout" className="topnav-logout">로그아웃</a>
      </div>
    </div>
  );
}
