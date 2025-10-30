

"use client";

import React, { useMemo, useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Card } from '@/components/ui/card';
import type { PlacedTower, Tower, Enemy, Node, Attack, DamageNumber, SplashRing, Element, PingPayload, RequestPayload, RequestResolve, PingKind, LifeGainVfx, SplashRingVfxType, PoisonCloud } from '@/lib/game-data/types';
import { elementProjectileColors, GRID_ROWS, GRID_COLS } from '@/lib/game-data/constants';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Target, RefreshCcw, Hand, AlertTriangle, Shield, Swords } from 'lucide-react';
import TowerComponent, { TOWER_MUZZLE_POINTS } from "@/components/game/Tower";
import EnemyComponent from "@/components/game/Enemy";
import { Button } from '@/components/ui/button';
import { findPath } from '@/lib/pathfinding';
import TowerContextMenu from './TowerContextMenu';

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
  damageNumbers: DamageNumber[];
  splashRings: SplashRing[];
  poisonClouds: PoisonCloud[];
  currentPath: Node[];
  handlePlaceTower: (row: number, col: number) => void;
  onFocusTower: (tower: PlacedTower) => void;
  cancelInteractions: () => void;
  selectedTowerToBuild: Tower | null;
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
    attacks = [], // default to empty array
    damageNumbers,
    splashRings,
    poisonClouds,
    currentPath,
    handlePlaceTower, 
    onFocusTower,
    cancelInteractions,
    selectedTowerToBuild,
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
}, ref) => {

  const groundFxCanvasRef = useRef<HTMLCanvasElement>(null);
  const airFxCanvasRef = useRef<HTMLCanvasElement>(null);
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
  
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, row: number, col: number } | null>(null);

  const touchStartRef = useRef<{ x: number, y: number, time: number } | null>(null);
  const lastTouchRef = useRef<{dist: number; cx: number; cy: number} | null>(null);

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
    const groundCanvas = groundFxCanvasRef.current;
    if (groundCanvas) handleResize(groundCanvas);
    const airCanvas = airFxCanvasRef.current;
    if (airCanvas) handleResize(airCanvas);
  }, [handleResize]);

  useEffect(() => {
    const groundCanvas = groundFxCanvasRef.current;
    const airCanvas = airFxCanvasRef.current;
    if (!groundCanvas || !airCanvas) return;

    const ro = new ResizeObserver(() => {
        handleResize(groundCanvas);
        handleResize(airCanvas);
    });
    ro.observe(groundCanvas);
    ro.observe(airCanvas);

    return () => ro.disconnect();
  }, [handleResize]);

  const renderVfx = useCallback(() => {
    animationFrameRef.current = requestAnimationFrame(renderVfx);
    const now = playerRole === 'player1' ? Date.now() : Date.now() - NETWORK_INTERP_LAG_MS;
    if (now - lastTsRef.current < fpsCapMs) return;
    lastTsRef.current = now;

    const groundCanvas = groundFxCanvasRef.current;
    const airCanvas = airFxCanvasRef.current;
    if (!groundCanvas || !airCanvas || !document.contains(groundCanvas)) return;
    
    const groundCtx = groundCanvas.getContext('2d');
    const airCtx = airCanvas.getContext('2d');
    if (!groundCtx || !airCtx) return;

    try {
        const dpr = window.devicePixelRatio || 1;
        [groundCtx, airCtx].forEach(ctx => {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); 
            ctx.scale(dpr, dpr);
            ctx.translate(panRef.current.x, panRef.current.y);
            ctx.scale(zoomRef.current, zoomRef.current);
        });
        
        // --- Ground Layer (groundCtx) ---
        for (const cloud of poisonClouds) {
            const center = gridToPx({ row: cloud.y, col: cloud.x });
            let radiusPx = cloud.radius * CELL_SIZE;
            const VISUAL_SCALE = 0.45;
            radiusPx = radiusPx * VISUAL_SCALE;

            const remaining = Math.max(0, cloud.expires - now);
            const t = cloud.duration ? Math.min(1, remaining / cloud.duration) : 0.0;

            const inner = Math.max(0, radiusPx * 0.35 * (0.7 + 0.3 * t));
            const grad = groundCtx.createRadialGradient(center.x, center.y, inner, center.x, center.y, radiusPx);
            grad.addColorStop(0, `rgba(34, 197, 94, ${0.22 * t})`);
            grad.addColorStop(1, `rgba(34, 197, 94, 0)`);

            groundCtx.save();
            groundCtx.fillStyle = grad;
            groundCtx.beginPath();
            groundCtx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
            groundCtx.fill();
            groundCtx.restore();
        }

        splashRingsPoolRef.current.forEachActive(s => {
            const t = clamp((now - s.start) / s.life, 0, 1);
            if (t >= 1) { splashRingsPoolRef.current.free(s); return; }
            
            const pos = gridToPx({ row: s.y, col: s.x });
            const maxRadius = s.r * CELL_SIZE;
            const easeOutT = 1 - (1 - t) * (1 - t);
            const tSquared = t * t;
            
            groundCtx.save();
            groundCtx.globalAlpha = 1 - tSquared;
            groundCtx.beginPath();
            groundCtx.arc(pos.x, pos.y, maxRadius * easeOutT, 0, Math.PI * 2);
            groundCtx.strokeStyle = s.color;
            groundCtx.lineWidth = 1.5 + (1-t) * 3;
            groundCtx.shadowBlur = 10;
            groundCtx.shadowColor = s.color;
            groundCtx.stroke();
            groundCtx.restore();
        });

        // --- Air Layer (airCtx) ---
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

        { // Attack processing
            const q = incomingAttacksRef.current;
            if (q.length) {
                for (const a of q) {
                    let fromPx: {x:number, y:number} | null = null;
                    const tower = towersMap.get(a.towerId);
                    if (!tower) continue;

                    if (a.isChain && a.chainSourceId) {
                        fromPx = interpolatedEnemyPositions.get(a.chainSourceId) ?? null;
                    } else {
                        const towerCenter = gridToPx(tower.position);
                        const specId = tower.specId || tower.id;
                        const towerVariant = 
                            specId.includes('-1a') || specId.includes('-2a') ? "sniper" :
                            specId.includes('-1b') || specId.includes('-2b') ? "ballista" :
                            "basic";
                        
                        const muzzle = TOWER_MUZZLE_POINTS[towerVariant];
                        const size = CELL_SIZE * 0.8;
                        const xOffset = (muzzle.x / 100) * size - (size / 2);
                        const yOffset = (muzzle.y / 100) * size - (size / 2);
                        fromPx = { x: towerCenter.x + xOffset, y: towerCenter.y + yOffset };
                    }
                    if (!fromPx) continue;
                    
                    const enemyTarget = enemiesById.get(a.targetId);
                    const toPx = enemyTarget 
                        ? getEnemyWorldPos(enemyTarget, now, enemyTarget.path || currentPath)
                        : interpolatedEnemyPositions.get(a.targetId) ?? gridToPx(a.targetPosition);

                    if (!toPx) continue;
            
                    const dist = Math.hypot(toPx.x - fromPx.x, toPx.y - fromPx.y);
                    let dynamicLife = clamp(dist * 2.6, 320, 750);
                    if (a.projectile === "beam") dynamicLife = 220;
                    if (a.projectile === "chain") dynamicLife = 250;
            
                    attacksPoolRef.current.alloc({
                        ...a,
                        _vfx: { start: now, life: dynamicLife, fromPx, toPx },
                    });
                }
                q.length = 0;
            }
        }
        { // Damage Numbers processing
            const q = incomingDmgRef.current;
            if (q.length) { 
                for (let i = 0; i < q.length; i++) {
                    const damageData = { ...q[i], targetId: q[i].targetId || ''};
                    damageNumbersPoolRef.current.alloc({ ...damageData, start: now, life: 900 }); 
                }
                q.length = 0; 
            }
        }
        { // Life Gain processing
          const q = incomingLifeGainRef.current;
          if(q.length > 0) {
            for(const vfx of q) {
              lifeGainPoolRef.current.alloc({ ...vfx, start: now, life: 1500 });
            }
            q.length = 0;
          }
        }
        
        attacksPoolRef.current.forEachActive(attack => {
            const now = Date.now();
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
            
            const easeT = t * (2 - t);
            const dx = currentToPx.x - fromPx.x;
            const dy = currentToPx.y - fromPx.y;

            if (attack.projectile === 'arrow') {
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
            } else { // BEAM or CHAIN
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

        airCtx.globalAlpha = 1;
        airCtx.shadowBlur = 0;

        damageNumbersPoolRef.current.forEachActive(dn => {
            const t = clamp((now - dn.start) / dn.life, 0, 1);
            if (t >= 1) { damageNumbersPoolRef.current.free(dn); return; }
            
            let p = interpolatedEnemyPositions.get(dn.targetId!);
            if (!p) return;

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
          airCtx.font = `bold 14px "Space Grotesk", system-ui, sans-serif`;
          airCtx.textAlign = "center";
          airCtx.fillStyle = pingColor;
          airCtx.globalAlpha = 1 - (age / ttl);
          airCtx.shadowColor = "black";
          airCtx.shadowBlur = 4;
          airCtx.fillText(pingTextMap[p.kind] || p.kind, x, y - CELL_SIZE * 0.8);
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
  }, [fpsCapMs, placedTowers, currentPath, enemies, playerRole, poisonClouds]);
  
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
  
    if (moved) return;
    
    e.stopPropagation(); 

    if (hoveredCell && selectedTowerToBuild) {
        suppressNextClickRef.current = true;
        handlePlaceTower(hoveredCell.row, hoveredCell.col);
        return;
    } else if (hoveredCell) {
        const towerAtCell = placedTowers.find(t => t.position.row === hoveredCell.row && t.position.col === hoveredCell.col);
        if (towerAtCell) {
            onFocusTower(towerAtCell);
        } else {
            cancelInteractions();
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

    if (dist < 10 && duration < 200) { // It's a tap
        e.stopPropagation();
        if (hoveredCell && selectedTowerToBuild) {
            handlePlaceTower(hoveredCell.row, hoveredCell.col);
            return; // Explicitly stop further actions
        } else if (hoveredCell) {
            const towerAtCell = placedTowers.find(t => t.position.row === hoveredCell.row && t.position.col === hoveredCell.col);
            if (towerAtCell) {
                onFocusTower(towerAtCell);
            } else {
                cancelInteractions();
            }
        } else {
            cancelInteractions();
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

  const isPlacementValid = useMemo(() => {
    return ghostTowerPath !== 'invalid';
  }, [ghostTowerPath]);

  const auraTowers = useMemo(() => 
    placedTowers.filter(t => t.effect?.type === 'aura'), 
  [placedTowers]);

  const buffedTowerIds = useMemo(() => {
    const buffedIds = new Set<string>();
    if (auraTowers.length === 0) return buffedIds;
    
    placedTowers.forEach(tower => {
      if (tower.effect?.type === 'aura') return;
      for (const auraTower of auraTowers) {
        const distSq = Math.pow(tower.position.col - auraTower.position.col, 2) + Math.pow(tower.position.row - auraTower.position.row, 2);
        if (distSq <= Math.pow(auraTower.effect!.radius!, 2)) {
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
    // Stop propagation to prevent board click handlers
    e.stopPropagation();
    
    // If we are in build mode, a click on another tower should do nothing
    if (selectedTowerToBuild) {
        return; 
    }

    // If not in build mode, focus the clicked tower
    if (Math.hypot(e.clientX - panStartRef.current.x, e.clientY - panStartRef.current.y) <= 5) {
      onFocusTower(clickedTower);
    }
  }, [onFocusTower, selectedTowerToBuild]);

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
          selectedTowerToBuild ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing",
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
            ref={groundFxCanvasRef} 
            className="absolute inset-0 pointer-events-none" 
            style={{ zIndex: 5, left: 0, top: 0, width: '100%', height: '100%' }}
        />
        <div 
          ref={worldRef}
          className="absolute inset-0"
          style={{ transformOrigin: 'top left', willChange: 'transform' }}
          onClick={(e) => {
            closeContextMenu();
            if (suppressNextClickRef.current) {
              suppressNextClickRef.current = false;
              e.stopPropagation();
              return;
            }
            if (selectedTowerToBuild) return;
            cancelInteractions();
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
            ref={airFxCanvasRef} 
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
