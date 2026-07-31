import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { app as adminApp } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Public, read-only game configuration.
 *
 * Tower and wave values are already visible to every player in the game UI. The
 * server route makes sure the game and the admin tools read the same Firestore
 * document without depending on client-side Firestore rules or an IndexedDB
 * cache.
 */
export async function GET() {
  try {
    const snap = await getFirestore(adminApp).doc('game_config/balancing').get();
    if (!snap.exists) {
      return NextResponse.json(
        { error: 'Balancing configuration not found.' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const data = snap.data() || {};
    const towers = Array.isArray(data.towers) ? data.towers : [];
    const waves = Array.isArray(data.waves) ? data.waves : [];

    if (towers.length === 0 || waves.length === 0) {
      return NextResponse.json(
        { error: 'Balancing configuration is incomplete.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    return NextResponse.json(
      {
        source: snap.ref.path,
        towers,
        waves,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    );
  } catch (error) {
    console.error('Failed to load public game configuration:', error);
    return NextResponse.json(
      { error: 'Failed to load balancing configuration.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
