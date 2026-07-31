// src/components/explainer/TowerDemo.tsx
'use client';
import * as React from 'react';
import { useRef, useEffect, useCallback, useState } from 'react';
import type { Tower, SplashRing, Attack, SplashRingVfxType } from '@/lib/game-data/types';
import { elementProjectileColors } from '@/lib/game-data/constants';
import TowerComponent, { TOWER_MUZZLE_POINTS } from '@/components/game/Tower';
import EnemyComponent from '@/components/game/Enemy';
import { drawSplashRing, drawProjectile } from './vfx-renderer';


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

const CELL_SIZE = 64;

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
  const attacks = useRef<(DemoAttack | Attack)[]>([]);
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
  
  useEffect(() => {
    enemies.forEach(enemy => {
        if (enemy.wasHit) {
            if (hitTimeoutRefs.current[enemy.id]) {
                clearTimeout(hitTimeoutRefs.current[enemy.id]);
            }
            hitTimeoutRefs.current[enemy.id] = setTimeout(() => {
                setEnemies(current => 
                    current.map(e => 
                        e.id === enemy.id ? { ...e, wasHit: false } : e
                    )
                );
            }, 150);
        }
    });

    return () => {
        Object.values(hitTimeoutRefs.current).forEach(clearTimeout);
    };
  }, [enemies]);


  const towerSize = 50;
  const primaryEffect = tower.effects?.[0];
  const showSecondEnemy = primaryEffect?.type === 'chain';

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
    const size = towerSize; // Use the actual tower size for calculation
    const xOffset = (muzzle.x / 100) * size - (size / 2);
    const yOffset = (muzzle.y / 100) * size - (size / 2);

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
      } as DemoAttack);
    }

    // Draw and manage attacks
    const remainingAttacks: (DemoAttack | Attack)[] = [];
    for (const attack of attacks.current) {
        const demoAttack = attack as DemoAttack;
        const aElapsed = now - demoAttack.start;
  
        if (aElapsed < demoAttack.duration) {
          remainingAttacks.push(attack);
          const t = aElapsed / demoAttack.duration;
          drawProjectile(ctx, demoAttack, t);
        } else {
          // Projectile hit logic for the primary target
          setEnemies(prevEnemies => {
              const newEnemies = [...prevEnemies];
              const enemyIndex = newEnemies.findIndex(e => e.id === 'e1');
              if (enemyIndex === -1 || newEnemies[enemyIndex].isDying) return newEnemies;
  
              const enemy = newEnemies[enemyIndex];
              const newHealth = enemy.health - (tower.damage / 4);
  
              if (newHealth <= 0) {
                  newEnemies[enemyIndex] = { ...enemy, health: 0, isDying: true, wasHit: true };
                  setTimeout(() => setEnemies(es => es.map(e => ({ ...e, health: e.maxHealth, isDying: false, wasHit: false }))), 2000);
              } else {
                  newEnemies[enemyIndex] = { ...enemy, health: newHealth, wasHit: true };
              }
              return newEnemies;
          });
  
          if (primaryEffect?.type === 'splash' || primaryEffect?.type === 'poison') {
            let vfxType: SplashRingVfxType | undefined = undefined;
            const specId = (tower as any).specId || tower.id;
            
            if (specId.includes('combo-fire-earth')) vfxType = 'magma';
            else if (specId.includes('fire-2b')) vfxType = 'flame';
            else if (specId.includes('combo-fire-water')) vfxType = 'steam'; // Corrected
            else if (specId.includes('water-2b') || specId.includes('combo-water-earth')) vfxType = 'ice';
            else if (specId.includes('earth-2b')) vfxType = 'rock';
            else if (specId.includes('nature-2b') || specId.includes('combo-water-nature')) vfxType = 'thorn';
            else if (specId.includes('light-2b')) vfxType = 'light';
            else if (specId.includes('dark-2b')) vfxType = 'dark';
            else if (specId.includes('combo-fire-nature')) vfxType = 'poison';


            splashRings.current.push({
                id: crypto.randomUUID(),
                x: toPos.x, // Use pixel coords
                y: toPos.y, // Use pixel coords
                r: primaryEffect.radius!,
                element: tower.elements[0] || 'neutral',
                color: elementProjectileColors[tower.elements[0] || 'neutral'],
                vfxType,
                start: now,
                life: 600,
            } as LiveSplashRing);
          }
  
          if (primaryEffect?.type === 'chain' && primaryEffect.bounces) {
            attacks.current.push({
                id: crypto.randomUUID(),
                start: now,
                duration: 250,
                from: toPos,
                to: toPos2,
                color: elementProjectileColors[tower.elements[0] || 'neutral'],
                projectile: 'chain',
                elements: tower.elements,
            } as DemoAttack);
          }
        }
    }
    attacks.current = remainingAttacks;

    // Draw and manage splash rings
    const remainingSplashes: LiveSplashRing[] = [];
    splashRings.current.forEach(splash => {
        const elapsed = now - splash.start;
        if (elapsed > splash.life) return;
        remainingSplashes.push(splash);
        const t = elapsed / splash.life;
        drawSplashRing(ctx, splash, t);
    });
    splashRings.current = remainingSplashes;

  }, [cssSize, tower, enemies, drawProjectile, drawSplashRing]);

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
    // This is the reset logic
    attacks.current = []; // Clear any active attacks from previous tower
    splashRings.current = []; // Clear any active splash rings
    lastAttackTime.current = performance.now() - cooldownMsFrom(tower.attackSpeed);
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(canvas);

    return () => resizeObserver.disconnect();
  }, [handleResize, tower.attackSpeed, tower.id]);

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
