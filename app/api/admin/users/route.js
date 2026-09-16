import { NextResponse } from 'next/server';
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from '../../../../lib/session';
import { createServiceClient } from '../../../../lib/supabaseServer';

const VALID_ROLES = ['admin', 'inspector', 'repair', 'cleaner'];

async function getSession(request) {
  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionCookieValue(cookieValue);
}

function isAdmin(session) {
  if (!session) return false;
  const roles = session.roles && session.roles.length ? session.roles : [session.role];
  return roles.includes('admin');
}

// 2026-09-16 신설 — 관리자 클립보드(/admin)가 "이 작업을 누구한테 배정할지" 고를 때
// 쓰는 목록. allowed_users는 RLS가 "service role only"라 브라우저(anon 키)에서
// 직접 못 읽는다(로그인 콜백에서만 읽는 설계) — 그래서 이 서버 라우트가 service
// role로 대신 조회/수정해준다. GET은 로그인만 확인하면 되고(email/name/role은
// 민감정보가 아님), 쓰기(POST/DELETE)는 호출한 사람이 실제로 관리자 역할일 때만
// 허용한다 — 안 그러면 아무나 로그인만 해도 자기 계정에 admin 역할을 넣을 수
// 있게 되는 구멍이 생긴다.
export async function GET(request) {
  const session = await getSession(request);
  if (!session) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.from('allowed_users').select('email, name, role, roles, is_dev').order('name');
  if (error) {
    return NextResponse.json({ error: `조회 실패: ${error.message}` }, { status: 500 });
  }
  const users = (data || []).map((u) => ({ ...u, roles: u.roles && u.roles.length ? u.roles : [u.role] }));
  return NextResponse.json({ users });
}

// 2026-09-16: "관리자가 화면에서 직접 팀원 역할을 배정/해제"(박길일님 요청, SQL
// 없이). email이 이미 있으면 이름·role·roles를 갱신, 없으면 새로 만든다. role
// (단일값)은 그 사람의 "기본 역할"(로그인 직후 어디로 보낼지 등)로 남기고,
// roles(배열)는 실제 배정 가능 여부를 판단하는 전체 역할 집합이다.
export async function POST(request) {
  const session = await getSession(request);
  if (!isAdmin(session)) {
    return NextResponse.json({ error: '관리자만 팀원을 등록/수정할 수 있습니다.' }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const email = (body.email || '').trim();
  const name = (body.name || '').trim();
  const roles = Array.isArray(body.roles) ? body.roles.filter((r) => VALID_ROLES.includes(r)) : [];
  if (!email || roles.length === 0) {
    return NextResponse.json({ error: '이메일과 역할을 최소 1개 이상 입력해주세요.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('allowed_users')
    .upsert({ email, name, role: roles[0], roles }, { onConflict: 'email' });
  if (error) {
    return NextResponse.json({ error: `저장 실패: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request) {
  const session = await getSession(request);
  if (!isAdmin(session)) {
    return NextResponse.json({ error: '관리자만 팀원을 삭제할 수 있습니다.' }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  if (!email) {
    return NextResponse.json({ error: 'email이 필요합니다.' }, { status: 400 });
  }
  const supabase = createServiceClient();
  const { error } = await supabase.from('allowed_users').delete().eq('email', email);
  if (error) {
    return NextResponse.json({ error: `삭제 실패: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
