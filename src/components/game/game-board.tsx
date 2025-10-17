

"use client";

import React, { useMemo, useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Card } from '@/components/ui/card';
import type { PlacedTower, Tower, Enemy, Node, Attack, DamageNumber, SplashRing, Element } from '@/lib/game-data/types';
import { elementProjectileColors, GRID_ROWS, GRID_COLS } from '@/lib/game-data/constants';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Target, RefreshCcw } from 'lucide-react';
import TowerComponent, { TOWER_MUZZLE_POINTS } from "@/components/game/Tower";
import EnemyComponent from "@/components/game/Enemy";
import { Button } from '@/components/ui/button';
import { findPath } from '@/lib/pathfinding';
import TowerContextMenu from './TowerContextMenu';

const CELL_SIZE = 64;

const ENABLE_TOOLTIPS = false;


export type GameBoardHandle = { resetView: () => void, queueAttacks: (attacks: Attack[]) => void };

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

export const interpolatedEnemyPositions = new Map<string, { x: number; y: number; lastUpdate: number }>();
const LERP_FACTOR = 1.0;

function getEnemyWorldPos(enemy: Enemy, now: number, path: Node[]): { x: number; y: number } {
  let targetPos: { x: number, y: number };

  if (path.length === 0) {
    targetPos = gridToPx(enemy.position);
  } else {
    const currentIndex = Math.min(enemy.pathIndex, path.length - 1);
    const a = path[currentIndex];
    const b = path[currentIndex + 1] ?? a;
    
    if (!a) {
      targetPos = gridToPx(enemy.position);
    } else {
      const slowEffect = enemy.effects.find(e => e.type === 'slow' && e.expires > now);
      const speed = enemy.speed * (slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1);
      const stepMs = 1000 / Math.max(0.001, speed);

      const t = clamp((now - enemy.lastMove) / stepMs, 0, 1);
      
      const ax = gridToPx(a).x, ay = gridToPx(a).y;
      const bx = gridToPx(b).x, by = gridToPx(b).y;
      
      let xOffset = 0;
      let yOffset = 0;
      const timeFactor = now / 1000;
      const idFactor = (enemy.id.charCodeAt(enemy.id.length - 1) % 10) / 10;
      
      switch(enemy.movementPattern) {
          case 'wobble':
              yOffset = Math.sin(timeFactor * (2.5 + idFactor * 2) + idFactor * Math.PI * 2) * (0.5 + idFactor * 0.5);
              break;
          case 'zigzag':
              yOffset = (Math.abs((timeFactor * (4 + idFactor * 2) + idFactor * 2) % 2 - 1) * 2 - 1) * (4 + idFactor * 3);
              break;
          default:
              break;
      }

      targetPos = { x: ax + (bx - ax) * t + xOffset, y: ay + (by - ay) * t + yOffset };
    }
  }

  const currentPos = interpolatedEnemyPositions.get(enemy.id);
  if (!currentPos) {
    interpolatedEnemyPositions.set(enemy.id, { x: targetPos.x, y: targetPos.y, lastUpdate: now });
    return targetPos;
  }

  const newX = currentPos.x + (targetPos.x - currentPos.x) * LERP_FACTOR;
  const newY = currentPos.y + (targetPos.y - currentPos.y) * LERP_FACTOR;
  
  interpolatedEnemyPositions.set(enemy.id, { x: newX, y: newY, lastUpdate: now });

  return { x: newX, y: newY };
}



type GameBoardProps = {
  placedTowers: PlacedTower[];
  enemies: Enemy[];
  attacks: Attack[];
  damageNumbers: DamageNumber[];
  splashRings: SplashRing[];
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
  localPlayer: {id: string, resources: number, unlockedElements: Element[]} | undefined
};


type LiveAttack = Attack & { _vfx: { start: number; life: number; fromPx: {x:number, y:number}; toPx: {x:number,y:number} } };
type LiveDamageNumber = DamageNumber & { start: number; life: number; };
type LiveSplashRing = SplashRing & { start: number; life: number; };

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


function drawProjectile(ctx: CanvasRenderingContext2D, a: LiveAttack, t: number) {
    let fromPos = a._vfx.fromPx;
    let toPos = a._vfx.toPx;

    const primaryElement = a.elements?.[0] ?? 'neutral';
    const baseColor = elementProjectileColors[primaryElement] ?? '#9ca3af';
    const easeT = t * (2 - t);
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;

    ctx.save();
    ctx.shadowBlur = 8;
    ctx.shadowColor = baseColor;
    
    if (a.projectile === 'arrow') {
        const headX = fromPos.x + dx * easeT;
        const headY = fromPos.y + dy * easeT;
        
        const angle = Math.atan2(dy, dx);
        const length = 14;

        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 1 - t*t;
        
        ctx.beginPath();
        ctx.moveTo(headX, headY);
        ctx.lineTo(headX - length * Math.cos(angle), headY - length * Math.sin(angle));
        ctx.stroke();

    } else {
        const headX = fromPos.x + dx * t;
        const headY = fromPos.y + dy * t;
        const tailT = Math.max(0, t - 0.15);
        const tailX = fromPos.x + dx * tailT;
        const tailY = fromPos.y + dy * tailT;
        
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = a.projectile === 'chain' ? 2 : 3;
        ctx.globalAlpha = (1 - t*t);
        
        ctx.beginPath();
        ctx.moveTo(headX, headY);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();

        if (a.projectile === 'beam') {
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(headX, headY, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    
    ctx.restore();
}


function drawSplashRing(ctx: CanvasRenderingContext2D, s: LiveSplashRing, t: number) {
  const pos = gridToPx({ row: s.y, col: s.x });
  const radius = s.r * CELL_SIZE;
  const easeT = t * (2-t);
  const alpha = 1 - t;
  
  ctx.save();
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, radius * easeT, 0, Math.PI * 2);
  ctx.strokeStyle = s.color || '#ffffff';
  ctx.lineWidth = 3 * (1-t);
  ctx.globalAlpha = alpha;
  ctx.stroke();
  ctx.restore();
}

const MemoizedTower = React.memo(function GameCell({
  tower, isFocused, isJustUpgraded, isJustBuilt, onTowerClick, cooldownProgress, variant, isFiring, isBuffed
}: {
  tower: PlacedTower,
  isFocused: boolean, isJustUpgraded: boolean, isJustBuilt: boolean,
  onTowerClick: (e: React.MouseEvent, tower: PlacedTower) => void,
  cooldownProgress: number,
  variant: "basic" | "sniper" | "ballista",
  isFiring: boolean,
  isBuffed: boolean,
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


const GameBoard = forwardRef<GameBoardHandle, GameBoardProps>(({ 
    placedTowers, 
    enemies, 
    attacks, 
    damageNumbers,
    splashRings,
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
}, ref) => {

  const fxCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();
  
  const incomingAttacksRef = useRef<Attack[]>([]);
  const incomingRingsRef = useRef<SplashRing[]>([]);
  const incomingDmgRef = useRef<DamageNumber[]>([]);

  const attacksPoolRef = useRef(createPool<LiveAttack>(150));
  const splashRingsPoolRef = useRef(createPool<LiveSplashRing>(60));
  const damageNumbersPoolRef = useRef(createPool<LiveDamageNumber>(100));

  const [hoveredCell, setHoveredCell] = useState<Node|null>(null);

  const towerCooldownsRef = useRef(new Map<string, number>());
  const lastKnownEnemyPosRef = useRef<Map<string, { x: number; y: number; expires: number }>>(new Map());
  
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
  }));

  useEffect(() => {
    internalResetView();
    window.addEventListener('resize', internalResetView);
    return () => window.removeEventListener('resize', internalResetView);
  }, [internalResetView]);

  useEffect(() => {
    incomingAttacksRef.current.push(...attacks);
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
    const canvas = fxCanvasRef.current;
    if (canvas) handleResize(canvas);
  }, [handleResize]);

  useEffect(() => {
    const canvas = fxCanvasRef.current;
    if (!canvas) return;

    const ro = new ResizeObserver(() => {
        handleResize(canvas);
    });
    ro.observe(canvas);

    return () => ro.disconnect();
  }, [handleResize]);


 const renderVfx = useCallback(() => {
    animationFrameRef.current = requestAnimationFrame(renderVfx);
    const now = performance.now();
    if (now - lastTsRef.current < fpsCapMs) return;
    lastTsRef.current = now;

    const canvas = fxCanvasRef.current;
    if (!canvas || !document.contains(canvas)) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    try {
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height); 
        
        ctx.scale(dpr, dpr);
        
        ctx.translate(panRef.current.x, panRef.current.y);
        ctx.scale(zoomRef.current, zoomRef.current);
        
        const currentEnemyIds = new Set(enemies.map(e => e.id));
        
        for (const id of interpolatedEnemyPositions.keys()) {
            if (!currentEnemyIds.has(id)) {
                interpolatedEnemyPositions.delete(id);
            }
        }
        
        for (const enemy of enemies) {
            const pos = getEnemyWorldPos(enemy, now, enemy.path || currentPath);
            lastKnownEnemyPosRef.current.set(enemy.id, { x: pos.x, y: pos.y, expires: now + 350 });
        }
        
        for (const [id, val] of lastKnownEnemyPosRef.current) {
            if (val.expires < now) lastKnownEnemyPosRef.current.delete(id);
        }

        {
            const q = incomingAttacksRef.current;
            if (q.length) {
                const towersMap = new Map(placedTowers.map(t => [t.id, t]));
                
                for (let i = 0; i < q.length; i++) {
                    const a = q[i];
                    const tower = towersMap.get(a.towerId);
                    if (!tower && !a.isChain) continue;
            
                    let fromPx: {x:number, y:number} | null = null;
                    if (a.isChain && a.chainSourceId) {
                        const liveSrc = interpolatedEnemyPositions.get(a.chainSourceId);
                        const lastKnownSrc = lastKnownEnemyPosRef.current.get(a.chainSourceId);
                        if (liveSrc || lastKnownSrc) fromPx = (liveSrc ?? lastKnownSrc)!;
                    } else if (tower) {
                        const towerCenter = gridToPx(tower.position);
                        const specId = tower.specId || tower.id;
                        const towerVariant = 
                            specId.includes('-1a') || specId.includes('-2a') ? "sniper" :
                            specId.includes('-1b') || specId.includes('-2b') ? "ballista" :
                            "basic";
                        
                        const muzzle = TOWER_MUZZLE_POINTS[towerVariant];
                        const xOffset = (muzzle.x / 100) * CELL_SIZE - (CELL_SIZE / 2);
                        const yOffset = (muzzle.y / 100) * CELL_SIZE - (CELL_SIZE / 2);

                        fromPx = { x: towerCenter.x + xOffset, y: towerCenter.y + yOffset };
                    }
                    if (!fromPx) continue;
                    
                    const enemyTarget = enemies.find(e => e.id === a.targetId);
                    let toPx : {x:number, y:number} | null = null;

                    if (enemyTarget) {
                        toPx = getEnemyWorldPos(enemyTarget, now, enemyTarget.path || currentPath);
                    } else {
                        const lastKnown = lastKnownEnemyPosRef.current.get(a.targetId);
                        if(lastKnown) {
                            toPx = lastKnown;
                        } else {
                            toPx = gridToPx(a.targetPosition);
                        }
                    }

                    if (!toPx) continue;
            
                    const dist = Math.hypot(toPx.x - fromPx.x, toPx.y - fromPx.y);
                    const dynamicLife =
                        a.projectile === "beam" || a.projectile === "chain"
                        ? 220
                        : clamp(dist * 2.2, 260, 650);
            
                    attacksPoolRef.current.alloc({
                        ...a,
                        _vfx: { start: now, life: dynamicLife, fromPx, toPx },
                    });
                }
                q.length = 0;
            }
        }
        {
            const q = incomingRingsRef.current;
            if (q.length) { 
                for (let i = 0; i < q.length; i++) {
                    splashRingsPoolRef.current.alloc({ ...q[i], start: now, life: 300 }); 
                }
                q.length = 0; 
            }
        }
        {
            const q = incomingDmgRef.current;
            if (q.length) { 
                for (let i = 0; i < q.length; i++) {
                    const damageData = { ...q[i], targetId: q[i].targetId || ''};
                    damageNumbersPoolRef.current.alloc({ ...damageData, start: now, life: 900 }); 
                }
                q.length = 0; 
            }
        }
        
        attacksPoolRef.current.forEachActive(attack => {
            if (!attack._vfx) return;
            const life = Math.max(1, attack._vfx.life || 1);
            const t = clamp((now - attack._vfx.start) / life, 0, 1);
            if (t >= 1) { attacksPoolRef.current.free(attack); return; }
            drawProjectile(ctx, attack, t);
        });

        splashRingsPoolRef.current.forEachActive(r => {
            const t = clamp((now - r.start) / r.life, 0, 1);
            if (t >= 1) { splashRingsPoolRef.current.free(r); return; }
            drawSplashRing(ctx, r, t);
        });

        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;

        damageNumbersPoolRef.current.forEachActive(dn => {
            const t = clamp((now - dn.start) / dn.life, 0, 1);
            if (t >= 1) { damageNumbersPoolRef.current.free(dn); return; }
            
            let p = interpolatedEnemyPositions.get(dn.targetId!);
            if (!p) {
              const lastKnown = lastKnownEnemyPosRef.current.get(dn.targetId!);
              p = lastKnown ? lastKnown : gridToPx(dn.position);
            }

            const yOffset = dn.isCrit ? 25 : 15;
            const size = dn.isCrit ? 16 : 12;

            ctx.font = `bold ${size}px system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.globalAlpha = 1 - t;
            ctx.fillStyle = dn.color;
            ctx.shadowColor = 'black';
            ctx.shadowBlur = dn.isCrit ? 4 : 2;
            ctx.fillText(Math.round(dn.amount).toString(), p.x, p.y - yOffset - (t * 20));
        });


        for (const tower of placedTowers) {
            if (!tower.lastAttack) continue;
            const progress = clamp((now - tower.lastAttack) / tower.attackSpeed, 0, 1);
            towerCooldownsRef.current.set(tower.id, progress);
        }

    } catch (err) {
        console.error('VFX render failed:', err);
    }
  }, [fpsCapMs, placedTowers, currentPath, enemies]);
  
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
    const newPath = findPath({row:1, col:1}, {row:GRID_ROWS, col:GRID_COLS}, [...placedTowers.map(t => t.position), hoveredCell], GRID_ROWS, GRID_COLS);
    if (!newPath) return 'invalid';

    const startPos = gridToPx({row:1, col:1});
    let pathString = `M ${startPos.x} ${startPos.y}`;
    newPath.forEach(node => {
      const pos = gridToPx(node);
      pathString += ` L ${pos.x} ${pos.y}`;
    });
    return pathString;
  }, [selectedTowerToBuild, hoveredCell, placedTowers]);


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
    isPanningRef.current = false;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    const moved = Math.hypot(dx, dy) > 5;
  
    if (moved) return;
    
    // This is the important change: stop the event from bubbling up to parent containers
    e.stopPropagation(); 

    if (hoveredCell && selectedTowerToBuild) {
        handlePlaceTower(hoveredCell.row, hoveredCell.col);
    } else if (hoveredCell && !selectedTowerToBuild) {
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
  
  const handleTouchStart = (e: React.TouchEvent) => {
    isPanningRef.current = false;
    lastTouchRef.current = null;
    
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: performance.now() };

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
    const duration = performance.now() - start.time;

    if (dist < 10 && duration < 200) { // It's a tap
        e.stopPropagation();
        if (hoveredCell && selectedTowerToBuild) {
            handlePlaceTower(hoveredCell.row, hoveredCell.col);
        } else if (hoveredCell && !selectedTowerToBuild) {
            const towerAtCell = placedTowers.find(t => t.position.row === hoveredCell.row && t.position.col === hoveredCell.col);
            if (towerAtCell) onFocusTower(towerAtCell);
            else cancelInteractions();
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
    if (Math.hypot(e.clientX - panStartRef.current.x, e.clientY - panStartRef.current.y) > 5) return;
    onFocusTower(clickedTower);
  }, [onFocusTower]);

  return (
    <TooltipProvider>
      <Card 
        ref={containerRef}
        className={cn(
          "w-full h-full relative overflow-hidden",
          selectedTowerToBuild ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing",
          "border-slate-800 border"
        )}
        style={{ touchAction: 'none' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { isPanningRef.current = false; setHoveredCell(null); }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div 
          ref={worldRef}
          className="absolute inset-0"
          style={{ transformOrigin: 'top left', willChange: 'transform' }}
          onClick={cancelInteractions} // Add this to cancel interactions when clicking the board background
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
                  backgroundColor: 'hsl(216 28% 12%)',
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
                        
                        const isStunned = enemy.effects.some(e => e.type === 'stun' && e.expires > performance.now());
                        
                        const isGhost = !enemies.find(e => e.id === enemy.id);

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
                                isGhost={isGhost}
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
                <div ref={hoverOverlayRef} className="absolute transition-opacity duration-100 opacity-0 pointer-events-none border-2 border-white/25 bg-white/5" style={{width: CELL_SIZE, height: CELL_SIZE}} />
            </div>
          </div>
        </div>
        
        {/* Layer 20: VFX Canvas, placed after the world div */}
        <canvas 
            ref={fxCanvasRef} 
            className="absolute inset-0 pointer-events-none" 
            style={{ zIndex: 20, left: 0, top: 0, width: '100%', height: '100%' }}
        />
        
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

    

    

