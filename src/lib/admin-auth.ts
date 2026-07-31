import { createHash, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';

export const ADMIN_SESSION_COOKIE = 'nexus_admin_session';
const SESSION_SALT = 'elementarer-nexus-admin-session-v1';

function getAdminKey(): string | null {
  const key = process.env.FIRESTORE_READ_API_KEY?.trim();
  return key || null;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAdminConfigured(): boolean {
  return getAdminKey() !== null;
}

export function createAdminSessionToken(): string | null {
  const key = getAdminKey();
  if (!key) return null;
  return createHash('sha256').update(`${SESSION_SALT}:${key}`).digest('hex');
}

export function isValidAdminKey(providedKey: string | null | undefined): boolean {
  const requiredKey = getAdminKey();
  return Boolean(requiredKey && providedKey && safeEqual(providedKey, requiredKey));
}

export function isValidAdminSession(token: string | null | undefined): boolean {
  const expectedToken = createAdminSessionToken();
  return Boolean(expectedToken && token && safeEqual(token, expectedToken));
}

export function isAdminAuthorized(req: NextRequest): boolean {
  const headerKey = req.headers.get('x-firedb-key');
  const queryKey = req.nextUrl.searchParams.get('key');
  const sessionToken = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;

  return isValidAdminKey(headerKey || queryKey) || isValidAdminSession(sessionToken);
}

export function requireAdminSession(): void {
  const token = cookies().get(ADMIN_SESSION_COOKIE)?.value;
  if (!isValidAdminSession(token)) {
    throw new Error('Nicht autorisiert. Bitte melde dich im Admin Center an.');
  }
}
