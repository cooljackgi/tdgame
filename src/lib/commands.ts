// src/lib/commands.ts
import { towers as allTowers } from './game-data/towers';
import { findPath } from './pathfinding';
import { GRID_ROWS, GRID_COLS } from './game-data/constants';
import type { GameSessionState, BuildOrder } from './game-data/types';
import { startNextOrder } from './game-logic';

function tierToBuildTime(tier: number) {
  if (tier <= 0) return 1200;
  if (tier === 1) return 1600;
  if (tier === 2) return 2200;
  return 3000; // tier 3+
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

  // Check if cell is already occupied by a tower or a ghost
  const isOccupied = 
    Object.values(state.towersByCell).some(t => t.position.row === row && t.position.col === col) ||
    state.ghosts.some(g => g.row === row && g.col === col);
    
  if (isOccupied) return state;

  // Pathfinding check
  const newBlocked = [...Object.values(state.towersByCell).map(t => t.position), {row, col}];
  if (!findPath({row:1,col:1}, {row:GRID_ROWS,col:GRID_COLS}, newBlocked, GRID_ROWS, GRID_COLS)) {
      // Maybe show a toast/error to the user here
      return state;
  }

  if (player.resources < cost) return state; // not enough money
  
  player.resources -= cost;

  const ghostId = `ghost-${row}-${col}-${now}`;
  state.ghosts.push({
    id: ghostId,
    row: row,
    col: col,
    towerId: towerId,
    startedAt: 0, // Will be set when building starts
    buildTimeMs: buildTimeMs,
    progress: 0,
  });

  const order: BuildOrder = {
    id: `order-${row}-${col}-${now}`,
    row, col, towerId, cost, buildTimeMs, createdAt: now
  };
  worker.queue.push(order);

  if (worker.state === "idle" && !worker.current) {
    return startNextOrder(state, worker);
  }
  
  return state;
}
