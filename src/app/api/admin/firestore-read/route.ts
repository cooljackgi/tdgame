import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { app as adminApp } from '@/lib/firebase-admin';
import { isAdminAuthorized } from '@/lib/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseLimit(rawValue: string | null, fallback = 100): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(500, Math.floor(parsed));
}

function normalizeDocPath(path: string): string {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) {
    throw new Error('Document path is empty.');
  }
  const segments = trimmed.split('/').filter(Boolean);
  if (segments.length % 2 !== 0) {
    throw new Error('Document path must point to a document (even number of segments).');
  }
  return segments.join('/');
}

function serializeFirestoreValue(value: any): any {
  if (value == null) return value;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serializeFirestoreValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializeFirestoreValue(entry)])
    );
  }
  return value;
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getFirestore(adminApp);
    const searchParams = req.nextUrl.searchParams;
    const mode = searchParams.get('mode') || 'balancing';

    if (mode === 'balancing') {
      const snap = await db.doc('game_config/balancing').get();
      if (!snap.exists) {
        return NextResponse.json({ error: 'Balancing document not found.' }, { status: 404 });
      }
      const data = snap.data() || {};
      const towers = Array.isArray(data.towers) ? data.towers : [];
      const waves = Array.isArray(data.waves) ? data.waves : [];
      return NextResponse.json({
        id: snap.id,
        path: snap.ref.path,
        towersCount: towers.length,
        wavesCount: waves.length,
        data,
      });
    }

    if (mode === 'game') {
      const gameId = searchParams.get('gameId');
      if (!gameId) {
        return NextResponse.json({ error: 'Missing gameId parameter.' }, { status: 400 });
      }
      const snap = await db.collection('games').doc(gameId).get();
      if (!snap.exists) {
        return NextResponse.json({ error: 'Game not found.' }, { status: 404 });
      }
      return NextResponse.json({ id: snap.id, path: snap.ref.path, data: serializeFirestoreValue(snap.data()) });
    }

    if (mode === 'games') {
      const limit = parseLimit(searchParams.get('limit'), 50);
      const gamesSnap = await db.collection('games').orderBy('createdAt', 'desc').limit(limit).get();
      const games = await Promise.all(gamesSnap.docs.map(async (doc) => {
        const data = doc.data();
        const logsCount = await doc.ref.collection('game_logs').count().get();
        return {
          id: doc.id,
          gameId: data.gameName || doc.id,
          createdAt: serializeFirestoreValue(data.createdAt) || new Date(0).toISOString(),
          gameStatus: data.gameStatus || 'unbekannt',
          currentWave: typeof data.currentWave === 'number' ? data.currentWave : 0,
          logCount: logsCount.data().count,
        };
      }));
      return NextResponse.json({ count: games.length, games });
    }

    if (mode === 'logs') {
      const gameId = searchParams.get('gameId');
      if (!gameId) {
        return NextResponse.json({ error: 'Missing gameId parameter.' }, { status: 400 });
      }
      const limit = parseLimit(searchParams.get('limit'), 200);
      const logsSnap = await db
        .collection('games')
        .doc(gameId)
        .collection('game_logs')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      const logs = logsSnap.docs.map((doc) => ({ id: doc.id, ...serializeFirestoreValue(doc.data()) }));
      return NextResponse.json({ gameId, count: logs.length, logs });
    }

    if (mode === 'doc') {
      const path = searchParams.get('path');
      if (!path) {
        return NextResponse.json({ error: 'Missing path parameter.' }, { status: 400 });
      }
      const docPath = normalizeDocPath(path);
      const snap = await db.doc(docPath).get();
      if (!snap.exists) {
        return NextResponse.json({ error: 'Document not found.', path: docPath }, { status: 404 });
      }
      return NextResponse.json({ id: snap.id, path: snap.ref.path, data: serializeFirestoreValue(snap.data()) });
    }

    return NextResponse.json({ error: `Unsupported mode: ${mode}` }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to read Firestore.' },
      { status: 500 }
    );
  }
}
