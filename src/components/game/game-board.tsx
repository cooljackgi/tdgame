

"use client";

import React, { useMemo, useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Card } from '@/components/ui/card';
import type { PlacedTower, Tower, Enemy, Node, Attack, DamageNumber, SplashRing, Element, PingPayload, RequestPayload, RequestResolve, PingKind, LifeGainVfx, SplashRingVfxType, PersistentCloud, Worker, GhostFoundation } from '@/lib/game-data/types';
import { elementProjectileColors, GRID_ROWS, GRID_COLS } from '@/lib/game-data/constants';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Target, RefreshCcw, Hand, AlertTriangle, Shield, Swords, Bot } from 'lucide-react';
import TowerComponent, { TOWER_MUZZLE_POINTS } from "@/components/game/Tower";
import EnemyComponent from "@/components/game/Enemy";
import { Button } from '@/components/ui/button';
import { findPath } from '@/lib/pathfinding';
import TowerContextMenu from './TowerContextMenu';
import { Progress } from '../ui/progress';

const CELL_SIZE = 64;
const ENABLE_TOOLTIPS = false;
const NETWORK_INTERP_LAG_MS = 120;
const LERP_FACTOR = 0.22; // 1.0 = hard jump, < 1.0 = smooth
const SNAP_THRESHOLD = 2.0 * CELL_SIZE;


export type GameBoardHandle = {
    resetView: () => void;
    queueAttacks: (attacks: Attack[]) => void;
    queueDamageNumbers: (damageNumbers: DamageNumber[]) => void;
    queueSplashRings: (splashRings: SplashRing[]) => void;
    queuePing: (p: PingPayload) => void;
    queueRequest: (r: RequestPayload) => void;
    resolveRequest: (res: RequestResolve) => void;
    queueLifeGainVfx: (vfx: LifeGainVfx[]) => void;
};


function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getCellPixelPosition(row: number, col: number) {
    const x = (col - 1) * CELL_SIZE;
    const y = (row - 1) * CELL_SIZE;
    return { x, y };
}

function gridToPx(node: Node) {
    const pos = getCellPixelPosition(node.row, node.col);
    return {
        x: pos.x + CELL_SIZE / 2,
        y: pos.y + CELL_SIZE / 2
    };
}

// Helper to resolve CSS variables for canvas rendering
function cssVar(name: string): string {
    if (typeof window === 'undefined') return '#ffffff'; // Fallback for SSR
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v ? `hsl(${v})` : '#ffffff';
}


export const interpolatedEnemyPositions = new Map<string, { x: number; y: number; lastUpdate: number }>();

function getEnemyWorldPos(enemy: Enemy, now: number, path: Node[]): { x: number; y: number } {
  // If the enemy is dying, lock its position to where it was last seen.
  if (enemy.deathTimestamp) {
    const lastKnownPos = interpolatedEnemyPositions.get(enemy.id);
    if (lastKnownPos) {
        return lastKnownPos;
    }
    // Fallback: If not in map, calculate its logical position, STORE IT, and return.
    const finalPos = gridToPx(enemy.position);
    interpolatedEnemyPositions.set(enemy.id, { x: finalPos.x, y: finalPos.y, lastUpdate: now });
    return finalPos;
  }
  
  let targetPos: { x: number, y: number };

  if (!enemy.path || enemy.path.length === 0) {
    targetPos = gridToPx(enemy.position);
  } else {
    const currentIndex = Math.min(enemy.pathIndex, enemy.path.length - 1);
    const a = enemy.path[currentIndex];
    const b = enemy.path[currentIndex + 1] ?? a;
    
    if (!a) {
      targetPos = gridToPx(enemy.position);
    } else {
      const slowEffect = enemy.effects.find(e => e.type === 'slow' && e.expires > Date.now());
      const speed = enemy.speed * (slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1);
      const stepMs = 1000 / Math.max(0.001, speed);

      const t = clamp((now - enemy.lastMove) / stepMs, 0, 1);
      
      const ax = gridToPx(a).x, ay = gridToPx(a).y;
      const bx = gridToPx(b).x, by = gridToPx(b).y;
      
      let logicalX = ax + (bx - ax) * t;
      let logicalY = ay + (by - ay) * t;

      // New offset logic to prevent stacking
      const idHash = (enemy.id.charCodeAt(enemy.id.length - 1) % 10) / 10 - 0.5; // -0.5 to 0.4
      const maxOffset = CELL_SIZE * 0.25;
      const persistentOffset = idHash * maxOffset;

      const dx = bx - ax;
      const dy = by - ay;
      
      // Get perpendicular vector
      let pDx = -dy;
      let pDy = dx;
      
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        pDx /= len;
        pDy /= len;
      }
      
      logicalX += pDx * persistentOffset;
      logicalY += pDy * persistentOffset;
      
      targetPos = { x: logicalX, y: logicalY };
    }
  }

  const currentPos = interpolatedEnemyPositions.get(enemy.id);
  if (!currentPos) {
    interpolatedEnemyPositions.set(enemy.id, { x: targetPos.x, y: targetPos.y, lastUpdate: now });
    return targetPos;
  }
  
  let newX: number;
  let newY: number;

  if (Math.hypot(targetPos.x - currentPos.x, targetPos.y - currentPos.y) > SNAP_THRESHOLD) {
      newX = targetPos.x;
      newY = targetPos.y;
  } else {
      newX = currentPos.x + (targetPos.x - currentPos.x) * LERP_FACTOR;
      newY = currentPos.y + (targetPos.y - currentPos.y) * LERP_FACTOR;
  }
  
  interpolatedEnemyPositions.set(enemy.id, { x: newX, y: newY, lastUpdate: now });

  return { x: newX, y: newY };
}



type GameBoardProps = {
  placedTowers: PlacedTower[];
  enemies: Enemy[];
  workers: Worker[];
  ghosts: GhostFoundation[];
  damageNumbers: DamageNumber[];
  splashRings: SplashRing[];
  persistentClouds: PersistentCloud[];
  currentPath: Node[];
  handlePlaceTower: (row: number, col: number) => void;
  onFocusTower: (tower: PlacedTower) => void;
  cancelInteractions: () => void;
  selectedTowerToBuild: Tower | null;
  portalEntrance: Node | null;
  focusedTower: PlacedTower | null;
  lastUpgradedTowerId: string | null;
  justPlacedTowerId?: string | null;
  isCoop: boolean;
  playerRole: 'player1' | 'player2' | 'spectator' | null;
  firingTowerIds: Set<string>;
  children?: React.ReactNode;
  onUpgradeTower: (upgradeId: string) => void;
  onSellTower: () => void;
  allTowers: Tower[];
  localPlayer: {id: string, resources: number, unlockedElements: Element[]} | undefined;
  attacks?: Attack[];
  onPing?: (kind: PingKind, row: number, col: number, msg?: string) => void;
  isPlacingPortalEntrance?: boolean;
};


type LiveAttack = Attack & { _vfx: { start: number; life: number; fromPx: {x:number, y:number}; toPx: {x:number,y:number} } };
type LiveDamageNumber = DamageNumber & { start: number; life: number; };
type LiveSplashRing = SplashRing & { start: number; life: number; };
type LiveLifeGain = LifeGainVfx & { start: number; life: number; };

function createPool<T extends {id: string}>(size: number) {
    const pool: (T & { _active: boolean })[] = Array.from({ length: size }, () => ({ _active: false } as any));
    let activeCount = 0;
    
    return {
        alloc(props: T): T | null {
            if (activeCount >= size) return null;
            for (let i = 0; i < size; i++) {
                if (!pool[i]._active) {
                    const obj = pool[i];
                    Object.assign(obj, props);
                    obj._active = true;
                    activeCount++;
                    return obj;
                }
            }
            return null;
        },
        free(obj: T & { _active: boolean }) {
            obj._active = false;
            activeCount--;
        },
        forEachActive(callback: (item: T & { _active: boolean }) => void) {
            for (const item of pool) {
                if (item._active) callback(item);
            }
        }
    };
}

const MemoizedTower = React.memo(function GameCell({
  tower, isFocused, isJustUpgraded, isJustBuilt, onTowerClick, cooldownProgress, variant, isFiring, isBuffed, isCoop,
}: {
  tower: PlacedTower,
  isFocused: boolean, isJustUpgraded: boolean, isJustBuilt: boolean,
  onTowerClick: (e: React.MouseEvent, tower: PlacedTower) => void,
  cooldownProgress: number,
  variant: "basic" | "sniper" | "ballista",
  isFiring: boolean,
  isBuffed: boolean,
  isCoop: boolean,
}) {
  const {x, y} = gridToPx(tower.position);
  

  const towerContent = (
    <div className="relative flex items-center justify-center h-full w-full">
      {isJustUpgraded && <div className="upgrade-ping" />}
      <TowerComponent
        element={tower.elements[0] ?? "neutral"}
        variant={variant}
        isUpgraded={!tower.isBase}
        isJustBuilt={isJustBuilt}
        isDamaged={tower.health < tower.maxHealth}
        size={CELL_SIZE * 0.8}
        cooldownProgress={cooldownProgress}
        attackSpeed={tower.attackSpeed}
        isFiring={isFiring}
        isBuffed={isBuffed}
        ownerId={tower.ownerId}
        isCoop={isCoop}
      />
    </div>
  );

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: CELL_SIZE,
        height: CELL_SIZE,
        transform: 'translate(-50%, -50%)',
      }}
      onClick={(e) => {
          e.stopPropagation();
          onTowerClick(e, tower);
      }}
      className={cn(
        "flex items-center justify-center cursor-pointer",
        isFocused && "rounded-lg bg-primary/35",
      )}
    >
      {ENABLE_TOOLTIPS ? (
        <Tooltip>
          <TooltipTrigger asChild>
            {towerContent}
          </TooltipTrigger>
          <TooltipContent>
              <p>{tower.name} ({tower.health}/{tower.maxHealth})</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        <div title={`${tower.name} (${tower.health}/${tower.maxHealth})`}>
          {towerContent}
        </div>
      )}
    </div>
  );
});

const pingTextMap: Record<PingKind, string> = {
  attention: 'Achtung!',
  defend: 'Verteidigen!',
  attack: 'Angriff!',
  build: 'Hier bauen!',
  sell: 'Verkaufen?',
};

const GameBoard = forwardRef<GameBoardHandle, GameBoardProps>(({ 
    placedTowers, 
    enemies, 
    workers,
    ghosts,
    attacks = [], // default to empty array
    damageNumbers,
    splashRings,
    persistentClouds,
    currentPath,
    handlePlaceTower, 
    onFocusTower,
    cancelInteractions,
    selectedTowerToBuild,
    portalEntrance,
    focusedTower, 
    lastUpgradedTowerId,
    justPlacedTowerId,
    isCoop,
    playerRole,
    firingTowerIds,
    children,
    onUpgradeTower,
    onSellTower,
    allTowers,
    localPlayer,
    onPing,
    isPlacingPortalEntrance = false,
}, ref) => {

  const vfxCanvasRef = useRef<HTMLCanvasElement>(null);
  const groundVfxCanvasRef = useRef<HTMLCanvasElement>(null); // New canvas for ground effects
  const animationFrameRef = useRef<number>();
  
  const incomingAttacksRef = useRef<Attack[]>([]);
  const incomingRingsRef = useRef<SplashRing[]>([]);
  const incomingDmgRef = useRef<DamageNumber[]>([]);
  const incomingLifeGainRef = useRef<LifeGainVfx[]>([]);

  const attacksPoolRef = useRef(createPool<LiveAttack>(150));
  const splashRingsPoolRef = useRef(createPool<LiveSplashRing>(60));
  const damageNumbersPoolRef = useRef(createPool<LiveDamageNumber>(100));
  const lifeGainPoolRef = useRef(createPool<LiveLifeGain>(10));
  
  const pingsRef = useRef<Map<string, PingPayload>>(new Map());
  const requestsRef = useRef<Map<string, RequestPayload>>(new Map());

  const [hoveredCell, setHoveredCell] = useState<Node|null>(null);

  const towerCooldownsRef = useRef(new Map<string, number>());
  
  const boardDimensions = useMemo(() => {
    const boardWidth = GRID_COLS * CELL_SIZE;
    const boardHeight = GRID_ROWS * CELL_SIZE;
    return { boardWidth, boardHeight };
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const hoverOverlayRef = useRef<HTMLDivElement>(null);
  const panRef = useRef({ x: -CELL_SIZE * 1.5, y: -CELL_SIZE * 1.5 });
  const zoomRef = useRef(0.95);
  const transformApplyRef = useRef<number>();

  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const isPanningRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const lastClickTimeRef = useRef(0);
  
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, row: number, col: number } | null>(null);

  const touchStartRef = useRef<{ x: number, y: number, time: number } | null>(null);
  const lastTouchRef = useRef<{dist: number; cx: number; cy: number} | null>(null);
  const lastTapTimeRef = useRef(0);

  const applyTransform = useCallback(() => {
      const el = worldRef.current;
      if (!el) return;
      el.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${zoomRef.current})`;
  }, []);

  const scheduleApplyTransform = useCallback(() => {
      if (transformApplyRef.current) return;
      transformApplyRef.current = requestAnimationFrame(() => {
        transformApplyRef.current = undefined;
        applyTransform();
      });
  }, [applyTransform]);

  const internalResetView = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const { boardWidth, boardHeight } = boardDimensions;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
    const targetZoom = Math.min(containerWidth / boardWidth, containerHeight / boardHeight) * 0.9;
    
    panRef.current = {
      x: (containerWidth - boardWidth * targetZoom) / 2,
      y: (containerHeight - boardHeight * targetZoom) / 2,
    }
    zoomRef.current = targetZoom;
    
    scheduleApplyTransform();
  }, [boardDimensions, scheduleApplyTransform]);

  useImperativeHandle(ref, () => ({
    resetView: internalResetView,
    queueAttacks: (attacksToQueue) => {
        incomingAttacksRef.current.push(...attacksToQueue);
    },
    queueDamageNumbers: (damageNumbersToQueue) => {
        incomingDmgRef.current.push(...damageNumbersToQueue);
    },
    queueSplashRings: (splashRingsToQueue) => {
        incomingRingsRef.current.push(...splashRingsToQueue);
    },
    queuePing: (p) => { pingsRef.current.set(p.id, p); setTimeout(() => pingsRef.current.delete(p.id), p.ttl ?? 4000); },
    queueRequest: (r) => { requestsRef.current.set(r.id, r); },
    resolveRequest: (res) => { requestsRef.current.delete(res.id); /* optional: kleinen „✔/✖“-Pop zeigen */ },
    queueLifeGainVfx: (vfx) => { incomingLifeGainRef.current.push(...vfx); },
  }));

  useEffect(() => {
    internalResetView();
    window.addEventListener('resize', internalResetView);
    return () => window.removeEventListener('resize', internalResetView);
  }, [internalResetView]);

  useEffect(() => {
    incomingAttacksRef.current.push(...(attacks || []));
  }, [attacks]);

  useEffect(() => {
    incomingRingsRef.current.push(...splashRings);
  }, [splashRings]);
  
  useEffect(() => {
    incomingDmgRef.current.push(...damageNumbers);
  }, [damageNumbers]);

  const lastTsRef = useRef(0);
  const fpsCapMs = 1000 / 60; // Cap at 60 FPS

  const handleResize = useCallback((canvas: HTMLCanvasElement) => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      const MAX_TEX = 8192;
      const w = Math.min(MAX_TEX, Math.max(1, Math.round(width * dpr)));
      const h = Math.min(MAX_TEX, Math.max(1, Math.round(height * dpr)));

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        return true;
      }
      return false;
  }, []);

  useEffect(() => {
    const airCanvas = vfxCanvasRef.current;
    const groundCanvas = groundVfxCanvasRef.current;
    if (airCanvas) handleResize(airCanvas);
    if (groundCanvas) handleResize(groundCanvas);
  }, [handleResize]);

  useEffect(() => {
    const airCanvas = vfxCanvasRef.current;
    const groundCanvas = groundVfxCanvasRef.current;
    if (!airCanvas || !groundCanvas) return;

    const ro = new ResizeObserver(() => {
        handleResize(airCanvas);
        handleResize(groundCanvas);
    });
    ro.observe(airCanvas); // Observing one is enough as they have same dimensions

    return () => ro.disconnect();
  }, [handleResize]);

  const renderVfx = useCallback(() => {
    animationFrameRef.current = requestAnimationFrame(renderVfx);
    const now = playerRole === 'player1' ? Date.now() : Date.now() - NETWORK_INTERP_LAG_MS;
    if (now - lastTsRef.current < fpsCapMs) return;
    lastTsRef.current = now;

    const airCanvas = vfxCanvasRef.current;
    const groundCanvas = groundVfxCanvasRef.current;
    if (!airCanvas || !groundCanvas || !document.contains(airCanvas)) return;
    
    const airCtx = airCanvas.getContext('2d');
    const groundCtx = groundCanvas.getContext('2d');
    if (!airCtx || !groundCtx) return;

    try {
        const dpr = window.devicePixelRatio || 1;
        const canvases = [{ctx: airCtx, canvas: airCanvas}, {ctx: groundCtx, canvas: groundCanvas}];

        for (const { ctx, canvas } of canvases) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height); 
            ctx.scale(dpr, dpr);
            ctx.translate(panRef.current.x, panRef.current.y);
            ctx.scale(zoomRef.current, zoomRef.current);
        }
        
        // --- GROUND EFFECTS ---
        for (const cloud of persistentClouds) {
          const center = gridToPx({row: cloud.y, col: cloud.x});
          const radiusPx = cloud.radius * CELL_SIZE;

          const remaining = Math.max(0, cloud.expires - now);
          const fadeT = cloud.duration ? Math.min(1, remaining / cloud.duration) : 0.0;
          
          groundCtx.save();

          if (cloud.effectType === 'burn') {
            const easeOutT = 1 - fadeT * fadeT;
            const bubbleCount = 12;
            const baseAngle = cloud.id.charCodeAt(0) % 360;

            for (let i = 0; i < bubbleCount; i++) {
                const angle = baseAngle + (i * 360/bubbleCount) + (easeOutT * 25) + (now * 0.03 * (i % 5 + 1));
                const rad = angle * Math.PI / 180;
                const dist = radiusPx * Math.pow(Math.random(), 1.5);
                const size = radiusPx * 0.15 * (1 - fadeT) * (0.5 + Math.sin(i + now * 0.003) * 0.5);
                if (size > 1) {
                  groundCtx.fillStyle = `hsla(30, 100%, ${50 + Math.random() * 15}%, ${0.6 * fadeT})`;
                  groundCtx.beginPath();
                  groundCtx.arc(center.x + Math.cos(rad) * dist, center.y + Math.sin(rad) * dist, size, 0, Math.PI * 2);
                  groundCtx.fill();
                }
            }

          } else if (cloud.effectType === 'slow') {
              const inner = Math.max(0, radiusPx * 0.35 * (0.7 + 0.3 * fadeT));
              const grad = groundCtx.createRadialGradient(center.x, center.y, inner, center.x, center.y, radiusPx);
              grad.addColorStop(0, `rgba(56, 189, 248, ${0.12 * fadeT})`);
              grad.addColorStop(1, `rgba(56, 189, 248, 0)`);
              
              groundCtx.fillStyle = grad;
              groundCtx.beginPath();
              groundCtx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
              groundCtx.fill();
          } else { // poison
              const easeOutT = 1 - fadeT * fadeT;
              const bubbleCount = 15;
              const baseAngle = cloud.id.charCodeAt(0) % 360;

              for (let i = 0; i < bubbleCount; i++) {
                  const angle = baseAngle + (i * 360/bubbleCount) + (easeOutT * 20) + (now * 0.01 * (i % 5 + 1));
                  const rad = angle * Math.PI / 180;
                  const dist = radiusPx * Math.pow(easeOutT, 0.7) * (0.4 + ((i*3)%7)/7 * 0.6);
                  const size = radiusPx * 0.1 * fadeT * (0.5 + Math.sin(i + now * 0.002) * 0.5);

                  if (size > 0.5) {
                    groundCtx.fillStyle = `hsla(140, 80%, 40%, ${0.5 * fadeT})`;
                    groundCtx.beginPath();
                    groundCtx.arc(center.x + Math.cos(rad) * dist, center.y + Math.sin(rad) * dist, size, 0, Math.PI * 2);
                    groundCtx.fill();
                  }
              }
          }
          groundCtx.restore();
        }

        const currentEnemyIds = new Set(enemies.map(e => e.id));
        for (const id of interpolatedEnemyPositions.keys()) {
            if (!currentEnemyIds.has(id)) {
                interpolatedEnemyPositions.delete(id);
            }
        }
        
        const enemiesById = new Map(enemies.map(e => [e.id, e]));
        for (const enemy of enemies) {
            getEnemyWorldPos(enemy, now, enemy.path || currentPath);
        }
        
        const towersMap = new Map(placedTowers.map(t => [t.id, t]));

        if (incomingAttacksRef.current.length) {
            const q = incomingAttacksRef.current;
            for (const a of q) {
                const enemyTarget = enemiesById.get(a.targetId);
                let fromPx: {x:number, y:number} | null = null;
                const tower = towersMap.get(a.towerId);
                if (!tower) continue;
                if (a.isChain && a.chainSourceId) {
                    fromPx = interpolatedEnemyPositions.get(a.chainSourceId) ?? null;
                } else {
                    const towerCenter = gridToPx(tower.position);
                    const specId = tower.specId || tower.id;
                    const towerVariant = specId.includes('-1a') || specId.includes('-2a') ? "sniper" : specId.includes('-1b') || specId.includes('-2b') ? "ballista" : "basic";
                    const muzzle = TOWER_MUZZLE_POINTS[towerVariant];
                    const size = CELL_SIZE * 0.8;
                    const xOffset = (muzzle.x / 100) * size - (size / 2);
                    const yOffset = (muzzle.y / 100) * size - (size / 2);
                    fromPx = { x: towerCenter.x + xOffset, y: towerCenter.y + yOffset };
                }
                if (!fromPx) continue;
                const toPx = enemyTarget ? getEnemyWorldPos(enemyTarget, now, enemyTarget.path || currentPath) : interpolatedEnemyPositions.get(a.targetId) ?? gridToPx(a.targetPosition);
                if (!toPx) continue;
                const dist = Math.hypot(toPx.x - fromPx.x, toPx.y - fromPx.y);
                let dynamicLife = clamp(dist * 2.6, 320, 750);
                if (a.projectile === "beam") dynamicLife = 220;
                if (a.projectile === "chain") dynamicLife = 250;
                attacksPoolRef.current.alloc({ ...a, _vfx: { start: now, life: dynamicLife, fromPx, toPx }});
            }
            q.length = 0;
        }

        if (incomingRingsRef.current.length) { 
            const q = incomingRingsRef.current;
            for (let i = 0; i < q.length; i++) {
                splashRingsPoolRef.current.alloc({ ...q[i], start: now, life: 600 }); 
            }
            q.length = 0; 
        }

        if (incomingDmgRef.current.length) {
            const q = incomingDmgRef.current;
            for (let i = 0; i < q.length; i++) {
                const damageData = { ...q[i], targetId: q[i].targetId || ''};
                damageNumbersPoolRef.current.alloc({ ...damageData, start: now, life: 900 }); 
            }
            q.length = 0; 
        }

        if(incomingLifeGainRef.current.length > 0) {
          const q = incomingLifeGainRef.current;
          for(const vfx of q) {
            lifeGainPoolRef.current.alloc({ ...vfx, start: now, life: 1500 });
          }
          q.length = 0;
        }
        
        // --- AIR EFFECTS ---
        attacksPoolRef.current.forEachActive(attack => {
            const {fromPx, life} = attack._vfx;
            let { start, toPx } = attack._vfx;
            const liveTarget = enemiesById.get(attack.targetId);
            const currentToPx = liveTarget ? getEnemyWorldPos(liveTarget, now, liveTarget.path || currentPath) : toPx;
            const t = clamp((now - start) / life, 0, 1);
            if (t >= 1) { attacksPoolRef.current.free(attack); return; }

            airCtx.save();
            const primaryElement = attack.elements?.[0] ?? 'neutral';
            const baseColor = elementProjectileColors[primaryElement] ?? '#9ca3af';
            airCtx.shadowBlur = 8;
            airCtx.shadowColor = baseColor;
            
            if (attack.projectile === 'arrow') {
                const easeT = t * (2 - t);
                const dx = currentToPx.x - fromPx.x;
                const dy = currentToPx.y - fromPx.y;
                const headX = fromPx.x + dx * easeT;
                const headY = fromPx.y + dy * easeT;
                const angle = Math.atan2(dy, dx);
                const length = 14;
                airCtx.strokeStyle = baseColor;
                airCtx.lineWidth = 3;
                airCtx.globalAlpha = 1 - t*t;
                airCtx.beginPath();
                airCtx.moveTo(headX, headY);
                airCtx.lineTo(headX - length * Math.cos(angle), headY - length * Math.sin(angle));
                airCtx.stroke();
            } else if (attack.projectile === 'chain') {
                const dx = currentToPx.x - fromPx.x;
                const dy = currentToPx.y - fromPx.y;
                const segments = 5;
                const randomness = 15;
                airCtx.lineWidth = 3.5;
                airCtx.globalAlpha = (1 - t*t);
                airCtx.strokeStyle = baseColor;
                airCtx.shadowBlur = 12;
                airCtx.beginPath();
                airCtx.moveTo(fromPx.x, fromPx.y);
                for (let i = 1; i < segments; i++) {
                    const progress = i / segments;
                    const currentX = fromPx.x + dx * progress;
                    const currentY = fromPx.y + dy * progress;
                    airCtx.lineTo(currentX + (Math.random() - 0.5) * randomness, currentY + (Math.random() - 0.5) * randomness);
                }
                airCtx.lineTo(currentToPx.x, currentToPx.y);
                airCtx.stroke();
            } else { // BEAM
                const easeT = t * (2-t);
                const dx = currentToPx.x - fromPx.x;
                const dy = currentToPx.y - fromPx.y;
                const headX = fromPx.x + dx * easeT;
                const headY = fromPx.y + dy * easeT;
                const tailT = Math.max(0, easeT - 0.15);
                const tailX = fromPx.x + dx * tailT;
                const tailY = fromPx.y + dy * tailT;
                airCtx.strokeStyle = baseColor;
                airCtx.lineWidth = 3;
                airCtx.globalAlpha = (1 - t*t);
                airCtx.beginPath();
                airCtx.moveTo(headX, headY);
                airCtx.lineTo(tailX, tailY);
                airCtx.stroke();
                if (attack.projectile === "beam") {
                    airCtx.fillStyle = '#ffffff';
                    airCtx.shadowColor = '#ffffff';
                    airCtx.shadowBlur = 12;
                    airCtx.beginPath();
                    airCtx.arc(headX, headY, 2.5, 0, Math.PI * 2);
                    airCtx.fill();
                }
            }
            airCtx.restore();
        });

        splashRingsPoolRef.current.forEachActive(s => {
            const t = clamp((now - s.start) / s.life, 0, 1);
            if (t >= 1) { splashRingsPoolRef.current.free(s); return; }
            
            const pos = gridToPx({ row: s.y, col: s.x });
            const maxRadius = s.r * CELL_SIZE;
            const easeOutT = 1 - (1 - t) * (1 - t);
            const tSquared = t * t;
            const tRoot = Math.sqrt(t);
            const baseAngle = s.id.charCodeAt(0) % 360; 
        
            groundCtx.save();
            groundCtx.globalAlpha = 1 - tSquared;
        
            switch(s.vfxType) {
                case 'magma':
                case 'flame': {
                    const cracks = s.vfxType === 'magma' ? 5 : 7;
                    for (let i = 0; i < cracks; i++) {
                        const angle = baseAngle + (i * (360 / cracks)) + (Math.sin(t * Math.PI * 2) * 10);
                        const rad = angle * Math.PI / 180;
                        const len = maxRadius * (0.7 + Math.random() * 0.3) * easeOutT;
                        groundCtx.beginPath();
                        groundCtx.moveTo(pos.x, pos.y);
                        groundCtx.lineTo(pos.x + Math.cos(rad) * len, pos.y + Math.sin(rad) * len);
                        groundCtx.strokeStyle = `hsla(30, 100%, ${60 - t * 20}%, ${1 - tSquared})`;
                        groundCtx.lineWidth = 2 + (1 - t) * (s.vfxType === 'magma' ? 3 : 2);
                        groundCtx.stroke();
                    }
                    if (s.vfxType === 'magma') {
                        const particles = 8;
                        for (let i = 0; i < particles; i++) {
                            const angle = (s.id.charCodeAt(i % s.id.length) / 255) * 360 + (i * (360 / particles));
                            const rad = angle * Math.PI / 180;
                            const dist = maxRadius * easeOutT * (0.5 + (i % 2) * 0.4);
                            const size = 3 * (1 - t);
                            groundCtx.fillStyle = `hsla(35, 100%, ${60 - t * 15}%, ${1 - tSquared * 0.5})`;
                            groundCtx.beginPath();
                            groundCtx.arc(pos.x + Math.cos(rad) * dist, pos.y + Math.sin(rad) * dist, size, 0, Math.PI * 2);
                            groundCtx.fill();
                        }
                    }
                    break;
                }
                case 'ice': {
                    const shards = 8;
                    for (let i = 0; i < shards; i++) {
                        const angle = baseAngle + (i * (360 / shards));
                        const rad = angle * Math.PI / 180;
                        const len = maxRadius * (0.5 + tRoot * 0.5);
                        const shardSize = 15 * (1-t);
                        groundCtx.beginPath();
                        groundCtx.moveTo(pos.x + Math.cos(rad) * (len - shardSize), pos.y + Math.sin(rad) * (len - shardSize));
                        groundCtx.lineTo(pos.x + Math.cos(rad) * len, pos.y + Math.sin(rad) * len);
                        groundCtx.strokeStyle = `hsla(200, 100%, ${70 - t * 20}%, ${1 - tSquared})`;
                        groundCtx.lineWidth = 3 + (1 - t) * 3;
                        groundCtx.stroke();
                    }
                    break;
                }
                case 'rock': {
                    const fragments = 8;
                    for (let i = 0; i < fragments; i++) {
                        const angle = baseAngle + (s.id.charCodeAt(i % s.id.length) / 255) * 360 + (i * (360 / fragments));
                        const rad = angle * Math.PI / 180;
                        const dist = maxRadius * t * (0.8 + Math.random() * 0.4);
                        const particleSize = 6 * (1 - t);
                        groundCtx.save();
                        groundCtx.translate(pos.x + Math.cos(rad) * dist, pos.y + Math.sin(rad) * dist);
                        groundCtx.rotate(angle * Math.PI / 180);
                        groundCtx.fillStyle = `hsla(25, 60%, ${50 - t * 20}%, ${1 - tSquared})`;
                        groundCtx.beginPath();
                        groundCtx.moveTo(0, -particleSize);
                        groundCtx.lineTo(particleSize, particleSize);
                        groundCtx.lineTo(-particleSize, particleSize);
                        groundCtx.closePath();
                        groundCtx.fill();
                        groundCtx.restore();
                    }
                    break;
                }
                case 'thorn': {
                    const spikes = 12;
                    for (let i = 0; i < spikes; i++) {
                        const angle = baseAngle + (i * (360 / spikes));
                        const rad = angle * Math.PI / 180;
                        const len = maxRadius * tRoot;
                        groundCtx.beginPath();
                        groundCtx.moveTo(pos.x, pos.y);
                        groundCtx.lineTo(pos.x + Math.cos(rad) * len, pos.y + Math.sin(rad) * len);
                        groundCtx.strokeStyle = `hsla(140, 80%, ${50 - t * 20}%, ${1 - tSquared})`;
                        groundCtx.lineWidth = 2;
                        groundCtx.stroke();
                    }
                    break;
                }
                case 'light': {
                    groundCtx.globalCompositeOperation = 'lighter';
                    const coreRadius = maxRadius * Math.sin(t * Math.PI) * 0.5;
                    const coreGradient = groundCtx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, coreRadius);
                    coreGradient.addColorStop(0, `hsla(50, 100%, 95%, ${Math.sin(t * Math.PI)})`);
                    coreGradient.addColorStop(1, `hsla(50, 100%, 70%, 0)`);
                    groundCtx.fillStyle = coreGradient;
                    groundCtx.fillRect(pos.x - coreRadius, pos.y - coreRadius, coreRadius * 2, coreRadius * 2);
                    const glowRadius = maxRadius * easeOutT;
                    groundCtx.shadowBlur = 30;
                    groundCtx.shadowColor = s.color;
                    groundCtx.beginPath();
                    groundCtx.arc(pos.x, pos.y, glowRadius, 0, Math.PI * 2);
                    groundCtx.fillStyle = `hsla(50, 100%, 80%, ${Math.sin(t * Math.PI) * 0.8})`;
                    groundCtx.fill();
                    break;
                }
                case 'dark': {
                    const pullRadius = maxRadius * (1 - easeOutT);
                    const implosionRadius = maxRadius * (1 - t);
                    const gradient = groundCtx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, implosionRadius);
                    gradient.addColorStop(0, 'rgba(128, 0, 128, 0)');
                    gradient.addColorStop(0.8, 'rgba(128, 0, 128, 0.4)');
                    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.8)');
                    groundCtx.fillStyle = gradient;
                    groundCtx.beginPath();
                    groundCtx.arc(pos.x, pos.y, implosionRadius, 0, Math.PI*2);
                    groundCtx.fill();
                    groundCtx.shadowBlur = 15;
                    groundCtx.shadowColor = s.color;
                    groundCtx.beginPath();
                    groundCtx.arc(pos.x, pos.y, pullRadius, 0, Math.PI * 2);
                    groundCtx.strokeStyle = `hsla(270, 90%, 70%, ${1 - t})`;
                    groundCtx.lineWidth = 3;
                    groundCtx.stroke();
                    break;
                }
                default: { // Default shockwave
                    const shockwaveRadius = maxRadius * easeOutT;
                    const shockwaveAlpha = 1 - tSquared;
                    const shockwaveWidth = (2 + (1 - t) * 4);
                    groundCtx.shadowBlur = 15;
                    groundCtx.shadowColor = s.color;
                    groundCtx.beginPath();
                    groundCtx.arc(pos.x, pos.y, shockwaveRadius, 0, Math.PI * 2);
                    groundCtx.strokeStyle = s.color;
                    groundCtx.lineWidth = shockwaveWidth;
                    groundCtx.globalAlpha = shockwaveAlpha;
                    groundCtx.stroke();
                }
            }
            groundCtx.restore();
        });

        airCtx.globalAlpha = 1;
        airCtx.shadowBlur = 0;

        damageNumbersPoolRef.current.forEachActive(dn => {
            const t = clamp((now - dn.start) / dn.life, 0, 1);
            if (t >= 1) { damageNumbersPoolRef.current.free(dn); return; }
            
            let p = interpolatedEnemyPositions.get(dn.targetId!);
            if (!p) return; // Don't draw damage numbers for dead enemies

            const yOffset = dn.isCrit ? 25 : 15;
            const size = dn.isCrit ? 16 : 12;

            airCtx.font = `bold ${size}px system-ui, sans-serif`;
            airCtx.textAlign = "center";
            airCtx.globalAlpha = 1 - t;
            airCtx.fillStyle = dn.color;
            airCtx.shadowColor = 'black';
            airCtx.shadowBlur = dn.isCrit ? 4 : 2;
            airCtx.fillText(Math.round(dn.amount).toString(), p.x, p.y - yOffset - (t * 20));
        });

        lifeGainPoolRef.current.forEachActive(lg => {
            const t = clamp((now - lg.start) / lg.life, 0, 1);
            if (t >= 1) { lifeGainPoolRef.current.free(lg); return; }

            const endNodePos = gridToPx({row: GRID_ROWS, col: GRID_COLS});

            airCtx.font = `bold 16px system-ui, sans-serif`;
            airCtx.textAlign = "center";
            airCtx.globalAlpha = 1 - t;
            airCtx.fillStyle = '#22c55e'; // Green
            airCtx.shadowColor = 'black';
            airCtx.shadowBlur = 4;
            airCtx.fillText(`+${lg.amount} ❤️`, endNodePos.x, endNodePos.y - 15 - (t * 30));
        });
        
        const primaryColor = cssVar('--primary');
        const destructiveColor = cssVar('--destructive');
        
        pingsRef.current.forEach((p) => {
          const { x, y } = gridToPx({ row: p.row, col: p.col });
          const age = now - p.createdAt;
          const ttl = p.ttl ?? 4000;
          const t = Math.max(0, 1 - age/ttl);
          const pingColor = p.from === 'player1' ? primaryColor : destructiveColor;
          
          airCtx.save();
          airCtx.strokeStyle = pingColor;
          airCtx.globalAlpha = 0.25 + 0.5*t;
          airCtx.lineWidth = 3;
          airCtx.beginPath();
          airCtx.arc(x, y, CELL_SIZE * (0.6 + 0.4 * (1-t)), 0, Math.PI*2);
          airCtx.stroke();
          const text = pingTextMap[p.kind] || p.kind;
          airCtx.font = `bold 14px "Space Grotesk", system-ui, sans-serif`;
          airCtx.textAlign = "center";
          airCtx.fillStyle = pingColor;
          airCtx.globalAlpha = 1 - (age / ttl);
          airCtx.shadowColor = "black";
          airCtx.shadowBlur = 4;
          airCtx.fillText(text, x, y - CELL_SIZE * 0.8);
          airCtx.restore();
        });


        for (const tower of placedTowers) {
            if (!tower.lastAttack) continue;
            const progress = clamp((now - tower.lastAttack) / tower.attackSpeed, 0, 1);
            towerCooldownsRef.current.set(tower.id, progress);
        }

    } catch (err) {
        console.error('VFX render failed:', err);
    }
  }, [fpsCapMs, placedTowers, currentPath, enemies, playerRole, persistentClouds]);
  
   useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(renderVfx);
    return () => {
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
        }
    }
  }, [renderVfx]);

  const pathD = useMemo(() => {
    if (currentPath.length === 0) return '';
    const startPos = gridToPx({row:1, col:1});
    let pathString = `M ${startPos.x} ${startPos.y}`;
    currentPath.forEach(node => {
      const pos = gridToPx(node);
      pathString += ` L ${pos.x} ${pos.y}`;
    });
    return pathString;
  }, [currentPath]);
  
  const ghostTowerPath = useMemo(() => {
    if (!selectedTowerToBuild || !hoveredCell) return null;
    const newPath = findPath({row:1,col:1}, {row:GRID_ROWS,col:GRID_COLS}, [...placedTowers.map(t => t.position), hoveredCell], GRID_ROWS, GRID_COLS);
    if (!newPath) return 'invalid';

    const startPos = gridToPx({row:1, col:1});
    let pathString = `M ${startPos.x} ${startPos.y}`;
    newPath.forEach(node => {
      const pos = gridToPx(node);
      pathString += ` L ${pos.x} ${pos.y}`;
    });
    return pathString;
  }, [selectedTowerToBuild, hoveredCell, placedTowers]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isPanningRef.current = true;
    panStartRef.current = { x: e.clientX, y: e.clientY, panX: panRef.current.x, panY: panRef.current.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const worldX = (e.clientX - rect.left - panRef.current.x) / zoomRef.current;
    const worldY = (e.clientY - rect.top - panRef.current.y) / zoomRef.current;

    const col = Math.floor(worldX / CELL_SIZE) + 1;
    const row = Math.floor(worldY / CELL_SIZE) + 1;
    
    const cell = (row >= 1 && row <= GRID_ROWS && col >= 1 && col <= GRID_COLS) ? { row, col } : null;
    setHoveredCell(cell);

    if (!isPanningRef.current) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;

    panRef.current.x = panStartRef.current.panX + dx;
    panRef.current.y = panStartRef.current.panY + dy;
    scheduleApplyTransform();
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const moved = Math.hypot(e.clientX - panStartRef.current.x, e.clientY - panStartRef.current.y) > 5;
    isPanningRef.current = false;
  
    if (moved) {
        suppressNextClickRef.current = true; // Suppress click if it was a drag
        return;
    }
    
    // This part is for click handling
    if (hoveredCell) {
        const now = Date.now();
        if (now - lastClickTimeRef.current < 300) { // Double-click
            handlePlaceTower(hoveredCell.row, hoveredCell.col); // This will trigger a move if no tower is selected
            lastClickTimeRef.current = 0; // Reset to prevent triple-click issues
        } else { // Single-click
            if (selectedTowerToBuild || isPlacingPortalEntrance) {
                handlePlaceTower(hoveredCell.row, hoveredCell.col);
            } else {
                const towerAtCell = placedTowers.find(t => t.position.row === hoveredCell.row && t.position.col === hoveredCell.col);
                if (towerAtCell) {
                    onFocusTower(towerAtCell);
                } else {
                    cancelInteractions();
                }
            }
            lastClickTimeRef.current = now;
        }
    } else {
        cancelInteractions();
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (playerRole === 'spectator' || !onPing) {
      return;
    }

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const worldX = (e.clientX - rect.left - panRef.current.x) / zoomRef.current;
    const worldY = (e.clientY - rect.top - panRef.current.y) / zoomRef.current;

    const col = Math.floor(worldX / CELL_SIZE) + 1;
    const row = Math.floor(worldY / CELL_SIZE) + 1;

    if (row >= 1 && row <= GRID_ROWS && col >= 1 && col <= GRID_COLS) {
      setContextMenu({ x: e.clientX, y: e.clientY, row, col });
    }
  };
  
  const handleTouchStart = (e: React.TouchEvent) => {
    isPanningRef.current = false;
    lastTouchRef.current = null;
    
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };

    if (e.touches.length === 1) {
        isPanningRef.current = true;
        panStartRef.current = { x: touch.clientX, y: touch.clientY, panX: panRef.current.x, panY: panRef.current.y };
    } else if (e.touches.length === 2) {
      const [a,b] = [e.touches[0], e.touches[1]];
      const dx = a.clientX - b.clientX;
      const dy = a.clientY - b.clientY;
      const dist = Math.hypot(dx, dy);
      const cx = (a.clientX + b.clientX)/2;
      const cy = (a.clientY + b.clientY)/2;
      lastTouchRef.current = { dist, cx, cy };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (e.touches.length === 1 && isPanningRef.current) {
        const touch = e.touches[0];
        const worldX = (touch.clientX - rect.left - panRef.current.x) / zoomRef.current;
        const worldY = (touch.clientY - rect.top - panRef.current.y) / zoomRef.current;
        const col = Math.floor(worldX / CELL_SIZE) + 1;
        const row = Math.floor(worldY / CELL_SIZE) + 1;
        const cell = (row >= 1 && row <= GRID_ROWS && col >= 1 && col <= GRID_COLS) ? { row, col } : null;
        setHoveredCell(cell);

        const dx = touch.clientX - panStartRef.current.x;
        const dy = touch.clientY - panStartRef.current.y;
        panRef.current.x = panStartRef.current.panX + dx;
        panRef.current.y = panStartRef.current.panY + dy;
        scheduleApplyTransform();
    } else if (e.touches.length === 2 && lastTouchRef.current) {
        const [a,b] = [e.touches[0], e.touches[1]];
        const dx = a.clientX - b.clientX;
        const dy = a.clientY - b.clientY;
        const dist = Math.hypot(dx, dy);
        const cx = (a.clientX + b.clientX)/2;
        const cy = (a.clientY + b.clientY)/2;
        
        const mx = cx - rect.left;
        const my = cy - rect.top;
        
        const mouseWorldX = (mx - panRef.current.x) / zoomRef.current;
        const mouseWorldY = (my - panRef.current.y) / zoomRef.current;

        const zoomFactor = dist / (lastTouchRef.current.dist || dist);
        const newZoom = zoomRef.current * zoomFactor;

        zoomRef.current = clamp(newZoom, 0.6, 1.5);
        
        panRef.current.x = mx - mouseWorldX * zoomRef.current;
        panRef.current.y = my - mouseWorldY * zoomRef.current;
        
        lastTouchRef.current = { dist, cx, cy };
        scheduleApplyTransform();
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    isPanningRef.current = false;
    lastTouchRef.current = null;
    const start = touchStartRef.current;
    if (e.touches.length > 0 || !start) return; 

    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    const dist = Math.hypot(dx, dy);
    const duration = Date.now() - start.time;

    if (dist < 10) { // It's a tap or double tap
        e.stopPropagation();
        
        const now = Date.now();
        if (now - lastTapTimeRef.current < 300) { // Double-tap
            if (hoveredCell) handlePlaceTower(hoveredCell.row, hoveredCell.col); // Move worker
            lastTapTimeRef.current = 0;
        } else { // Single-tap
            if (hoveredCell) {
                if (selectedTowerToBuild || isPlacingPortalEntrance) {
                    handlePlaceTower(hoveredCell.row, hoveredCell.col);
                } else {
                    const towerAtCell = placedTowers.find(t => t.position.row === hoveredCell.row && t.position.col === hoveredCell.col);
                    if (towerAtCell) {
                        onFocusTower(towerAtCell);
                    } else {
                        cancelInteractions();
                    }
                }
            } else {
                cancelInteractions();
            }
            lastTapTimeRef.current = now;
        }
    }
    
    touchStartRef.current = null;
  };

  useEffect(() => {
    const board = containerRef.current;
    if (!board) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      
      const rect = board.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const mouseWorldX = (mx - panRef.current.x) / zoomRef.current;
      const mouseWorldY = (my - panRef.current.y) / zoomRef.current;

      const zoomFactor = 1.1;
      const newZoom = e.deltaY < 0 ? zoomRef.current * zoomFactor : zoomRef.current / zoomFactor;
      
      zoomRef.current = clamp(newZoom, 0.6, 1.5);

      panRef.current.x = mx - mouseWorldX * zoomRef.current;
      panRef.current.y = my - mouseWorldY * zoomRef.current;

      scheduleApplyTransform();
    };

    board.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      board.removeEventListener('wheel', handleWheel);
    };
  }, [scheduleApplyTransform]);


  const ghostTower = useMemo(() => {
    if (!selectedTowerToBuild || !hoveredCell) return null;
    return {
        ...selectedTowerToBuild,
        specId: selectedTowerToBuild.id,
        position: hoveredCell,
    };
  }, [selectedTowerToBuild, hoveredCell]);
  
  const portalPreview = useMemo(() => {
    if (!isPlacingPortalEntrance || !hoveredCell) return null;
    
    let text = "Eingang";
    let color = "hsl(188 85% 53%)"; // Primary color

    if (portalEntrance) { // If entrance is set, we are placing the exit
      text = "Ausgang";
      color = "hsl(271 91% 65%)"; // Dark element color
    }
    
    const pos = gridToPx(hoveredCell);
    
    return {
      x: pos.x,
      y: pos.y,
      text,
      color,
    }

  }, [isPlacingPortalEntrance, portalEntrance, hoveredCell]);

  const isPlacementValid = useMemo(() => {
    return ghostTowerPath !== 'invalid';
  }, [ghostTowerPath]);
  
  const auraTowers = useMemo(() => 
    placedTowers.filter(t => t.effects?.some(e => e.type === 'aura')), 
  [placedTowers]);

  const buffedTowerIds = useMemo(() => {
    const buffedIds = new Set<string>();
    if (auraTowers.length === 0) return buffedIds;
    
    placedTowers.forEach(tower => {
      if (tower.effects?.some(e => e.type === 'aura')) return;
      for (const auraTower of auraTowers) {
        const distSq = Math.pow(tower.position.col - auraTower.position.col, 2) + Math.pow(tower.position.row - auraTower.position.row, 2);
        if (distSq <= Math.pow(auraTower.range, 2)) {
          buffedIds.add(tower.id);
          break;
        }
      }
    });
    return buffedIds;
  }, [placedTowers, auraTowers]);
  
  const startPos = gridToPx({row:1, col:1});
  const endPos = gridToPx({row:12, col:12});

  const onTowerClick = useCallback((e: React.MouseEvent, clickedTower: PlacedTower) => {
    e.stopPropagation();
  
    // ignore if the pointer moved (drag vs. click)
    const moved =
      Math.hypot(e.clientX - panStartRef.current.x, e.clientY - panStartRef.current.y) > 5;
    if (moved) return;
  
    if (selectedTowerToBuild) {
      // exit build mode and select the tower that was tapped/clicked
      cancelInteractions(); // this should clear the "build" selection
      requestAnimationFrame(() => onFocusTower(clickedTower));
      return;
    }
  
    // normal behavior when not building
    onFocusTower(clickedTower);
  }, [cancelInteractions, onFocusTower, selectedTowerToBuild]);
  

  const handlePingSelect = (kind: PingKind) => {
    if (contextMenu && onPing) {
      onPing(kind, contextMenu.row, contextMenu.col);
    }
    closeContextMenu();
  };


  return (
    <TooltipProvider>
      <Card 
        ref={containerRef}
        className={cn(
          "absolute inset-0 z-0 overflow-hidden",
          selectedTowerToBuild || isPlacingPortalEntrance ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing",
          "border-slate-800 border"
        )}
        style={{ touchAction: 'none' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
        onMouseLeave={() => { setHoveredCell(null); }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <canvas 
            ref={groundVfxCanvasRef} 
            className="absolute inset-0 pointer-events-none" 
            style={{ zIndex: 5, left: 0, top: 0, width: '100%', height: '100%' }}
        />
        <div 
          ref={worldRef}
          className="absolute inset-0"
          style={{ transformOrigin: 'top left', willChange: 'transform' }}
          onClick={(e) => {
            if (suppressNextClickRef.current) {
                suppressNextClickRef.current = false;
                return;
            }
            // Stop propagation only if a click action is performed
            if (selectedTowerToBuild || focusedTower || isPlacingPortalEntrance || contextMenu) {
                e.stopPropagation();
            }
            closeContextMenu();
            if (!selectedTowerToBuild && !focusedTower && !isPlacingPortalEntrance) {
                cancelInteractions();
            }
          }}
        >
          {/* Layer 10: Game World (Grid, Path, Towers, Enemies) */}
          <div 
            className="absolute inset-0"
            style={{ zIndex: 10 }}
          >
            <div 
              className="relative"
              style={{ width: boardDimensions.boardWidth, height: boardDimensions.boardHeight }}
            >
              <div className="absolute inset-0" style={{
                  backgroundColor: '#0b1220',
                  backgroundImage: `
                    linear-gradient(to right, rgba(148,163,184,0.1) 1px, transparent 1px),
                    linear-gradient(to bottom, rgba(148,163,184,0.1) 1px, transparent 1px)
                  `,
                  backgroundSize: `${CELL_SIZE}px ${CELL_SIZE}px`,
              }} />
              <div className="absolute inset-0 pointer-events-none">
                  <svg width="100%" height="100%" className="overflow-visible">
                    <defs>
                      <filter id="pathGlow">
                        <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                        <feMerge>
                          <feMergeNode in="coloredBlur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    {ghostTowerPath ? (
                        <path
                            d={ghostTowerPath === 'invalid' ? '' : ghostTowerPath}
                            fill="none"
                            stroke={ghostTowerPath === 'invalid' ? 'hsl(var(--destructive))' : "hsl(142 71% 45%)"}
                            strokeWidth="3"
                            strokeDasharray="8 8"
                            strokeLinecap="round"
                        />
                    ) : (
                        <path
                            d={pathD}
                            fill="none"
                            stroke="hsl(35 91% 50%)"
                            strokeWidth="3"
                            strokeDasharray="10 5"
                            strokeLinecap="round"
                            filter="url(#pathGlow)"
                            className="opacity-70"
                        >
                          <animate
                            attributeName="stroke-dashoffset"
                            from="15"
                            to="0"
                            dur="0.5s"
                            repeatCount="indefinite"
                          />
                        </path>
                    )}
                  </svg>
                </div>

                <div className="absolute inset-0">
                    {enemies.map((enemy) => {
                        const pos = interpolatedEnemyPositions.get(enemy.id);
                        if (!pos) return null;
                        
                        const isStunned = enemy.effects.some(e => e.type === 'stun' && e.expires > Date.now());
                        
                        return (
                            <div
                            key={enemy.id}
                            style={{
                                position: 'absolute',
                                left: pos.x,
                                top: pos.y,
                                width: CELL_SIZE,
                                height: CELL_SIZE,
                                transform: 'translate(-50%, -50%)',
                                willChange: 'left, top',
                            }}
                            className="pointer-events-none"
                            >
                            <EnemyComponent
                                type={enemy.type}
                                wasHit={enemy.wasHit}
                                isDamaged={enemy.wasHit}
                                isStunned={isStunned}
                                health={enemy.health}
                                maxHealth={enemy.maxHealth}
                                effects={enemy.effects}
                                isDying={!!enemy.deathTimestamp}
                            />
                            </div>
                        );
                    })}
                  
                      {placedTowers.map(tower => {
                        const specId = tower.specId || tower.id;
                        const variant = 
                            specId.includes('-1a') || specId.includes('-2a') ? "sniper" :
                            specId.includes('-1b') || specId.includes('-2b') ? "ballista" :
                            "basic";
                        return (
                          <MemoizedTower
                            key={tower.id}
                            tower={tower}
                            isFocused={focusedTower?.id === tower.id}
                            isJustUpgraded={lastUpgradedTowerId === tower.id}
                            isJustBuilt={justPlacedTowerId === tower.id}
                            onTowerClick={onTowerClick}
                            cooldownProgress={towerCooldownsRef.current.get(tower.id) ?? 1}
                            variant={variant}
                            isFiring={firingTowerIds.has(tower.id)}
                            isBuffed={buffedTowerIds.has(tower.id)}
                            isCoop={isCoop}
                          />
                        )
                      })}
                      
                      {ghosts?.map(g => {
                        const {x, y} = gridToPx({row: g.row, col: g.col});
                        return (
                          <div key={g.id} style={{ position: 'absolute', left: x, top: y, width:CELL_SIZE, height:CELL_SIZE, transform: 'translate(-50%,-50%)'}}>
                            <div className="relative w-full h-full flex items-center justify-center">
                              <TowerComponent element="neutral" size={CELL_SIZE*0.8} className="opacity-30 animate-pulse"/>
                              <Progress value={g.progress*100} className="absolute bottom-0 h-1.5 w-10"/>
                            </div>
                          </div>
                        )
                      })}

                      {workers?.map(w => (
                         <div key={w.id} style={{position: 'absolute', left: w.x, top: w.y - (w.z || 0), transform: 'translate(-50%,-50%)' }}>
                            <Bot className="h-6 w-6 text-cyan-300 drop-shadow-lg animate-bounce" />
                         </div>
                      ))}
                      
                      <div className="absolute flex items-center justify-center pointer-events-auto" style={{ left: startPos.x, top: startPos.y, width: CELL_SIZE, height: CELL_SIZE, transform: 'translate(-50%, -50%)'}}>
                            <div className="relative h-10 w-10">
                                <svg className="h-full w-full absolute" viewBox="0 0 100 100">
                                <circle cx="50" cy="50" r="16" stroke="hsl(var(--primary)/0.5)" strokeWidth="2" fill="transparent" className="animate-core-glow"/>
                                <circle cx="50" cy="50" r="12" fill="hsl(var(--primary))" className="animate-core-pulse"/>
                                <circle cx="50" cy="50" r="24" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeDasharray="4 8" fill="transparent" className="animate-upgrade-ring"/>
                                </svg>
                            </div>
                      </div>
                      
                        <div
                            className="absolute flex items-center justify-center pointer-events-auto"
                            style={{ left: endPos.x, top: endPos.y, width: CELL_SIZE, height: CELL_SIZE, transform: 'translate(-50%, -50%)' }}
                        >
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex pointer-events-auto">
                                  <Target className="h-8 w-8 text-red-500 animate-ping" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent><p>Nexus</p></TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                  
                </div>
                
                {ghostTower && (
                    <div
                        className="absolute z-30 pointer-events-none opacity-60"
                        style={{
                            left: gridToPx(ghostTower.position).x,
                            top: gridToPx(ghostTower.position).y,
                            transform: `translate(-50%, -50%)`,
                        }}
                    >
                        <div
                            className={cn(
                                "absolute rounded-full",
                                isPlacementValid ? "bg-green-500/20 border-green-500" : "bg-red-500/20 border-red-500"
                            )}
                            style={{
                                width: ghostTower.range * CELL_SIZE * 2,
                                height: ghostTower.range * CELL_SIZE * 2,
                                transform: 'translate(-50%, -50%)',
                                left: '50%',
                                top: '50%',
                                borderWidth: 2,
                                borderStyle: 'dashed'
                            }}
                        />
                        <TowerComponent 
                            element={ghostTower.elements[0]} 
                            variant={(ghostTower.specId || '').includes('-1a') || (ghostTower.specId || '').endsWith('-2a') ? "sniper" : (ghostTower.specId || '').includes('-1b') || (ghostTower.specId || '').endsWith('-2b') ? "ballista" : "basic"}
                            isUpgraded={!ghostTower.isBase}
                            size={CELL_SIZE * 0.8}
                        />
                    </div>
                )}
                
                {portalPreview && (
                  <div
                    className="absolute z-30 pointer-events-none"
                    style={{ left: portalPreview.x, top: portalPreview.y, transform: `translate(-50%, -50%)` }}
                  >
                    <div
                      className="w-16 h-16 rounded-full border-2 border-dashed flex items-center justify-center animate-pulse"
                      style={{ borderColor: portalPreview.color, background: `${portalPreview.color}20` }}
                    >
                      <span className="font-bold text-xs" style={{ color: portalPreview.color }}>{portalPreview.text}</span>
                    </div>
                  </div>
                )}
                
                {portalEntrance && (
                  <div
                    className="absolute z-10 pointer-events-none"
                    style={{
                      left: gridToPx(portalEntrance).x,
                      top: gridToPx(portalEntrance).y,
                      transform: `translate(-50%, -50%)`,
                    }}
                  >
                    <div className="w-16 h-16 rounded-full bg-blue-500/30 border-2 border-dashed border-blue-400 flex items-center justify-center">
                      <span className="text-xs font-bold text-white">Eingang</span>
                    </div>
                  </div>
                )}

                {focusedTower && (
                  <>
                  <div 
                    className="absolute pointer-events-none"
                    style={{
                      left: gridToPx(focusedTower.position).x,
                      top: gridToPx(focusedTower.position).y,
                    }}
                  >
                    <div
                      className="bg-primary/10 border border-primary rounded-full animate-pulse"
                      style={{
                        width: focusedTower.range * CELL_SIZE * 2,
                        height: focusedTower.range * CELL_SIZE * 2,
                        transform: 'translate(-50%, -50%)'
                      }}
                    ></div>
                  </div>
                  <div
                      className="absolute z-30"
                      style={{
                          left: gridToPx(focusedTower.position).x,
                          top: gridToPx(focusedTower.position).y,
                          transform: `translate(-50%, calc(-50% - ${CELL_SIZE * 0.7}px))`,
                      }}
                  >
                      <TowerContextMenu
                          tower={focusedTower}
                          onUpgrade={onUpgradeTower}
                          onSell={onSellTower}
                          allTowers={allTowers}
                          localPlayer={localPlayer}
                          onClose={cancelInteractions}
                      />
                  </div>
                  </>
                )}
                {Array.from(requestsRef.current.values()).map(r => {
                  const pos = gridToPx({row: r.row!, col: r.col!});
                  return (
                    <div key={r.id}
                      style={{ position:'absolute', left: pos.x, top: pos.y, transform:'translate(-50%,-100%)', zIndex: 40 }}
                      className="pointer-events-auto"
                      onClick={(e)=> e.stopPropagation()}
                    >
                      <div className="rounded-md bg-card/90 shadow p-2 flex gap-2 items-center">
                        <span className="text-xs">
                          {r.kind === 'REQUEST_SELL_TOWER' ? 'Verkaufen?' :
                           r.kind === 'REQUEST_BUILD_AT' ? 'Hier bauen?' :
                           r.kind === 'REQUEST_UPGRADE_TOWER' ? 'Upgrade?' : 'Aktion?'}
                        </span>
                        {isCoop && playerRole === 'player1' && (
                          <>
                            <button className="btn btn-xs" onClick={()=>{
                              if (r.kind === 'REQUEST_SELL_TOWER' && r.row && r.col) {
                                // This is a simplification. A real implementation would need to find the tower at row/col
                                // and pass its ID to onSellTower. For now, this is a placeholder.
                                const towerToSell = placedTowers.find(t => t.position.row === r.row && t.position.col === r.col);
                                if (towerToSell) onFocusTower(towerToSell); // Focus it first
                                setTimeout(onSellTower, 50); // Then sell
                              } else if (r.kind === 'REQUEST_BUILD_AT' && r.row && r.col) {
                                // Build action is initiated from toolbar, this just confirms location.
                              }
                              requestsRef.current.delete(r.id);
                            }}>Ja</button>
                            <button className="btn btn-xs" onClick={()=>{
                              requestsRef.current.delete(r.id);
                            }}>Nein</button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}

                <div ref={hoverOverlayRef} className="absolute transition-opacity duration-100 opacity-0 pointer-events-none border-2 border-white/25 bg-white/5" style={{width: CELL_SIZE, height: CELL_SIZE}} />
            </div>
          </div>
        </div>
        
        <canvas 
            ref={vfxCanvasRef} 
            className="absolute inset-0 pointer-events-none" 
            style={{ zIndex: 20, left: 0, top: 0, width: '100%', height: '100%' }}
        />
        
        {contextMenu && (
            <div
            style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 50 }}
            className="flex flex-col gap-1 bg-card/80 backdrop-blur-md p-1 rounded-lg border border-primary/50 shadow-lg"
            onMouseUp={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
            >
                <Button variant="ghost" className="justify-start px-2 py-1 h-auto" onClick={() => handlePingSelect('attention')}>
                    <AlertTriangle className="mr-2 h-4 w-4 text-yellow-400" /> Achtung!
                </Button>
                <Button variant="ghost" className="justify-start px-2 py-1 h-auto" onClick={() => handlePingSelect('defend')}>
                    <Shield className="mr-2 h-4 w-4 text-blue-400" /> Verteidig.
                </Button>
                <Button variant="ghost" className="justify-start px-2 py-1 h-auto" onClick={() => handlePingSelect('attack')}>
                    <Swords className="mr-2 h-4 w-4 text-red-400" /> Angriff
                </Button>
                 <Button variant="ghost" className="justify-start px-2 py-1 h-auto" onClick={() => handlePingSelect('build')}>
                    <Hand className="mr-2 h-4 w-4 text-green-400" /> Hier bauen
                </Button>
            </div>
        )}

        <div 
          className="absolute bottom-2 right-2 z-50 bg-card/50 backdrop-blur-sm p-1 rounded-md flex items-center gap-1"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={internalResetView}>
            <RefreshCcw className="h-4 w-4" />
          </Button>
        </div>
        {children}
      </Card>
    </TooltipProvider>
  );
});

GameBoard.displayName = 'GameBoard';
export default GameBoard;
