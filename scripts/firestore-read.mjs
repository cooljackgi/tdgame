#!/usr/bin/env node

import admin from 'firebase-admin';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i++;
  }
  return args;
}

function initAdmin() {
  if (admin.apps.length) return;
  const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccountString) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(serviceAccountString)),
    });
    return;
  }
  admin.initializeApp();
}

function printUsage() {
  console.log(`
Usage:
  npm run firestore:read -- --mode balancing
  npm run firestore:read -- --mode game --gameId <id>
  npm run firestore:read -- --mode logs --gameId <id> --limit 50
  npm run firestore:read -- --mode doc --path game_config/balancing

Auth:
  - Set FIREBASE_SERVICE_ACCOUNT to the full JSON string of a service account
    OR configure Application Default Credentials.
`);
}

async function main() {
  const args = parseArgs(process.argv);
  const mode = args.mode || 'balancing';
  const limit = Math.min(500, Number(args.limit || 100));

  initAdmin();
  const db = admin.firestore();

  if (mode === 'balancing') {
    const snap = await db.doc('game_config/balancing').get();
    if (!snap.exists) throw new Error('game_config/balancing not found');
    const data = snap.data() || {};
    const towers = Array.isArray(data.towers) ? data.towers.length : 0;
    const waves = Array.isArray(data.waves) ? data.waves.length : 0;
    console.log(JSON.stringify({ path: snap.ref.path, towersCount: towers, wavesCount: waves, data }, null, 2));
    return;
  }

  if (mode === 'game') {
    if (!args.gameId) throw new Error('--gameId is required for mode=game');
    const snap = await db.collection('games').doc(args.gameId).get();
    if (!snap.exists) throw new Error(`games/${args.gameId} not found`);
    console.log(JSON.stringify({ path: snap.ref.path, data: snap.data() }, null, 2));
    return;
  }

  if (mode === 'logs') {
    if (!args.gameId) throw new Error('--gameId is required for mode=logs');
    const logsSnap = await db
      .collection('games')
      .doc(args.gameId)
      .collection('game_logs')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    const logs = logsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    console.log(JSON.stringify({ gameId: args.gameId, count: logs.length, logs }, null, 2));
    return;
  }

  if (mode === 'doc') {
    if (!args.path) throw new Error('--path is required for mode=doc');
    const cleanPath = String(args.path).replace(/^\/+|\/+$/g, '');
    const segments = cleanPath.split('/').filter(Boolean);
    if (segments.length % 2 !== 0) {
      throw new Error('--path must point to a document path');
    }
    const snap = await db.doc(cleanPath).get();
    if (!snap.exists) throw new Error(`${cleanPath} not found`);
    console.log(JSON.stringify({ path: snap.ref.path, data: snap.data() }, null, 2));
    return;
  }

  throw new Error(`Unsupported mode: ${mode}`);
}

main().catch((error) => {
  console.error(error?.message || error);
  printUsage();
  process.exit(1);
});
