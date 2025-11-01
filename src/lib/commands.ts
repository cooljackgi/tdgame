
// src/lib/commands.ts
import { towers as allTowers } from './game-data/towers';
import { findPath } from './pathfinding';
import { GRID_ROWS, GRID_COLS } from './game-data/constants';
import type { GameSessionState, BuildTowerOrder, Worker, PlacePortalOrder, Player } from './game-data/types';

function tierToBuildTime(tier: number) {
  if (tier <= 0) return 1200;
  if (tier === 1) return 1600;
  if (tier === 2) return 2200;
  return 3000; // tier 3+
}

export function enqueueMoveOrder(state: GameSessionState, workerId: string, row: number, col: number): GameSessionState {
    const worker = state.workers.find(w => w.id === workerId);
    if (!worker) return state;

    // A direct move command should only be executed if the worker is idle and has no build queue.
    // Otherwise, we let the build queue take precedence.
    if (worker.state === 'idle' && worker.queue.length === 0) {
        worker.moveTarget = { x: (col - 1) * 64 + 32, y: (row - 1) * 64 + 32 };
        worker.state = 'moving'; // Start moving immediately
    } else if (worker.state === 'moving' && !worker.current) {
        // If already moving to a point (not for a build), update the target
        worker.moveTarget = { x: (col - 1) * 64 + 32, y: (row - 1) * 64 + 32 };
    }
    
    return { ...state };
}


export function enqueueBuildOrder(
  state: GameSessionState,
  workerId: string,
  row: number,
  col: number,
  towerId: string,
  now: number
): GameSessionState {
  const worker = state.workers.find(w => w.id === workerId);
  const player = state.players.find(p => p.id === (workerId.includes('1') ? 'player1' : 'player2'));

  if (!worker || !player) return state;

  const towerSpec = allTowers.find(t => t.id === towerId);
  if (!towerSpec) return state;

  const cost = towerSpec.cost;
  const buildTimeMs = towerSpec.buildTimeMs ?? tierToBuildTime(towerSpec.tier);

  const isOccupied = 
    Object.values(state.towersByCell).some(t => t.position.row === row && t.position.col === col) ||
    state.ghosts.some(g => g.row === row && g.col === col);
    
  if (isOccupied) return state;

  const newBlocked = [...Object.values(state.towersByCell).map(t => t.position), {row, col}];
  if (!findPath({row:1,col:1}, {row:GRID_ROWS,col:GRID_COLS}, newBlocked, GRID_ROWS, GRID_COLS)) {
      return state;
  }

  if (player.resources < cost) return state;
  
  player.resources -= cost;

  const ghostId = `ghost-${row}-${col}-${now}`;
  state.ghosts.push({
    id: ghostId,
    row: row,
    col: col,
    towerId: towerId,
    startedAt: 0,
    buildTimeMs: buildTimeMs,
    progress: 0,
  });

  const order: BuildTowerOrder = {
    id: `order-${row}-${col}-${now}`,
    type: "build_tower",
    row, col, towerId, cost, buildTimeMs, createdAt: now
  };
  worker.queue.push(order);
  
  return state;
}

export function enqueuePlacePortalOrder(
  state: GameSessionState,
  workerId: string,
  entrance: { row: number; col: number },
  exit:     { row: number; col: number },
  now: number,
): GameSessionState {
    const cost = 250;
    const buildEntranceTime = 1200;
    const buildExitTime = 1500;

    const worker = state.workers.find(w => w.id === workerId);
    const player = state.players.find(p => p.id === (workerId.includes('1') ? 'player1' : 'player2')) as Player;

    if (!worker || !player || player.resources < cost) return state;
    if ((player.portalCooldownUntilWave || 0) > state.currentWave) return state;

    // Simplified validation checks
    const isOccupied = (r: number, c: number) => 
        Object.values(state.towersByCell).some(t => t.position.row === r && t.position.col === c) ||
        state.ghosts.some(g => g.row === r && g.col === c);

    if (isOccupied(entrance.row, entrance.col) || isOccupied(exit.row, exit.col)) return state;

    player.resources -= cost;

    const order: PlacePortalOrder = {
        id: `portal-${now}`,
        type: "place_portal",
        createdAt: now,
        entrance, exit,
        cost,
        buildTimeMsEntrance: buildEntranceTime,
        buildTimeMsExit: buildExitTime,
        phase: "entrance",
    };

    worker.queue.push(order);
    
    return state;
}
