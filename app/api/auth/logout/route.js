import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '../../../../lib/session';

export async function GET(request) {
  const res = NextResponse.redirect(new URL('/login', request.url));
  res.cookies.set(SESSION_COOKIE_NAME, '', { maxAge: 0, path: '/' });
  return res;
}
