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

export type TowerEffect = {
  type: 'slow' | 'stun' | 'burn' | 'pushback' | 'splash' | 'multishot' | 'chain' | 'pull' | 'vulnerability' | 'aura' | 'armor_shred' | 'lifesteal' | 'crit' | 'poison';
  duration?: number; // ms
  potency?: number; // e.g., 0.5 for 50% slow, or damage per tick for burn
  chance?: number; // 0 to 1 for stun/crit etc.
  distance?: number; // for pushback
  radius?: number; // for splash damage
  targets?: number; // for multishot
  bounces?: number; // for chain
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
  description: string;
  maxHealth: number;
  isBlocker?: boolean;
  effect?: TowerEffect;
  upgradesTo?: string[]; // Array of tower IDs it can upgrade to
  isBase: boolean;
  get dps(): number;
};

export type PlacedTower = Tower & {
  specId: string;
  position: { row: number; col: number };
  lastAttack: number; // timestamp of the last attack
  health: number;
  ownerId: Player['id'];
};

export type Attack = {
  id: string;
  towerId: string;
  targetId: string;
  targetPosition: Node; // The position of the target at the time of attack
  elements: Tower['elements'];
  projectile: 'beam' | 'arrow' | 'chain';
  isChain?: boolean;
  chainSourceId?: string;
  // VFX Pool properties
  active?: boolean;
};

export type DamageNumber = {
  id: string;
  amount: number;
  targetId: string;
  position: { row: number; col: number };
  color: string;
  isCrit?: boolean;
  // VFX Pool properties
  active?: boolean;
};

export type LifeGainVfx = {
  id: string;
  amount: number;
};

export type SplashRingVfxType = 'magma' | 'flame' | 'ice' | 'rock' | 'thorn' | 'light' | 'dark' | 'poison';

export type SplashRing = {
    id: string;
    x: number;
    y: number;
    r: number;
    color: string;
    element: Element;
    start: number;
    life: number;
    vfxType?: SplashRingVfxType;
    // VFX Pool properties
    active?: boolean;
};

export type EnemyType = 'standard' | 'schnell' | 'gepanzert' | 'heilend' | 'boss';

export type MovementPattern = 'wobble' | 'zigzag' | 'straight';

export type EnemyStatusEffect = {
  type: TowerEffect['type'];
  expires: number;
  potency: number;
  lastTick?: number; // For DoT effects like burn
  duration?: number;
  chance?: number;
  radius?: number;
};

export type Enemy = {
  id: string;
  type: EnemyType;
  health: number;
  maxHealth: number;
  armor: number;
  speed: number; // path indices per second
  damage: number; // damage per second to towers
  bounty: number; // resources awarded on defeat
  path: Node[];
  pathIndex: number;
  position: { row: number; col: number };
  isBlocked: boolean;
  effects: EnemyStatusEffect[];
  lastMove: number;
  wasHit: boolean;
  targetNode: Node;
  movementPattern: MovementPattern;
  // New properties for pull effect
  vx: number; // velocity x
  vy: number; // velocity y
  deathTimestamp?: number; // New property for death animation
};


export enum DeltaType {
    ENEMY_SPAWN,
    ENEMY_MOVE,
    ENEMY_DAMAGE,
    ENEMY_DIE,
    ENEMY_REACH_END,
    ENEMY_ADD_EFFECT,
    ENEMY_REMOVE_EFFECT,
    TOWER_ATTACK,
    VFX_DAMAGE_NUMBER,
    VFX_SPLASH,
    GAME_STATE_UPDATE,
    PLAYER_UPDATE,
    TOWERS_UPDATE,
    CLIENT_STATS_UPDATE,
    TOWER_UPGRADE_VFX,
    ENEMY_PATH_UPDATE,
    BUILD_TOWER_REQUEST,
    UPGRADE_TOWER_REQUEST,
    SELL_TOWER_REQUEST,
}

export type GameDelta = [DeltaType, ...any[]];


export type WaveEnemyData = {
  type: EnemyType;
  count: number;
  spawnDelay: number; // ms
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

// --- PING & REQUEST SYSTEM ---

export type PingKind = 'attention' | 'defend' | 'attack' | 'build' | 'sell';
export type PingPayload = {
  id: string;
  kind: PingKind;
  from: 'player1' | 'player2';
  row: number;
  col: number;
  msg?: string;
  ttl?: number;
  createdAt: number;
};

export type RequestKind = 'REQUEST_BUILD_AT' | 'REQUEST_SELL_TOWER' | 'REQUEST_UPGRADE_TOWER';
export type RequestPayload = {
  id: string;
  kind: RequestKind;
  from: 'player1' | 'player2';
  row?: number;
  col?: number;
  towerId?: string;
  upgradeId?: string;
  msg?: string;
  createdAt: number;
};

export type RequestResolve = { id: string; result: 'accepted' | 'declined'; by: 'player1'|'player2'; at: number };
