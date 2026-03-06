import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { app as adminApp } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  const requiredKey = process.env.FIRESTORE_READ_API_KEY;
  if (!requiredKey) return false;

  const keyFromHeader = req.headers.get('x-firedb-key');
  const keyFromQuery = req.nextUrl.searchParams.get('key');
  const providedKey = keyFromHeader || keyFromQuery;

  return providedKey === requiredKey;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { docPath, data } = body;

    if (!docPath || !data) {
      return new NextResponse(
        JSON.stringify({ error: 'Missing docPath or data' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const db = getFirestore(adminApp);
    const segments = docPath
      .trim()
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .filter(Boolean);

    if (segments.length === 0) {
      return new NextResponse(
        JSON.stringify({ error: 'Invalid document path' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Build reference: for "games/gameId", use db.collection('games').doc('gameId')
    // for "games/gameId/logs/logId", use db.collection('games').doc('gameId').collection('logs').doc('logId')
    let ref: any = db;
    for (let i = 0; i < segments.length; i++) {
      if (i % 2 === 0) {
        // Even index = collection
        ref = ref.collection(segments[i]);
      } else {
        // Odd index = document
        ref = ref.doc(segments[i]);
      }
    }

    await ref.update(data);

    return new NextResponse(JSON.stringify({ success: true, docPath }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new NextResponse(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
