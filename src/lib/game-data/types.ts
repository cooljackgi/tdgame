

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
  portalCooldownUntilWave?: number;
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

export type PersistentCloudEffect = 'poison' | 'slow' | 'burn' | 'vulnerability' | 'armor_shred' | 'stun';

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
  ownerId: Player['id'];
  entrance: { row: number; col: number };
  exit:     { row: number; col: number };
  active: boolean;
  usesLeft: number;
  perEnemyCooldownMs: number;
  expiresAt: number;
};


export type SplashRingVfxType = 'magma' | 'flame' | 'ice' | 'rock' | 'thorn' | 'light' | 'dark' | 'poison' | 'steam';

export type TowerEffect = {
  type: 'slow' | 'stun' | 'burn' | 'pushback' | 'splash' | 'multishot' | 'chain' | 'pull' | 'vulnerability' | 'aura' | 'armor_shred' | 'lifesteal' | 'crit' | 'poison' | 'persistent_cloud';
  duration?: number; // ms
  potency?: number; // e.g., 0.5 for 50% slow, or damage per tick for burn
  chance?: number; // 0 to 1 for stun/crit etc.
  distance?: number; // for pushback
  radius?: number; // for splash damage or cloud radius
  vfxRadius?: number; // for visual-only radius of effects like splash
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
    r: number; // damage radius
    vfxRadius?: number; // visual radius override
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
    SNAPSHOT,           // payload: GameSessionState
    ENEMY_UPDATE,       // payload: Enemy[]
    GAME_STATE_UPDATE,  // payload: Partial<GameState> & { currentWave, gameStatus, isIntermission, waveStartCountdown }
    PLAYER_UPDATE,      // payload: Player[]
    TOWERS_UPDATE,      // payload: Record<string, PlacedTower>
    VFX_ATTACK,
    VFX_DAMAGE,
    VFX_SPLASH,
    VFX_TOWER_UPGRADE,
    VFX_TOWER_PLACE,
    AUDIO,
    PING,
    REQUEST,
    REQUEST_RESOLVE,
    WORKER_UPDATE,       // payload: Worker[]
    GHOST_UPDATE,        // payload: GhostFoundation[]
    PORTAL_UPDATE,       // payload: Portal[]
    STATS_UPDATE,        // payload: { totalKilled, totalLeaked }
}


export type GameDelta = 
    | [type: DeltaType.SNAPSHOT, payload: GameSessionState]
    | [type: DeltaType.ENEMY_UPDATE, payload: Enemy[]]
    | [type: DeltaType.GAME_STATE_UPDATE, payload: {
        lives: number;
        currentWave: number;
        gameStatus: GameStatus;
        isIntermission: boolean;
        waveStartCountdown: number;
    }]
    | [type: DeltaType.PLAYER_UPDATE, payload: Player[]]
    | [type: DeltaType.TOWERS_UPDATE, payload: Record<string, PlacedTower>]
    | [type: DeltaType.VFX_ATTACK, payload: Attack[]]
    | [type: DeltaType.VFX_DAMAGE, payload: DamageNumber[]]
    | [type: DeltaType.VFX_SPLASH, payload: SplashRing[]]
    | [type: DeltaType.VFX_TOWER_UPGRADE, payload: { towerId: string }]
    | [type: DeltaType.VFX_TOWER_PLACE, payload: { towerId: string }]
    | [type: DeltaType.AUDIO, payload: SoundEvent]
    | [type: DeltaType.PING, payload: PingPayload]
    | [type: DeltaType.REQUEST, payload: RequestPayload]
    | [type: DeltaType.REQUEST_RESOLVE, payload: RequestResolve]
    | [type: DeltaType.WORKER_UPDATE, payload: Worker[]]
    | [type: DeltaType.GHOST_UPDATE, payload: GhostFoundation[]]
    | [type: DeltaType.PORTAL_UPDATE, payload: Portal[]]
    | [type: DeltaType.STATS_UPDATE, payload: { totalKilled: number, totalLeaked: number }];


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

export type GameStatus = 'waiting' | 'playing' | 'paused' | 'gameover' | 'picking-element' | 'tutorial';
export interface GameSessionState {
  players: Player[];
  gameState: GameState;
  towersByCell: Record<string, PlacedTower>;
  enemies: Enemy[];
  currentWave: number;
  difficulty: Difficulty;
  gameStatus: GameStatus;
  currentPath: Node[];
  waveStartCountdown: number;
  isIntermission: boolean;
  workers: Worker[];
  ghosts: GhostFoundation[];
  portals: Portal[];
}

