
// src/components/explainer/vfx-renderer.ts

import type { Tower, SplashRing, Element, Attack, PoisonCloud, PersistentCloudEffect, PersistentCloud } from '@/lib/game-data/types';
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
          const shockwaveRadius = (s.vfxRadius ?? s.r) * CELL_SIZE * easeOutT;
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
    
    ctx.save();
    
    const hashStr = (s: string) => {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h += (h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24); }
        return h >>> 0;
    };
    const rngFactory = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

    if (cloud.effectType === 'poison') {
        const rng = rngFactory(hashStr(cloud.id));
        const bubbleCount = 10 + Math.floor(rng() * 6);
        const remaining = Math.max(0, cloud.expires - now);
        const lifetime = cloud.duration; // cloud's own visual lifetime
        const fadeT = Math.min(1, remaining / lifetime);
        const popInT = 1 - Math.min(1, (now - (cloud.expires - lifetime)) / 500); // 500ms pop-in
        const visT = 1 - popInT;

        // Base cloud layer
        const grad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, maxRadius);
        grad.addColorStop(0, `rgba(34, 197, 94, ${0.1 * fadeT * visT})`);
        grad.addColorStop(0.7, `rgba(16, 110, 53, ${0.05 * fadeT * visT})`);
        grad.addColorStop(1, `rgba(16, 110, 53, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, maxRadius, 0, 2 * Math.PI);
        ctx.fill();


        for (let i = 0; i < bubbleCount; i++) {
            const baseAngle = rng() * Math.PI * 2;
            const ring = 0.15 + 0.75 * rng();
            const pathR = maxRadius * ring;
            const r = 2 + 4 * rng();
            const speed = 12 + 24 * rng();
            const phase = rng() * 5000;
            const radiusPx = maxRadius;
            const prog = ((now + phase) * 0.001 * speed) % (radiusPx * 1.6);
            const rise = -prog + maxRadius * 0.8;
            const wobble = 0.35 * Math.sin((now + phase) * 0.003 + i);
            const x = pos.x + Math.cos(baseAngle + wobble) * pathR;
            const y = pos.y + Math.sin(baseAngle + wobble) * pathR + rise;
            
            const distFromCenter = Math.hypot(x - pos.x, y - pos.y);
            if (distFromCenter > maxRadius) continue;
            
            const toTop = (pos.y - y + maxRadius) / (2 * maxRadius);
            const alpha = Math.max(0, Math.min(1, 0.45 * (0.5 + 0.5 * toTop)) * fadeT * visT);
            
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(209,250,229,0.18)';
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(34,197,94,0.55)';
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(x - r * 0.35, y - r * 0.45, r * 0.25, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.fill();
            ctx.restore();
        }
    } else if (cloud.effectType === 'slow') {
        const center = pos;
        const radiusPx = maxRadius;
        
        const remaining = Math.max(0, cloud.expires - now);
        const cloudLifetime = cloud.duration || 5000;
        const fadeT = Math.min(1, remaining / cloudLifetime);


        const inner = Math.max(0, radiusPx * 0.35 * (0.7 + 0.3 * fadeT));
        const grad = ctx.createRadialGradient(center.x, center.y, inner, center.x, center.y, radiusPx);
        grad.addColorStop(0, `rgba(56, 189, 248, ${0.12 * fadeT})`);
        grad.addColorStop(1, `rgba(56, 189, 248, 0)`);
        
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
        ctx.fill();
        
        const rng = rngFactory(hashStr(cloud.id));
        const particleCount = 15 + Math.floor(rng() * 8);

        for (let i = 0; i < particleCount; i++) {
            const angle = (rng() * 360) + (now * 0.01);
            const rad = angle * Math.PI / 180;
            const dist = rng() * radiusPx;
            const size = 1 + rng() * 2;
            const alpha = (0.1 + rng() * 0.2) * fadeT;

            ctx.fillStyle = `rgba(180, 220, 255, ${alpha})`;
            ctx.beginPath();
            ctx.arc(center.x + Math.cos(rad) * dist, center.y + Math.sin(rad) * dist, size, 0, Math.PI * 2);
            ctx.fill();
        }
    } else if (cloud.effectType === "burn") {
        const center = pos;
        const radiusPx = maxRadius;
        const remaining = Math.max(0, cloud.expires - now);
        const lifetime = cloud.duration || 5000;
        const fadeT = Math.min(1, remaining / lifetime);
        const life = 1 - fadeT;
        const pop = 1 - (1 - life) * (1 - life);
        const baseIntensity = 0.35 + 0.65 * pop;

        const pot = Math.max(0, (cloud.potency ?? 1));
        const potNorm = Math.min(1, pot / 100); 
        const strengthMul = 0.5 + 1.0 * potNorm;
        const densityMul  = 0.5 + 1.1 * potNorm;
        const intensity = Math.min(baseIntensity * strengthMul, 1.0);
        
        const rng = rngFactory(hashStr(cloud.id));
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
          const rot = (seed*0.13 + k*2.1) + t*(0.6+0.2*k)*0.8 + pop*0.3;
          const r0 = radiusPx * (0.45 + 0.18 * k);
          const baseWidth = radiusPx * (0.08 - 0.02 * k);
          ctx.lineWidth = Math.max(1.2, baseWidth * (0.5 + 0.5 * intensity));
          const hue = 25 + k*6;
          const alpha = Math.max(0.14, 0.18 * intensity);
          ctx.strokeStyle = `hsla(${hue}, 100%, 55%, ${alpha})`;
          ctx.beginPath();
          ctx.arc(center.x, center.y, r0, rot, rot + Math.PI*(0.7 - 0.12*k));
          ctx.stroke();
        }
      
        const bubbleCount = Math.max(6, Math.round(14 * densityMul));
        for (let i = 0; i < bubbleCount; i++) {
          const rA = rng();
          const rB = rng();
          const baseAngle = (rA*360) + i*(360/bubbleCount);
          const swirl = (20*pop) + (t*40*(0.4+0.6*rB)*0.8);
          const angle = (baseAngle + swirl) * Math.PI/180;
      
          const rise   = (0.12 + 0.70*Math.pow(rA,1.6)) * radiusPx;
          const jitter = Math.sin(t*3 + i) * (radiusPx*0.05) * (0.4+0.6*rB);
          const dist   = Math.max(radiusPx*0.12, Math.min(radiusPx*0.75, rise + jitter));
      
          const baseSize = radiusPx * (0.07 + 0.09*rB) * 0.8;
          const size     = Math.max(0.9, baseSize * (0.8 + 0.2*pop));
      
          const light = 50 + 20*rA;
          const bubbleAlpha = (0.26 + 0.50*pop) * (0.6+0.4*rB) * intensity;
      
          ctx.fillStyle = `hsla(28, 100%, ${light}%, ${bubbleAlpha})`;
          ctx.beginPath();
          ctx.arc(center.x + Math.cos(angle)*dist, center.y + Math.sin(angle)*dist, size, 0, Math.PI*2);
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
