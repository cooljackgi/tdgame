import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
  isAdminAuthorized,
  isAdminConfigured,
  isValidAdminKey,
} from '@/lib/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return NextResponse.json(
    { authenticated: isAdminAuthorized(req), configured: isAdminConfigured() },
    { status: isAdminAuthorized(req) ? 200 : 401 }
  );
}

export async function POST(req: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: 'Admin-Zugang ist auf dem Server nicht konfiguriert.' },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null) as { key?: string } | null;
  if (!isValidAdminKey(body?.key)) {
    return NextResponse.json({ error: 'Admin-Schlüssel ist ungültig.' }, { status: 401 });
  }

  const token = createAdminSessionToken();
  if (!token) {
    return NextResponse.json({ error: 'Admin-Sitzung konnte nicht erstellt werden.' }, { status: 503 });
  }

  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(ADMIN_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  return response;
}
