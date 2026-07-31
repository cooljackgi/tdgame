// src/components/explainer/vfx-renderer.ts

import type { Tower, SplashRing, Element, Attack, PersistentCloudEffect, PersistentCloud } from '@/lib/game-data/types';
import { elementProjectileColors } from '@/lib/game-data/constants';

const CELL_SIZE = 64;

type LiveAttack = Attack & { _vfx: { start: number; life: number; fromPx: {x:number, y:number}; toPx: {x:number,y:number} } };

export function drawProjectile(ctx: CanvasRenderingContext2D, a: DemoAttack, t: number) {
    const fromPos = a.from;
    const toPos = a.to;

    const primaryElement = a.elements?.[0] ?? 'neutral';
    const baseColor = a.color ?? elementProjectileColors[primaryElement] ?? '#9ca3af';
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


export function drawSplashRing(ctx: CanvasRenderingContext2D, s: SplashRing, t: number) {
    const pos = { x: s.x, y: s.y };
    const maxRadius = (s.vfxRadius ?? s.r) * CELL_SIZE;
    const easeOutT = 1 - (1 - t) * (1 - t);
    const tSquared = t * t;
    const tRoot = Math.sqrt(t);
    const baseAngle = s.id.charCodeAt(0) % 360; 
  
    ctx.save();
    ctx.globalAlpha = 1 - tSquared;
  
    switch(s.vfxType) {
        case 'steam': {
            const particles = 12;
            for(let i=0; i < particles; i++) {
                const angle = baseAngle + (i * 360/particles) + (easeOutT * 45);
                const rad = angle * Math.PI / 180;
                const dist = maxRadius * easeOutT * (0.6 + (i%2) * 0.4);
                const size = maxRadius * 0.2 * (1 - t);
                
                ctx.fillStyle = `hsla(210, 30%, 80%, ${1-tSquared})`;
                ctx.beginPath();
                ctx.arc(pos.x + Math.cos(rad) * dist, pos.y + Math.sin(rad) * dist, size, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
        }
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
                const shardSize = 15 * (1-t);
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
         case 'poison': {
            const bubbles = 15;
            for(let i=0; i < bubbles; i++) {
                const angle = baseAngle + (i * 360/bubbles) + (easeOutT * 20);
                const rad = angle * Math.PI / 180;
                const dist = maxRadius * Math.pow(easeOutT, 0.7) * (0.4 + (i%3) * 0.2);
                const size = maxRadius * 0.1 * (1 - t) * (0.5 + Math.sin(i + t*Math.PI*2) * 0.5);

                ctx.fillStyle = `hsla(110, 80%, 40%, ${0.8 - tSquared})`;
                ctx.beginPath();
                ctx.arc(pos.x + Math.cos(rad) * dist, pos.y + Math.sin(rad) * dist, size, 0, Math.PI * 2);
                ctx.fill();
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

export function drawPersistentCloud(ctx: CanvasRenderingContext2D, cloud: PersistentCloud, now: number) {
    const pos = { x: cloud.x * CELL_SIZE, y: cloud.y * CELL_SIZE };
    const maxRadius = cloud.radius * CELL_SIZE;
    const remaining = Math.max(0, cloud.expires - now);
    const lifeT = Math.min(1, remaining / (cloud.duration || 5000)); // Fade out over its own duration
    const popInT = 1 - Math.min(1, (now - (cloud.expires - (cloud.duration || 5000))) / 500); // 500ms pop-in
    const visT = 1 - popInT; // Starts at 0, goes to 1

    ctx.save();
    ctx.globalAlpha = visT * lifeT; // Apply both pop-in and fade-out

    if (cloud.effectType === 'poison') {
        // Base cloud layer for volume
        const grad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, maxRadius);
        grad.addColorStop(0, `rgba(34, 197, 94, 0.1)`);
        grad.addColorStop(0.7, `rgba(16, 110, 53, 0.05)`);
        grad.addColorStop(1, `rgba(16, 110, 53, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, maxRadius, 0, 2 * Math.PI);
        ctx.fill();

        // Bubbles
        const bubbleCount = 15 + Math.floor(cloud.potency / 10);
        for (let i = 0; i < bubbleCount; i++) {
            const seed = i + cloud.id.charCodeAt(i % cloud.id.length);
            const pathRadius = maxRadius * (0.1 + (seed % 89) / 100 * 0.9);
            const speed = 0.5 + (seed % 51) / 100;
            const offset = (seed % 31) / 31 * 2 * Math.PI;
            const time = now * 0.001 * speed + offset;
            
            const x = pos.x + Math.cos(time) * pathRadius;
            const y = pos.y + Math.sin(time * 1.2) * pathRadius * 0.5 - (time % 3) * 15;
            const size = 1 + (seed % 3) + Math.sin(time) * 1;
            
            if (Math.hypot(x - pos.x, y - pos.y) > maxRadius) continue;
            
            ctx.fillStyle = `hsla(140, 50%, 70%, ${0.1 + (seed % 20) / 100})`;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, 2 * Math.PI);
            ctx.fill();
        }
    } else if (cloud.effectType === 'slow') {
        const center = pos;
        const radiusPx = maxRadius;
        const inner = Math.max(0, radiusPx * 0.35 * (0.7 + 0.3 * lifeT));
        const grad = ctx.createRadialGradient(center.x, center.y, inner, center.x, center.y, radiusPx);
        grad.addColorStop(0, `rgba(56, 189, 248, 0.12)`);
        grad.addColorStop(1, `rgba(56, 189, 248, 0)`);
        
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
        ctx.fill();
        
        // Swirling particles
        const particleCount = 15;
        for (let i = 0; i < particleCount; i++) {
            const angle = ((i * 137.5) % 360) * Math.PI / 180 + (now * 0.0001);
            const dist = (Math.sin(i * 1.1 + now * 0.0005) * 0.5 + 0.5) * radiusPx;
            const size = 1 + Math.sin(i * 2.3 + now * 0.0008) * 0.5 * 2;
            const particleAlpha = 0.1 + Math.sin(i * 0.5 + now * 0.001) * 0.5 * 0.2;
            
            ctx.fillStyle = `rgba(180, 220, 255, ${particleAlpha})`;
            ctx.beginPath();
            ctx.arc(center.x + Math.cos(angle) * dist, center.y + Math.sin(angle) * dist, size, 0, Math.PI * 2);
            ctx.fill();
        }
    } else if (cloud.effectType === "burn") {
        const center = pos;
        const radiusPx = maxRadius;
        
        const potNorm = Math.min(1, (cloud.potency ?? 1) / 100); 
        const intensity = visT * lifeT * (0.5 + 1.0 * potNorm);
        
        const t = now * 0.001;
        const seed = cloud.id.charCodeAt(0);

        const g = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radiusPx);
        g.addColorStop(0.00, `rgba(255,170,80,${0.40 * intensity * 0.75})`);
        g.addColorStop(0.45, `rgba(255,110,30,${0.28 * intensity * 0.75})`);
        g.addColorStop(0.80, `rgba(140,40,10,${0.14 * intensity * 0.75})`);
        g.addColorStop(1.00, `rgba(0,0,0,0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
        ctx.fill();
      
        const prevComp = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = "lighter";
        
        const swirlLayers = 3;
        for (let k = 0; k < swirlLayers; k++) {
          const rot = (seed * 0.13 + k * 2.1) + t * (0.6 + 0.2 * k) * 0.8 + lifeT * 0.3;
          const r0 = radiusPx * (0.45 + 0.18 * k);
          const baseWidth = radiusPx * (0.08 - 0.02 * k);
          ctx.lineWidth = Math.max(1.2, baseWidth * intensity);
          const hue = 25 + k * 6;
          const alpha = Math.max(0.14, 0.18 * intensity);
          ctx.strokeStyle = `hsla(${hue}, 100%, 55%, ${alpha})`;
          ctx.beginPath();
          ctx.arc(center.x, center.y, r0, rot, rot + Math.PI * (0.7 - 0.12 * k));
          ctx.stroke();
        }
      
        const bubbleCount = Math.max(6, Math.round(14 * (0.5 + 1.1 * potNorm)));
        for (let i = 0; i < bubbleCount; i++) {
          const rA = Math.sin(seed + i * 3.17);
          const rB = Math.sin(seed - i * 7.73);
          const baseAngle = (rA * 360) + i * (360 / bubbleCount);
          const swirl = (20 * lifeT) + (t * 40 * (0.4 + 0.6 * rB) * 0.8);
          const angle = (baseAngle + swirl) * Math.PI / 180;
      
          const rise = (0.12 + 0.70 * Math.pow(Math.abs(rA), 1.6)) * radiusPx;
          const jitter = Math.sin(t * 3 + i) * (radiusPx * 0.05) * (0.4 + 0.6 * rB);
          const dist = Math.max(radiusPx * 0.12, Math.min(radiusPx * 0.75, rise + jitter));
      
          const baseSize = radiusPx * (0.07 + 0.09 * rB) * 0.8;
          const size = Math.max(0.9, baseSize * (0.8 + 0.2 * lifeT));
      
          const light = 50 + 20 * Math.abs(rA);
          const bubbleAlpha = (0.26 + 0.50 * lifeT) * (0.6 + 0.4 * Math.abs(rB)) * intensity;
      
          ctx.fillStyle = `hsla(28, 100%, ${light}%, ${bubbleAlpha})`;
          ctx.beginPath();
          ctx.arc(center.x + Math.cos(angle) * dist, center.y + Math.sin(angle) * dist, size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = prevComp;
    }
    
    ctx.restore();
}


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
