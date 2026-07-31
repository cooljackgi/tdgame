
// src/lib/commands.ts
import { towers as allTowers } from './game-data/towers';
import { findPath } from './pathfinding';
import { GRID_ROWS, GRID_COLS } from './game-data/constants';
import type { GameSessionState, BuildTowerOrder, Worker, PlacePortalOrder, Player, PlayerGameState } from './game-data/types';

function tierToBuildTime(tier: number) {
  if (tier <= 0) return 1200;
  if (tier === 1) return 1600;
  if (tier === 2) return 2200;
  return 3000; // tier 3+
}

export function enqueueMoveOrder(state: GameSessionState, workerId: string, row: number, col: number): GameSessionState {
    const isVersus = state.gameMode === 'versus';
    const playerStateKey = workerId.includes('1') ? 'player1' : 'player2';

    const workersSource = isVersus ? state.playerStates![playerStateKey].workers : state.workers!;
    const workers = Array.isArray(workersSource) ? workersSource : [];
    const worker = workers.find(w => w.id === workerId);
    if (!worker) return state;

    if (worker.state === 'idle' && worker.queue.length === 0) {
        worker.moveTarget = { x: (col - 1) * 64 + 32, y: (row - 1) * 64 + 32 };
        worker.state = 'moving';
    } else if (worker.state === 'moving' && !worker.current) {
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
  const isVersus = state.gameMode === 'versus';
  const playerStateKey = workerId.includes('1') ? 'player1' : 'player2';
  const player = state.players.find(p => p.id === playerStateKey);
  
  if (!player) return state;

  let playerState: PlayerGameState;
  if (isVersus) {
      if (!state.playerStates) return state;
      playerState = state.playerStates[playerStateKey];
  } else {
      playerState = state as unknown as PlayerGameState;
  }

  // Defensive checks to ensure playerState and its properties are valid
  if (!playerState) return state;
  const workers = Array.isArray(playerState.workers) ? playerState.workers : [];
  const ghosts = Array.isArray(playerState.ghosts) ? playerState.ghosts : [];
  const towersByCell = playerState.towersByCell || {};
  
  const worker = workers.find(w => w.id === workerId);
  if (!worker) return state;
  
  const towerSpec = allTowers.find(t => t.id === towerId);
  if (!towerSpec) return state;

  const cost = towerSpec.cost;
  const buildTimeMs = towerSpec.buildTimeMs ?? tierToBuildTime(towerSpec.tier);

  const isOccupied = 
    Object.values(towersByCell).some(t => t.position.row === row && t.position.col === col) ||
    ghosts.some(g => g.row === row && g.col === col);
    
  if (isOccupied) return state;

  const newBlocked = [...Object.values(towersByCell).map(t => t.position), {row, col}];
  if (!findPath({row:1,col:1}, {row:GRID_ROWS,col:GRID_COLS}, newBlocked, GRID_ROWS, GRID_COLS)) {
      return state;
  }

  if (player.resources < cost) return state;
  
  player.resources -= cost;

  const ghostId = `ghost-${row}-${col}-${now}`;
  ghosts.push({
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
    
    const isVersus = state.gameMode === 'versus';
    const playerStateKey = workerId.includes('1') ? 'player1' : 'player2';
    const player = state.players.find(p => p.id === playerStateKey) as Player;

    if (!player || player.resources < cost) return state;
    if ((player.portalCooldownUntilWave || 0) > state.currentWave) return state;
    if (entrance.row === exit.row && entrance.col === exit.col) return state;
    
    let playerState: PlayerGameState;
    if (isVersus) {
      if (!state.playerStates) return state;
      playerState = state.playerStates[playerStateKey];
    } else {
      playerState = state as unknown as PlayerGameState;
    }
    
    const workers = Array.isArray(playerState.workers) ? playerState.workers : [];
    const ghosts = Array.isArray(playerState.ghosts) ? playerState.ghosts : [];
    const towersByCell = playerState.towersByCell || {};
    const portals = Array.isArray(playerState.portals) ? playerState.portals : [];

    const worker = workers.find(w => w.id === workerId);
    if(!worker) return state;


    // Simplified validation checks
    const isOccupied = (r: number, c: number) => 
        Object.values(towersByCell).some(t => t.position.row === r && t.position.col === c) ||
        ghosts.some(g => g.row === r && g.col === c) ||
        portals.some(portal =>
          (portal.entrance.row === r && portal.entrance.col === c) ||
          (portal.exit.row === r && portal.exit.col === c)
        );

    if (isOccupied(entrance.row, entrance.col) || isOccupied(exit.row, exit.col)) return state;

    player.resources -= cost;
    player.portalCooldownUntilWave = state.currentWave + 4; // Current wave + 3 waves cooldown

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
