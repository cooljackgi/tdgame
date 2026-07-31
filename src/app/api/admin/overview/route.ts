import { NextRequest, NextResponse } from 'next/server';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { isAdminAuthorized } from '@/lib/admin-auth';
import { app as adminApp } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIGNALING_HEALTH_URL = 'https://ws-relay-345017018409.us-central1.run.app/';
const JOIN_GAME_URL = 'https://us-central1-studio-8208926735-5ea4c.cloudfunctions.net/joinGame';

function toIsoDate(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

async function checkSignaling() {
  const startedAt = Date.now();
  try {
    const response = await fetch(SIGNALING_HEALTH_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.text();
    return {
      ok: response.ok && body.includes('webrtc-signaling-server ok'),
      latencyMs: Date.now() - startedAt,
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkCallableFunction() {
  const startedAt = Date.now();
  try {
    const response = await fetch(JOIN_GAME_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { gameId: '__admin_healthcheck__' } }),
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    await response.text();
    return {
      // Callable functions reject this deliberately unauthenticated probe.
      // A 400/401 proves that the deployed handler is reachable and enforcing auth.
      ok: response.status === 400 || response.status === 401,
      latencyMs: Date.now() - startedAt,
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const db = getFirestore(adminApp);
    const gamesRef = db.collection('games');
    const scoresRef = db.collection('scores');
    const balancingRef = db.doc('game_config/balancing');

    const [gamesCountSnap, scoresCountSnap, balancingSnap, recentGamesSnap, signaling, functions] = await Promise.all([
      gamesRef.count().get(),
      scoresRef.count().get(),
      balancingRef.get(),
      gamesRef.orderBy('createdAt', 'desc').limit(8).get(),
      checkSignaling(),
      checkCallableFunction(),
    ]);

    const balancing = balancingSnap.data() || {};
    const towers = Array.isArray(balancing.towers) ? balancing.towers : [];
    const waves = Array.isArray(balancing.waves) ? balancing.waves : [];
    const recentGames = recentGamesSnap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.gameName || doc.id,
        status: data.gameStatus || 'unbekannt',
        wave: typeof data.currentWave === 'number' ? data.currentWave : 0,
        createdAt: toIsoDate(data.createdAt),
      };
    });

    const firestoreLatencyMs = Date.now() - startedAt;
    const checks = {
      firestore: { ok: true, latencyMs: firestoreLatencyMs },
      balancing: { ok: balancingSnap.exists, towers: towers.length, waves: waves.length },
      signaling,
      functions,
      adminSecret: { ok: Boolean(process.env.FIRESTORE_READ_API_KEY) },
    };

    return NextResponse.json({
      status: Object.values(checks).every((check) => check.ok) ? 'healthy' : 'degraded',
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      projectId: adminApp.options.projectId || process.env.GCLOUD_PROJECT || 'studio-8208926735-5ea4c',
      environment: process.env.NODE_ENV || 'unknown',
      metrics: {
        games: gamesCountSnap.data().count,
        scores: scoresCountSnap.data().count,
        towers: towers.length,
        waves: waves.length,
      },
      checks,
      recentGames,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Systemprüfung fehlgeschlagen.',
      },
      { status: 500 }
    );
  }
}
