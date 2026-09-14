import { NextRequest, NextResponse } from 'next/server';
import { hasCredentials } from './lib/security/auth';

export function middleware(req: NextRequest) {
  const enabled = ['1', 'true', 'yes', 'on'].includes((process.env.APP_AUTH_ENABLED ?? '').trim().toLowerCase());
  if (!enabled) return NextResponse.next();
  const password = (process.env.APP_AUTH_PASSWORD ?? '').trim();
  if (!password) return new NextResponse('Server authentication is misconfigured.', { status: 503 });
  if (!hasCredentials(req, password)) {
    return new NextResponse('Authentication required.', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="SupplySaathi", charset="UTF-8"', 'Cache-Control': 'no-store' },
    });
  }
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
