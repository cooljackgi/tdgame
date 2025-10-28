
// src/components/explainer/TowerDemo.tsx
'use client';
import * as React from 'react';
import { useRef, useEffect, useCallback, useState } from 'react';
import type { Tower } from '@/lib/game-data/types';
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
};

type EnemyState = {
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
  const enemyRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();
  const attacks = useRef<DemoAttack[]>([]);
  const lastAttackTime = useRef(0);
  const lastFrameTime = useRef(performance.now());
  const [cssSize, setCssSize] = useState({ w: 100, h: 100 });
  const [cooldownProgress, setCooldownProgress] = useState(1);
  const [enemyState, setEnemyState] = useState<EnemyState>({ health: 100, maxHealth: 100, isDying: false, wasHit: false });
  const hitTimeoutRef = useRef<NodeJS.Timeout>();

  const towerSize = 50;

  const getCanvasRelativeCenter = (el: HTMLElement | null): { x: number; y: number } => {
    if (!canvasRef.current || !el) return { x: 0, y: 0 };
    const cRect = canvasRef.current.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - cRect.left, y: r.top + r.height / 2 - cRect.top };
  };

  const getMuzzlePosition = (): { x: number; y: number } => {
    if (!towerRef.current) return { x: 0, y: 0 };
    const towerCenter = getCanvasRelativeCenter(towerRef.current);
    
    const specId = tower.specId || tower.id;
    const towerVariant = 
        specId.includes('-1a') || specId.includes('-2a') ? "sniper" :
        specId.includes('-1b') || specId.includes('-2b') ? "ballista" :
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
    const toPos = getCanvasRelativeCenter(enemyRef.current);
    
    const cdMs = cooldownMsFrom(tower.attackSpeed);
    const elapsed = now - lastAttackTime.current;
    const progress = Math.min(elapsed / cdMs, 1);
    setCooldownProgress(progress);
    
    if (tower.damage > 0 && elapsed >= cdMs && !enemyState.isDying) {
      lastAttackTime.current = now;
      const projectileType = tower.specId?.includes('-1a') || tower.specId?.includes('-2a') ? 'arrow' : 'beam';
      attacks.current.push({
        id: crypto.randomUUID(),
        start: now,
        duration: 400,
        from: fromPos,
        to: toPos,
        color: elementProjectileColors[tower.elements[0] || 'neutral'],
        projectile: projectileType,
      });
    }

    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    
    const remainingAttacks: DemoAttack[] = [];
    attacks.current.forEach((attack) => {
      const aElapsed = now - attack.start;
      if (aElapsed > attack.duration) {
         // Projectile hit logic
         setEnemyState(prev => {
           if (prev.isDying) return prev;
           
           const newHealth = prev.health - (tower.damage / 4); // Deal 1/4th damage per hit for demo
           if (newHealth <= 0) {
             setTimeout(() => {
                 setEnemyState({ health: 100, maxHealth: 100, isDying: false, wasHit: false });
             }, 2000); // Respawn after 2s
             return { ...prev, health: 0, isDying: true, wasHit: true };
           }
           
           if(hitTimeoutRef.current) clearTimeout(hitTimeoutRef.current);
           hitTimeoutRef.current = setTimeout(() => setEnemyState(p => ({...p, wasHit: false})), 150);

           return { ...prev, health: newHealth, wasHit: true };
         });
         return; // Don't draw or keep it
      }
      
      remainingAttacks.push(attack);
      const t = aElapsed / attack.duration;
      const easeT = t * (2 - t);

      const dx = attack.to.x - attack.from.x;
      const dy = attack.to.y - attack.from.y;
      
      const headX = attack.from.x + dx * easeT;
      const headY = attack.from.y + dy * easeT;
      const angle = Math.atan2(dy, dx);
      const length = 14;

      ctx.save();
      ctx.globalAlpha = 1 - t * t;
      ctx.strokeStyle = attack.color as string;
      ctx.shadowColor = attack.color as string;
      ctx.shadowBlur = 4;
      
      if (attack.projectile === 'arrow') {
          ctx.beginPath();
          ctx.moveTo(headX, headY);
          ctx.lineTo(headX - length * Math.cos(angle), headY - length * Math.sin(angle));
          ctx.stroke();
      } else { // BEAM
          const tailT = Math.max(0, easeT - 0.15);
          const tailX = attack.from.x + dx * tailT;
          const tailY = attack.from.y + dy * tailT;
          
          ctx.beginPath();
          ctx.moveTo(headX, headY);
          ctx.lineTo(tailX, tailY);
          ctx.stroke();
          
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = '#ffffff';
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(headX, headY, 2.0, 0, Math.PI * 2);
          ctx.fill();
      }
      ctx.restore();
    });
    attacks.current = remainingAttacks;
  }, [cssSize, tower.attackSpeed, tower.elements, tower.damage, tower.specId, enemyState.isDying]);

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
      if (hitTimeoutRef.current) clearTimeout(hitTimeoutRef.current);
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
        ref={enemyRef}
        className="absolute left-[80%] top-1/2 -translate-x-1/2 -translate-y-1/2"
      >
        <EnemyComponent 
          type="standard" 
          health={enemyState.health} 
          maxHealth={enemyState.maxHealth} 
          effects={[]} 
          className="w-8 h-8"
          isDying={enemyState.isDying}
          wasHit={enemyState.wasHit}
        />
      </div>

      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
