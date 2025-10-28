// src/components/game/vfx-renderer.ts

import type { Tower, SplashRing, Element, Attack } from '@/lib/game-data/types';
import { elementProjectileColors } from '@/lib/game-data/constants';

const CELL_SIZE = 64;

type LiveAttack = Attack & { _vfx: { start: number; life: number; fromPx: {x:number, y:number}; toPx: {x:number,y:number} } };

export function drawProjectile(ctx: CanvasRenderingContext2D, a: LiveAttack, t: number) {
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
}


export function drawSplashRing(ctx: CanvasRenderingContext2D, s: SplashRing & { x: number, y: number }, t: number) {
    const pos = { x: s.x, y: s.y };
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
  }