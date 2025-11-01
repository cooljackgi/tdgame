

import type { LucideIcon } from 'lucide-react';
import { Timestamp } from 'firebase/firestore';

export type Element = 'fire' | 'water' | 'earth' | 'air' | 'nature' | 'light' | 'dark' | 'neutral';
export type Difficulty = 'Einfach' | 'Normal' | 'Schwer' | 'Chaos';

export type Node = {
  row: number;
  col: number;
};

export type Player = {
  id: 'player1' | 'player2' | 'spectator';
  name: string;
  avatarUrl?: string | null;
  resources: number;
  unlockedElements: Element[];
  incomePerSecond: number;
};

export type GameState = {
  lives: number;
}

export type GameSaveState = {
  players: { player1: Player, player2: Player | null };
  gameState: GameState;
  towersByCell: Record<string, PlacedTower>;
  enemies: Enemy[];
  currentWave: number;
  difficulty: Difficulty;
  workers: Worker[];
  ghosts: GhostFoundation[];
  portals: Portal[];
};

export type GameResult = {
    playerName: string;
    playerUid: string;
    date: string | Timestamp;
    difficulty: Difficulty;
    wave: number;
    won: boolean;
    finalTowers?: Record<string, PlacedTower>;
};

export type GameResultWithId = GameResult & {
    id: string;
};

export type GravityWell = {
  id: string;
  x: number;
  y: number;
  radius: number;
  potency: number;
  expires: number;
};

export type PersistentCloudEffect = 'poison' | 'slow' | 'burn';

export type PersistentCloud = {
  id: string;
  effectType: PersistentCloudEffect;
  x: number;
  y: number;
  radius: number;
  potency: number; // For poison: damage/sec. For slow: 0.0 to 1.0.
  duration: number; // How long the effect lasts on an enemy.
  expires: number; // When the cloud itself disappears.
};

export type Portal = {
  id: string;
  entrance: { row: number; col: number };
  exit:     { row: number; col: number };
  active: boolean;
  usesLeft: number;
  perEnemyCooldownMs: number;
};


export type SplashRingVfxType = 'magma' | 'flame' | 'ice' | 'rock' | 'thorn' | 'light' | 'dark' | 'poison' | 'steam';

export type TowerEffect = {
  type: 'slow' | 'stun' | 'burn' | 'pushback' | 'splash' | 'multishot' | 'chain' | 'pull' | 'vulnerability' | 'aura' | 'armor_shred' | 'lifesteal' | 'crit' | 'poison' | 'persistent_cloud';
  duration?: number; // ms
  potency?: number; // e.g., 0.5 for 50% slow, or damage per tick for burn
  chance?: number; // 0 to 1 for stun/crit etc.
  distance?: number; // for pushback
  radius?: number; // for splash damage or cloud radius
  targets?: number; // for multishot
  bounces?: number; // for chain
  vfxType?: SplashRingVfxType;
  cloudEffect?: PersistentCloudEffect; // What effect the cloud applies
};

export type Tower = {
  id: string;
  name: string;
  tier: 0 | 1 | 2 | 3;
  elements: Element[];
  cost: number;
  damage: number;
  range: number; // in grid units
  attackSpeed: number; // milliseconds between attacks
  buildTimeMs?: number;
  description: string;
  maxHealth: number;
  isBlocker?: boolean;
  effects?: TowerEffect[];
  upgradesTo?: string[];
  isBase: boolean;
  get dps(): number;
};

export type PlacedTower = Tower & {
  specId: string;
  position: { row: number; col: number };
  lastAttack: number;
  health: number;
  ownerId: Player['id'];
};

export type Attack = {
  id: string;
  towerId: string;
  targetId: string;
  targetPosition: Node;
  elements: Tower['elements'];
  projectile: 'beam' | 'arrow' | 'chain';
  isChain?: boolean;
  chainSourceId?: string;
  active?: boolean;
  baseDamage: number;
  critChance?: number;
  critMult?: number;
  armorPenFlat?: number;
  dots?: DoTEffect[];
};

export type DamageNumber = {
  id: string;
  amount: number;
  targetId?: string;
  position?: { row: number; col: number };
  color: string;
  isCrit?: boolean;
  active?: boolean;
};

export type LifeGainVfx = {
  id: string;
  amount: number;
};


export type SplashRing = {
    id: string;
    x: number;
    y: number;
    r: number;
    color: string;
    element: Element;
    start?: number;
    life?: number;
    vfxType?: SplashRingVfxType;
    active?: boolean;
};

export type EnemyType = 'standard' | 'schnell' | 'gepanzert' | 'heilend' | 'boss';

export type MovementPattern = 'wobble' | 'zigzag' | 'straight';

export type EnemyStatusEffect = {
  type: TowerEffect['type'];
  expires: number;
  potency: number;
  lastTick?: number;
  duration?: number;
  chance?: number;
  radius?: number;
};

export type Debuffs = {
    vulnerabilityPct?: number;
    armorReductionFlat?: number;
};

export type DoTEffect = {
    id: string;
    sourceId: string;
    type: 'burn' | 'poison';
    startTime: number;
    durationMs: number;
    remainingMs: number;
    tickMs: number;
    flatPerTick?: number;
    scalePctOfHit?: number;
    critScaled?: boolean;
    snapshotted?: boolean;
};

export type Enemy = {
  id: string;
  type: EnemyType;
  health: number;
  maxHealth: number;
  armor: number;
  speed: number;
  damage: number;
  bounty: number;
  path: Node[];
  pathIndex: number;
  position: { row: number; col: number };
  isBlocked: boolean;
  effects: EnemyStatusEffect[];
  activeDots?: DoTEffect[];
  debuffs?: Debuffs;
  lastMove: number;
  wasHit: boolean;
  targetNode: Node;
  movementPattern: MovementPattern;
  vx: number;
  vy: number;
  deathTimestamp?: number;
  lastTeleportAt?: number;
  teleportsUsed?: number;
};


export enum DeltaType {
    ENEMY_SPAWN, ENEMY_MOVE, ENEMY_DAMAGE, ENEMY_DIE, ENEMY_REACH_END, ENEMY_ADD_EFFECT, ENEMY_REMOVE_EFFECT,
    TOWER_ATTACK, VFX_DAMAGE_NUMBER, VFX_SPLASH, GAME_STATE_UPDATE, PLAYER_UPDATE, TOWERS_UPDATE, CLIENT_STATS_UPDATE,
    TOWER_UPGRADE_VFX, ENEMY_PATH_UPDATE, BUILD_TOWER_REQUEST, UPGRADE_TOWER_REQUEST, SELL_TOWER_REQUEST,
}

export type GameDelta = [DeltaType, ...any[]];


export type WaveEnemyData = {
  type: EnemyType;
  count: number;
  spawnDelay: number;
  health: number;
  armor: number;
  speed: number;
  damage: number;
  bounty: number;
};

export type Wave = {
  waveNumber: number;
  enemies: WaveEnemyData;
};

export type PingKind = 'attention' | 'defend' | 'attack' | 'build' | 'sell';
export type PingPayload = { id: string; kind: PingKind; from: 'player1' | 'player2'; row: number; col: number; msg?: string; ttl?: number; createdAt: number; };
export type RequestKind = 'REQUEST_BUILD_AT' | 'REQUEST_SELL_TOWER' | 'REQUEST_UPGRADE_TOWER';
export type RequestPayload = { id: string; kind: RequestKind; from: 'player1' | 'player2'; row?: number; col?: number; towerId?: string; upgradeId?: string; msg?: string; createdAt: number; };
export type RequestResolve = { id: string; result: 'accepted' | 'declined'; by: 'player1'|'player2'; at: number };
export type SoundEvent = | { kind: 'attack'; element: Element; pitch?: number; x: number; y: number, towerId?: string; } | { kind: 'sfx'; name: 'enemy_die' | 'enemy_leak' | 'build_tower' | 'upgrade_tower' | 'sell_tower' | 'ui_click' | 'wave_start'; x?: number; y?: number };
export type AuraBuffs = { damageFlat?: number; damageMult?: number; };
export type DamageApplicationResult = { immediateDamage: number; crit: boolean; vulnerabilityAppliedPct: number; effectiveArmor: number; dotsApplied: DoTEffect[]; killed: boolean; };
export type ProcessAttackResult = { updatedEnemies: Enemy[]; newAttacks: Attack[]; damageNumbers: DamageNumber[]; splashRings: SplashRing[]; lifeGainVfx: LifeGainVfx[]; newPersistentClouds: PersistentCloud[]; newGravityWells: GravityWell[]; soundEvents: SoundEvent[]; resourcesGained: number; livesGained: number; killed: number; };

export type WorkerState = "idle" | "moving" | "building";
export type WorkerOrderType = "build_tower" | "place_portal";

export interface WorkerOrderBase { id: string; type: WorkerOrderType; createdAt: number; }
export interface BuildTowerOrder extends WorkerOrderBase { type: "build_tower"; row: number; col: number; towerId: string; cost: number; buildTimeMs: number; }
export interface PlacePortalOrder extends WorkerOrderBase { type: "place_portal"; entrance: { row: number; col: number }; exit: { row: number; col: number }; cost: number; buildTimeMsEntrance: number; buildTimeMsExit: number; phase: "entrance" | "exit"; }
export type WorkerOrder = BuildTowerOrder | PlacePortalOrder;

export interface Worker {
  id: string;
  x: number;
  y: number;
  z?: number;
  speed: number;
  state: WorkerState;
  queue: WorkerOrder[];
  current?: { order: WorkerOrder; targetX: number; targetY: number; startedAt?: number; eta?: number; };
  moveTarget?: { x: number, y: number } | null;
}

export interface GhostFoundation { id: string; row: number; col: number; towerId: string; startedAt: number; buildTimeMs: number; progress: number; }

export interface GameSessionState {
  players: Player[];
  gameState: GameState;
  towersByCell: Record<string, PlacedTower>;
  enemies: Enemy[];
  currentWave: number;
  difficulty: Difficulty;
  gameStatus: 'waiting' | 'playing' | 'paused' | 'gameover' | 'picking-element' | 'tutorial';
  currentPath: Node[];
  waveStartCountdown: number;
  isIntermission: boolean;
  workers: Worker[];
  ghosts: GhostFoundation[];
  portals: Portal[];
}
