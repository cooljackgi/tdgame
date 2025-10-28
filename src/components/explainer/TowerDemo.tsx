// src/components/explainer/TowerDemo.tsx
'use client';
import * as React from 'react';
import { useRef, useEffect, useCallback, useState } from 'react';
import type { Tower, SplashRing, Attack, SplashRingVfxType } from '@/lib/game-data/types';
import { elementProjectileColors } from '@/lib/game-data/constants';
import TowerComponent, { TOWER_MUZZLE_POINTS } from '@/components/game/Tower';
import EnemyComponent from '@/components/game/Enemy';

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

  const drawProjectile = useCallback((ctx: CanvasRenderingContext2D, a: DemoAttack, t: number) => {
    const fromPos = a.from;
    const toPos = a.to;

    const baseColor = a.color ?? '#9ca3af';
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

    } else if (a.projectile === 'chain') {
        const segments = 5;
        const randomness = 15;
        ctx.lineWidth = 3.5;
        ctx.globalAlpha = (1 - t*t);
        ctx.strokeStyle = baseColor;
        ctx.shadowBlur = 12;

        ctx.beginPath();
        ctx.moveTo(fromPos.x, fromPos.y);

        for (let i = 1; i < segments; i++) {
            const progress = i / segments;
            const currentX = fromPos.x + dx * progress;
            const currentY = fromPos.y + dy * progress;
            ctx.lineTo(
                currentX + (Math.random() - 0.5) * randomness,
                currentY + (Math.random() - 0.5) * randomness
            );
        }
        ctx.lineTo(toPos.x, toPos.y);
        ctx.stroke();

    } else { // BEAM
        const headX = fromPos.x + dx * t;
        const headY = fromPos.y + dy * t;
        const tailT = Math.max(0, t - 0.15);
        const tailX = fromPos.x + dx * tailT;
        const tailY = fromPos.y + dy * tailT;
        
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 3;
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
  }, []);

  const drawSplashRing = useCallback((ctx: CanvasRenderingContext2D, s: SplashRing, t: number) => {
    const pos = { x: s.x * CELL_SIZE, y: s.y * CELL_SIZE };
    const maxRadius = s.r * CELL_SIZE;
    const easeOutT = 1 - (1 - t) * (1 - t);
    const tSquared = t * t;
    const tRoot = Math.sqrt(t);
    const baseAngle = s.id.charCodeAt(0) % 360; 
  
    ctx.save();
    ctx.globalAlpha = 1 - tSquared;
  
    switch(s.vfxType) {
        case 'magma':
        case 'flame': {
            const cracks = s.vfxType === 'magma' ? 5 : 7;
            for (let i = 0; i < cracks; i++) {
                const angle = baseAngle + (i * (360 / cracks)) + (Math.sin(t * Math.PI * 2) * 10);
                const rad = angle * Math.PI / 180;
                const len = maxRadius * (0.7 + Math.random() * 0.3) * easeOutT;
                ctx.beginPath();
                ctx.moveTo(pos.x, pos.y);
                ctx.lineTo(pos.x + Math.cos(rad) * len, pos.y + Math.sin(rad) * len);
                ctx.strokeStyle = `hsla(30, 100%, ${60 - t * 20}%, ${1 - tSquared})`;
                ctx.lineWidth = 2 + (1 - t) * (s.vfxType === 'magma' ? 3 : 2);
                ctx.stroke();
            }
             if (s.vfxType === 'magma') {
                  const particles = 8;
                  for (let i = 0; i < particles; i++) {
                      const angle = (s.id.charCodeAt(i % s.id.length) / 255) * 360 + (i * (360 / particles));
                      const rad = angle * Math.PI / 180;
                      const dist = maxRadius * easeOutT * (0.5 + (i % 2) * 0.4);
                      const size = 3 * (1 - t);
                      ctx.fillStyle = `hsla(35, 100%, ${60 - t * 15}%, ${1 - tSquared * 0.5})`;
                      ctx.beginPath();
                      ctx.arc(pos.x + Math.cos(rad) * dist, pos.y + Math.sin(rad) * dist, size, 0, Math.PI * 2);
                      ctx.fill();
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
                const shardSize = 15 * (1 - t);
                ctx.beginPath();
                ctx.moveTo(pos.x + Math.cos(rad) * (len - shardSize), pos.y + Math.sin(rad) * (len - shardSize));
                ctx.lineTo(pos.x + Math.cos(rad) * len, pos.y + Math.sin(rad) * len);
                ctx.strokeStyle = `hsla(200, 100%, ${70 - t * 20}%, ${1 - tSquared})`;
                ctx.lineWidth = 3 + (1 - t) * 3;
                ctx.stroke();
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
                  
                  ctx.save();
                  ctx.translate(pos.x + Math.cos(rad) * dist, pos.y + Math.sin(rad) * dist);
                  ctx.rotate(angle * Math.PI / 180);
                  
                  ctx.fillStyle = `hsla(25, 60%, ${50 - t * 20}%, ${1 - tSquared})`;
                  ctx.beginPath();
                  ctx.moveTo(0, -particleSize);
                  ctx.lineTo(particleSize, particleSize);
                  ctx.lineTo(-particleSize, particleSize);
                  ctx.closePath();
                  ctx.fill();
                  ctx.restore();
              }
              break;
         }
         case 'thorn': {
              const spikes = 12;
              for (let i = 0; i < spikes; i++) {
                  const angle = baseAngle + (i * (360 / spikes));
                  const rad = angle * Math.PI / 180;
                  const len = maxRadius * tRoot;
                  ctx.beginPath();
                  ctx.moveTo(pos.x, pos.y);
                  ctx.lineTo(pos.x + Math.cos(rad) * len, pos.y + Math.sin(rad) * len);
                  ctx.strokeStyle = `hsla(140, 80%, ${50 - t * 20}%, ${1 - tSquared})`;
                  ctx.lineWidth = 2;
                  ctx.stroke();
              }
              break;
         }
          case 'light': {
              ctx.globalCompositeOperation = 'lighter';
              const coreRadius = maxRadius * Math.sin(t * Math.PI) * 0.5;
              const coreGradient = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, coreRadius);
              coreGradient.addColorStop(0, `hsla(50, 100%, 95%, ${Math.sin(t * Math.PI)})`);
              coreGradient.addColorStop(1, `hsla(50, 100%, 70%, 0)`);
              ctx.fillStyle = coreGradient;
              ctx.fillRect(pos.x - coreRadius, pos.y - coreRadius, coreRadius * 2, coreRadius * 2);
  
              const glowRadius = maxRadius * easeOutT;
              ctx.shadowBlur = 30;
              ctx.shadowColor = s.color;
              ctx.beginPath();
              ctx.arc(pos.x, pos.y, glowRadius, 0, Math.PI * 2);
              ctx.fillStyle = `hsla(50, 100%, 80%, ${Math.sin(t * Math.PI) * 0.8})`;
              ctx.fill();
              break;
          }
          case 'dark': {
              const pullRadius = maxRadius * (1 - easeOutT);
              const implosionRadius = maxRadius * (1 - t);
              
              const gradient = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, implosionRadius);
              gradient.addColorStop(0, 'rgba(128, 0, 128, 0)');
              gradient.addColorStop(0.8, 'rgba(128, 0, 128, 0.4)');
              gradient.addColorStop(1, 'rgba(0, 0, 0, 0.8)');
              
              ctx.fillStyle = gradient;
              ctx.beginPath();
              ctx.arc(pos.x, pos.y, implosionRadius, 0, Math.PI*2);
              ctx.fill();
  
              ctx.shadowBlur = 15;
              ctx.shadowColor = s.color;
              ctx.beginPath();
              ctx.arc(pos.x, pos.y, pullRadius, 0, Math.PI * 2);
              ctx.strokeStyle = `hsla(270, 90%, 70%, ${1 - t})`;
              ctx.lineWidth = 3;
              ctx.stroke();
              break;
          }
        default: { // Default shockwave
          const shockwaveRadius = maxRadius * easeOutT;
          const shockwaveAlpha = 1 - tSquared;
          const shockwaveWidth = (2 + (1 - t) * 4);
          ctx.shadowBlur = 15;
          ctx.shadowColor = s.color;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, shockwaveRadius, 0, Math.PI * 2);
          ctx.strokeStyle = s.color;
          ctx.lineWidth = shockwaveWidth;
          ctx.globalAlpha = shockwaveAlpha;
          ctx.stroke();
        }
    }
    ctx.restore();
  }, []);

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
    attacks.current.forEach((attack) => {
      const demoAttack = attack as DemoAttack; // Assume it's a DemoAttack for simplicity here
      const aElapsed = now - demoAttack.start;
      if (aElapsed > demoAttack.duration) {
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
              let vfxType: SplashRingVfxType | undefined = undefined;
              const towerId = tower.id;
              if (towerId.includes('combo-fire-earth')) vfxType = 'magma';
              else if (towerId.includes('fire-2b')) vfxType = 'flame';
              else if (towerId.includes('water-2b')) vfxType = 'ice';
              else if (towerId.includes('earth-2b')) vfxType = 'rock';
              else if (towerId.includes('nature-2b')) vfxType = 'thorn';
              else if (towerId.includes('light-2b')) vfxType = 'light';
              else if (towerId.includes('dark-2b')) vfxType = 'dark';
            
              splashRings.current.push({
                  id: crypto.randomUUID(),
                  x: toPos.x / CELL_SIZE, // needs grid coords
                  y: toPos.y / CELL_SIZE,
                  r: tower.effect.radius,
                  element: tower.elements[0] || 'neutral',
                  color: elementProjectileColors[tower.elements[0] || 'neutral'],
                  vfxType,
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
            } as DemoAttack);
         }
         return; // Don't draw or keep it
      }
      
      remainingAttacks.push(attack);
      const t = aElapsed / demoAttack.duration;
      drawProjectile(ctx, demoAttack, t);
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
