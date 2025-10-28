// src/components/explainer/TowerDemo.tsx
'use client';
import * as React from 'react';
import { useRef, useEffect, useCallback, useState } from 'react';
import type { Tower, SplashRing } from '@/lib/game-data/types';
import { elementProjectileColors } from '@/lib/game-data/constants';
import TowerComponent, { TOWER_MUZZLE_POINTS } from '@/components/game/Tower';
import EnemyComponent from '@/components/game/Enemy';
import { drawProjectile, drawSplashRing } from '@/components/game/vfx-renderer';

type DemoAttack = {
  id: string;
  start: number;
  duration: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  color: string;
  projectile: 'beam' | 'arrow' | 'chain';
  elements: Tower['elements'];
};

type LiveSplashRing = SplashRing & { start: number; life: number; };

type EnemyState = {
  id: string;
  health: number;
  maxHealth: number;
  isDying: boolean;
  wasHit: boolean;
};

function cooldownMsFrom(v: number): number {
  if (v <= 0) return 1000;
  if (v < 20) return v * 1000;
  return v;
}

export default function TowerDemo({ tower }: { tower: Tower }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const towerRef = useRef<HTMLDivElement>(null);
  const enemy1Ref = useRef<HTMLDivElement>(null);
  const enemy2Ref = useRef<HTMLDivElement>(null); // For chain effect
  const animationRef = useRef<number>();
  const attacks = useRef<DemoAttack[]>([]);
  const splashRings = useRef<LiveSplashRing[]>([]);
  const lastAttackTime = useRef(0);
  const lastFrameTime = useRef(performance.now());
  const [cssSize, setCssSize] = useState({ w: 100, h: 100 });
  const [cooldownProgress, setCooldownProgress] = useState(1);
  
  const [enemies, setEnemies] = useState<EnemyState[]>([
      { id: 'e1', health: 100, maxHealth: 100, isDying: false, wasHit: false },
      { id: 'e2', health: 100, maxHealth: 100, isDying: false, wasHit: false },
  ]);
  const hitTimeoutRefs = useRef<Record<string, NodeJS.Timeout>>({});


  const towerSize = 50;
  const showSecondEnemy = tower.effect?.type === 'chain';

  const getCanvasRelativeCenter = (el: HTMLElement | null): { x: number; y: number } => {
    if (!canvasRef.current || !el) return { x: 0, y: 0 };
    const cRect = canvasRef.current.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - cRect.left, y: r.top + r.height / 2 - cRect.top };
  };

  const getMuzzlePosition = (): { x: number; y: number } => {
    if (!towerRef.current) return { x: 0, y: 0 };
    const towerCenter = getCanvasRelativeCenter(towerRef.current);
    
    const specId = tower.id; // Use full ID for variant check
    const towerVariant = 
        specId.includes('sniper') ? "sniper" :
        specId.includes('ballista') ? "ballista" :
        "basic";
    
    const muzzle = TOWER_MUZZLE_POINTS[towerVariant];
    const xOffset = (muzzle.x / 100) * towerSize - (towerSize / 2);
    const yOffset = (muzzle.y / 100) * towerSize - (towerSize / 2);

    return { x: towerCenter.x + xOffset, y: towerCenter.y + yOffset };
  };

  const draw = useCallback((ctx: CanvasRenderingContext2D, now: number) => {
    const { w, h } = cssSize;
    ctx.clearRect(0, 0, w, h);

    const fromPos = getMuzzlePosition();
    const toPos = getCanvasRelativeCenter(enemy1Ref.current);
    const toPos2 = getCanvasRelativeCenter(enemy2Ref.current);
    
    const cdMs = cooldownMsFrom(tower.attackSpeed);
    const elapsed = now - lastAttackTime.current;
    const progress = Math.min(elapsed / cdMs, 1);
    setCooldownProgress(progress);
    
    const primaryEnemyIsAlive = !enemies[0].isDying;
    if (tower.damage > 0 && elapsed >= cdMs && primaryEnemyIsAlive) {
      lastAttackTime.current = now;
      const projectileType = tower.id.includes('sniper') ? 'arrow' : 'beam';
      attacks.current.push({
        id: crypto.randomUUID(),
        start: now,
        duration: 400,
        from: fromPos,
        to: toPos,
        color: elementProjectileColors[tower.elements[0] || 'neutral'],
        projectile: projectileType,
        elements: tower.elements,
      });
    }

    // Draw and manage attacks
    const remainingAttacks: DemoAttack[] = [];
    attacks.current.forEach((attack) => {
      const aElapsed = now - attack.start;
      if (aElapsed > attack.duration) {
         // Projectile hit logic
         setEnemies(prevEnemies => {
            return prevEnemies.map(enemy => {
                if (enemy.id !== 'e1' || enemy.isDying) return enemy;
                
                const newHealth = enemy.health - (tower.damage / 4); // Deal 1/4th damage per hit for demo
                if (newHealth <= 0) {
                  setTimeout(() => setEnemies(es => es.map(e => ({ ...e, health: e.maxHealth, isDying: false, wasHit: false }))), 2000);
                  return { ...enemy, health: 0, isDying: true, wasHit: true };
                }
                
                if (hitTimeoutRefs.current[enemy.id]) clearTimeout(hitTimeoutRefs.current[enemy.id]);
                hitTimeoutRefs.current[enemy.id] = setTimeout(() => setEnemies(p => p.map(e => e.id === enemy.id ? {...e, wasHit: false} : e)), 150);

                return { ...enemy, health: newHealth, wasHit: true };
            });
         });
         // Handle splash/chain on hit
         if (tower.effect?.type === 'splash' && tower.effect.radius) {
              splashRings.current.push({
                  id: crypto.randomUUID(),
                  x: toPos.x / CELL_SIZE, // needs grid coords
                  y: toPos.y / CELL_SIZE,
                  r: tower.effect.radius,
                  element: tower.elements[0] || 'neutral',
                  color: elementProjectileColors[tower.elements[0] || 'neutral'],
                  vfxType: tower.id.includes('magma') ? 'magma' : tower.id.includes('flame') ? 'flame' : tower.id.includes('ice') ? 'ice' : 'default',
                  start: now,
                  life: 600,
              } as LiveSplashRing);
         }
         if (tower.effect?.type === 'chain' && tower.effect.bounces) {
            attacks.current.push({
                id: crypto.randomUUID(),
                start: now,
                duration: 250,
                from: toPos,
                to: toPos2,
                color: elementProjectileColors[tower.elements[0] || 'neutral'],
                projectile: 'chain',
                elements: tower.elements,
            });
         }
         return; // Don't draw or keep it
      }
      
      remainingAttacks.push(attack);
      const t = aElapsed / attack.duration;
      drawProjectile(ctx, { ...attack, _vfx: { start: attack.start, life: attack.duration, fromPx: attack.from, toPx: attack.to } }, t);
    });
    attacks.current = remainingAttacks;

    // Draw and manage splash rings
    const remainingSplashes: LiveSplashRing[] = [];
    splashRings.current.forEach(splash => {
        const elapsed = now - splash.start;
        if (elapsed > splash.life) return;
        remainingSplashes.push(splash);
        const t = elapsed / splash.life;
        
        // Convert splash center back to pixels for drawing
        const splashCenterPx = { x: splash.x * CELL_SIZE, y: splash.y * CELL_SIZE };
        drawSplashRing(ctx, { ...splash, ...splashCenterPx }, t);
    });
    splashRings.current = remainingSplashes;

  }, [cssSize, tower, enemies]);

  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.scale(dpr, dpr);
    setCssSize({ w: rect.width, h: rect.height });
  }, []);

  useEffect(() => {
    handleResize();
    lastAttackTime.current = performance.now() - cooldownMsFrom(tower.attackSpeed);
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(canvas);

    return () => resizeObserver.disconnect();
  }, [handleResize, tower.attackSpeed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const loop = (now: number) => {
      if (now - lastFrameTime.current > 16) { 
        draw(ctx, now);
        lastFrameTime.current = now;
      }
      animationRef.current = requestAnimationFrame(loop);
    };
    animationRef.current = requestAnimationFrame(loop);
    
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      Object.values(hitTimeoutRefs.current).forEach(clearTimeout);
    };
  }, [draw]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={towerRef}
        className="absolute left-[20%] top-1/2 -translate-x-1/2 -translate-y-1/2"
      >
        <TowerComponent
          element={tower.elements[0]}
          variant={tower.id.includes('sniper') ? 'sniper' : tower.id.includes('ballista') ? 'ballista' : 'basic'}
          isUpgraded={!tower.isBase}
          size={towerSize}
          cooldownProgress={cooldownProgress}
        />
      </div>

      <div
        ref={enemy1Ref}
        className="absolute left-[75%] top-1/2 -translate-x-1/2 -translate-y-1/2"
      >
        <EnemyComponent 
          type="standard" 
          health={enemies[0].health} 
          maxHealth={enemies[0].maxHealth} 
          effects={[]} 
          className="w-8 h-8"
          isDying={enemies[0].isDying}
          wasHit={enemies[0].wasHit}
        />
      </div>

      {showSecondEnemy && <div
        ref={enemy2Ref}
        className="absolute left-[85%] top-[35%] -translate-x-1/2 -translate-y-1/2"
      >
        <EnemyComponent 
          type="schnell" 
          health={enemies[1].health} 
          maxHealth={enemies[1].maxHealth} 
          effects={[]} 
          className="w-7 h-7"
          isDying={enemies[1].isDying}
          wasHit={enemies[1].wasHit}
        />
      </div>}

      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
