// src/components/explainer/TowerDemo.tsx
'use client';
import * as React from 'react';
import { useRef, useEffect, useCallback, useState } from 'react';
import type { Tower } from '@/lib/game-data/types';
import { elementProjectileColors } from '@/lib/game-data/constants';
import TowerComponent from '@/components/game/Tower';
import { Bug } from 'lucide-react';

type DemoAttack = {
  start: number;
  duration: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  color: string;
};

function cooldownMsFrom(v: number): number {
  if (v <= 0) return 1000; // Failsafe
  // Assuming values < 20 are seconds (e.g., 0.8s) and > 20 are ms.
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

  const towerSize = 50;

  const getCanvasRelativeCenter = (el: HTMLElement | null): { x: number; y: number } => {
    if (!canvasRef.current || !el) return { x: 0, y: 0 };
    const cRect = canvasRef.current.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - cRect.left, y: r.top + r.height / 2 - cRect.top };
  };

  const draw = useCallback((ctx: CanvasRenderingContext2D, now: number) => {
    const { w, h } = cssSize;
    ctx.clearRect(0, 0, w, h);

    const fromPos = getCanvasRelativeCenter(towerRef.current);
    const toPos = getCanvasRelativeCenter(enemyRef.current);
    
    fromPos.y -= towerSize * 0.1;

    const cdMs = cooldownMsFrom(tower.attackSpeed);
    const elapsed = now - lastAttackTime.current;
    const progress = Math.min(elapsed / cdMs, 1);
    setCooldownProgress(progress);
    
    if (tower.damage > 0 && elapsed >= cdMs) {
      lastAttackTime.current = now;
      attacks.current.push({
        start: now,
        duration: 400,
        from: fromPos,
        to: toPos,
        color: elementProjectileColors[tower.elements[0] || 'neutral'],
      });
    }

    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    attacks.current = attacks.current.filter((attack) => {
      const aElapsed = now - attack.start;
      if (aElapsed > attack.duration) return false;

      const t = aElapsed / attack.duration;
      const easeT = t * (2 - t);

      const dx = attack.to.x - attack.from.x;
      const dy = attack.to.y - attack.from.y;
      
      const currentX = attack.from.x + dx * easeT;
      const currentY = attack.from.y + dy * easeT;
      const angle = Math.atan2(dy, dx);
      const length = 14;

      ctx.save();
      ctx.globalAlpha = 1 - t * t;
      ctx.strokeStyle = attack.color as string;
      ctx.shadowColor = attack.color as string;
      ctx.shadowBlur = 4;
      
      ctx.beginPath();
      ctx.moveTo(currentX, currentY);
      ctx.lineTo(currentX - length * Math.cos(angle), currentY - length * Math.sin(angle));
      ctx.stroke();

      ctx.restore();
      return true;
    });
  }, [cssSize, tower.attackSpeed, tower.elements, tower.damage]);

  // Stable resize handler
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

  // Effect for initialization and resize handling
  useEffect(() => {
    handleResize(); // Initial size
    // Initialize lastAttackTime to allow an immediate first shot
    lastAttackTime.current = performance.now() - cooldownMsFrom(tower.attackSpeed);
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(canvas);

    return () => resizeObserver.disconnect();
  }, [handleResize, tower.attackSpeed]);


  // Effect for animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const loop = (now: number) => {
      // ~60fps cap
      if (now - lastFrameTime.current > 16) { 
        draw(ctx, now);
        lastFrameTime.current = now;
      }
      animationRef.current = requestAnimationFrame(loop);
    };
    animationRef.current = requestAnimationFrame(loop);
    
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
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
        <Bug className="h-6 w-6 text-red-500 [filter:drop-shadow(0_0_3px_hsl(var(--destructive)))]" />
      </div>

      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
