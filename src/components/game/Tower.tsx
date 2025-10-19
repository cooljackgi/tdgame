
"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { elementIcons, elementProjectileColors } from "@/lib/game-data/constants";
import type { Element } from "@/lib/game-data/types";


export type TowerProps = {
  element: Element;
  variant?: "basic" | "sniper" | "ballista";
  isUpgraded?: boolean;
  isJustUpgraded?: boolean;
  isJustBuilt?: boolean;
  isDamaged?: boolean;
  isFiring?: boolean;
  isBuffed?: boolean;
  size?: number;
  className?: string;
  cooldownProgress?: number;
  attackSpeed?: number;
};

// Export the muzzle points to be used by the game board for projectile origins
export const TOWER_MUZZLE_POINTS = {
    basic: { x: 50, y: 18 },
    sniper: { x: 50, y: 15 },
    ballista: { x: 50, y: 22 },
};

const ornamentClasses: Record<Element, string> = {
    fire: "animate-ember",
    water: "animate-water-sway",
    nature: "animate-nature-sprout",
    light: "animate-light-twinkle",
    dark: "animate-dark-pulse",
    air: "animate-spin",
    earth: "",
    neutral: ""
};

const elementGlowColors: Record<Element, string> = {
    fire: "rgba(251, 146, 60, 0.6)",
    water: "rgba(56, 189, 248, 0.6)",
    earth: "rgba(217, 119, 6, 0.6)",
    air: "rgba(228, 228, 231, 0.6)",
    nature: "rgba(52, 211, 153, 0.6)",
    light: "rgba(253, 224, 71, 0.6)",
    dark: "rgba(167, 139, 250, 0.6)",
    neutral: "rgba(148, 163, 184, 0.6)"
};

const ElementOrnament = ({element, className, isFiring}: {element: Element, className?: string, isFiring?: boolean}) => {
   const Icon = elementIcons[element];

   return (
    <Icon className={cn(
        "h-full w-full transition-transform duration-200",
        ornamentClasses[element],
        isFiring && "scale-110",
        className, {
         'icon-aura-fire': element === 'fire',
         'icon-aura-water': element === 'water',
         'icon-aura-nature': element === 'nature',
         'icon-aura-light': element === 'light',
         'icon-aura-dark': element === 'dark',
       })}/>
   )
};

const Tower = React.memo(function Tower({
  element,
  variant = "basic",
  isUpgraded = false,
  isJustBuilt = false,
  size = 48,
  className,
  cooldownProgress = 1,
  isFiring = false,
  isBuffed = false,
}: TowerProps) {
  const tone = element === 'fire' ? 'text-orange-400' :
               element === 'water' ? 'text-sky-400' :
               element === 'earth' ? 'text-amber-500' :
               element === 'air' ? 'text-zinc-300' :
               element === 'nature' ? 'text-emerald-400' :
               element === 'light' ? 'text-yellow-300' :
               element === 'dark' ? 'text-violet-400' : 'text-slate-300';


  const COOLDOWN_RADIUS = 10;
  const COOLDOWN_CIRCUMFERENCE = 2 * Math.PI * COOLDOWN_RADIUS;
  const coreSize = 32;
  const glowColor = elementGlowColors[element];
  const cooldownColor = elementProjectileColors[element] || 'hsl(var(--primary))';
  
  const disableAnimations = size <= 20;

  const renderBase = (
     <g>
          {/* Ground shadow with gradient */}
          <defs>
            <radialGradient id="shadowGrad">
              <stop offset="0%" stopColor="rgba(0,0,0,0.5)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0)" />
            </radialGradient>
            <radialGradient id="baseGrad">
              <stop offset="0%" stopColor="rgba(30,35,45,1)" />
              <stop offset="100%" stopColor="rgba(15,18,25,1)" />
            </radialGradient>
          </defs>
          
          <ellipse cx="50" cy="82" rx="32" ry="10" fill="url(#shadowGrad)" opacity="0.6" />
          
          {/* Buff aura */}
          {isBuffed && !disableAnimations && (
             <circle cx="50" cy="68" r="30" fill="hsl(45 95% 52% / 0.4)" className="animate-aura-pulse" />
          )}
          
          {/* Hexagonal base with upgrade details */}
          <g filter={!disableAnimations ? "url(#soft)" : undefined}>
            <path 
              d="M 50 48 L 64 56 L 64 72 L 50 80 L 36 72 L 36 56 Z" 
              fill="url(#baseGrad)" 
              stroke={isUpgraded ? "#d4af37" : "#1e293b"} 
              strokeWidth={isUpgraded ? "2" : "1.5"} 
            />
            {isUpgraded && (
              <>
                <path d="M 50 48 L 64 56 L 64 58 L 50 50 Z" fill="rgba(212,175,55,0.3)" />
                <circle cx="50" cy="52" r="2" fill="#d4af37" />
                <circle cx="42" cy="56" r="1.5" fill="#d4af37" />
                <circle cx="58" cy="56" r="1.5" fill="#d4af37" />
                <circle cx="42" cy="68" r="1.5" fill="#d4af37" />
                <circle cx="58" cy="68" r="1.5" fill="#d4af37" />
              </>
            )}
          </g>
          
          {/* Element runes on base */}
          <g opacity="0.4">
            <circle cx="50" cy="64" r="1" fill={cooldownColor} className={!disableAnimations ? "animate-pulse" : ""} />
            <circle cx="44" cy="62" r="0.8" fill={cooldownColor} className={!disableAnimations ? "animate-pulse" : ""} style={{animationDelay: "0.2s"}} />
            <circle cx="56" cy="62" r="0.8" fill={cooldownColor} className={!disableAnimations ? "animate-pulse" : ""} style={{animationDelay: "0.4s"}} />
          </g>
    </g>
  );

  const renderCooldown = (cx: number, cy: number) => (
      <g transform={`translate(${cx}, ${cy}) rotate(-90)`}>
          <circle
            cx="0"
            cy="0"
            r={COOLDOWN_RADIUS}
            fill="none"
            stroke={cooldownColor}
            strokeOpacity={0.15}
            strokeWidth="3"
          />
          <circle
            cx="0"
            cy="0"
            r={COOLDOWN_RADIUS}
            fill="none"
            stroke={cooldownColor}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={COOLDOWN_CIRCUMFERENCE}
            strokeDashoffset={COOLDOWN_CIRCUMFERENCE * (1 - Math.min(cooldownProgress, 1))}
            className="transition-strokeDashoffset linear"
          />
        </g>
  );

  const renderMuzzleFlash = (cx: number, cy: number) => {
    return isFiring && !disableAnimations ? (
      <g>
        <circle
          cx={cx}
          cy={cy}
          r="9"
          fill={cooldownColor}
          opacity="0.6"
          className="animate-dmg-flash"
        />
        <circle
          cx={cx}
          cy={cy}
          r="5"
          fill="white"
          className="animate-dmg-flash"
        />
        {/* Particles */}
        {[0, 1, 2, 3].map(i => (
          <circle
            key={i}
            cx={cx + Math.cos(i * Math.PI / 2) * 12}
            cy={cy + Math.sin(i * Math.PI / 2) * 12}
            r="2"
            fill={cooldownColor}
            opacity="0.8"
            className="animate-dmg-flash"
            style={{animationDelay: `${i * 0.05}s`}}
          />
        ))}
      </g>
    ) : null;
  }

  const renderCore = (cx: number, cy: number) => (
     <g>
       {/* Core glow */}
       <circle cx={cx} cy={cy} r={coreSize/2 + 4} fill={glowColor} opacity={isFiring ? "0.8" : "0.4"} filter={!disableAnimations ? "url(#glow)" : undefined} className="transition-opacity duration-200" />
       
       {/* Core icon */}
       <g transform={`translate(${cx - coreSize/2}, ${cy - coreSize/2}) scale(${coreSize/100})`}>
          <ElementOrnament element={element} className={cn("transition-transform", tone, !disableAnimations && ornamentClasses[element])} isFiring={isFiring && !disableAnimations} />
       </g>
       
       {/* Energy ring */}
       <circle 
         cx={cx} 
         cy={cy} 
         r={coreSize/2 + 2} 
         fill="none" 
         stroke={cooldownColor} 
         strokeWidth="1" 
         opacity={cooldownProgress < 0.3 ? "0.8" : "0.3"}
         className="transition-opacity duration-300"
       />
     </g>
  );


  const renderStructure = () => {
    const muzzlePoint = TOWER_MUZZLE_POINTS[variant];
    
    switch (variant) {
        case "sniper": return (
            <>
                <defs>
                  <linearGradient id="sniperBodyGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#334155" />
                    <stop offset="50%" stopColor="#475569" />
                    <stop offset="100%" stopColor="#334155" />
                  </linearGradient>
                  <linearGradient id="sniperBarrelGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#64748b" />
                    <stop offset="50%" stopColor="#94a3b8" />
                    <stop offset="100%" stopColor="#64748b" />
                  </linearGradient>
                </defs>
                
                {/* Body with gradient */}
                <path d="M 40 45 L 35 70 L 65 70 L 60 45 Z" fill="url(#sniperBodyGrad)" stroke="#1e293b" strokeWidth="2" />
                <path d="M 40 45 L 42 47 L 58 47 L 60 45 Z" fill="rgba(148,163,184,0.3)" />
                
                {/* Barrel with details */}
                <path d="M 48 45 L 45 20 L 55 20 L 52 45 Z" fill="url(#sniperBarrelGrad)" stroke="#334155" strokeWidth="1.5" />
                <rect x="47" y="22" width="6" height="2" fill="rgba(51,65,85,0.5)" />
                <rect x="47" y="30" width="6" height="1" fill="rgba(51,65,85,0.5)" />
                
                {/* Scope */}
                <circle cx="50" cy="28" r="3" fill="#1e293b" stroke="#475569" strokeWidth="1" />
                
                {/* Upgrade armor plates */}
                {isUpgraded && (
                  <>
                    <path d="M 36 65 L 38 68 L 40 65 Z" fill="#d4af37" />
                    <path d="M 64 65 L 62 68 L 60 65 Z" fill="#d4af37" />
                    <rect x="46" y="36" width="8" height="2" fill="#d4af37" opacity="0.6" />
                  </>
                )}
                
                {!disableAnimations && renderCooldown(muzzlePoint.x, muzzlePoint.y)}
                {!disableAnimations && renderMuzzleFlash(muzzlePoint.x, muzzlePoint.y)}
                {renderCore(50, 52)}
            </>
        );
        case "ballista": return (
            <>
                <defs>
                  <linearGradient id="ballistaBaseGrad">
                    <stop offset="0%" stopColor="#334155" />
                    <stop offset="100%" stopColor="#475569" />
                  </linearGradient>
                  <linearGradient id="ballistaArmGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#64748b" />
                    <stop offset="50%" stopColor="#94a3b8" />
                    <stop offset="100%" stopColor="#64748b" />
                  </linearGradient>
                </defs>
                
                {/* Base */}
                <path d="M 42 60 L 40 70 L 60 70 L 58 60 Z" fill="url(#ballistaBaseGrad)" stroke="#1e293b" strokeWidth="2" />
                
                {/* Crossbow arms with gradient */}
                <path d="M 30 55 L 70 55 L 68 62 L 32 62 Z" fill="url(#ballistaArmGrad)" stroke="#334155" strokeWidth="1.5" />
                <rect x="30" y="56" width="40" height="1" fill="rgba(148,163,184,0.4)" />
                
                {/* String (taut) */}
                <path d="M 32 55 Q 50 58 68 55" stroke="#94a3b8" strokeWidth="1.5" fill="none" opacity="0.6" />
                
                {/* Central post */}
                <path d="M 50 55 L 50 25" stroke="#8c6c4f" strokeWidth="4" />
                <ellipse cx="50" cy="40" rx="2.5" ry="1.5" fill="#6b5637" />
                
                {/* Upgrade reinforcements */}
                {isUpgraded && (
                  <>
                    <rect x="48.5" y="35" width="3" height="8" fill="#d4af37" opacity="0.7" />
                    <circle cx="33" cy="58" r="2" fill="#d4af37" />
                    <circle cx="67" cy="58" r="2" fill="#d4af37" />
                  </>
                )}
                
                {!disableAnimations && renderCooldown(muzzlePoint.x, muzzlePoint.y)}
                {!disableAnimations && renderMuzzleFlash(muzzlePoint.x, muzzlePoint.y)}
                {renderCore(50, 52)}
            </>
        );
        case "basic":
        default: return (
             <>
                <defs>
                  <radialGradient id="basicOuterGrad">
                    <stop offset="0%" stopColor="#475569" />
                    <stop offset="70%" stopColor="#334155" />
                    <stop offset="100%" stopColor="#1e293b" />
                  </radialGradient>
                  <radialGradient id="basicInnerGrad">
                    <stop offset="0%" stopColor="#94a3b8" />
                    <stop offset="50%" stopColor="#64748b" />
                    <stop offset="100%" stopColor="#475569" />
                  </radialGradient>
                </defs>
                
                {/* Outer shell with metallic gradient */}
                <circle cx="50" cy="45" r="24" fill="url(#basicOuterGrad)" stroke="#1e293b" strokeWidth="2" />
                
                {/* Highlight */}
                <ellipse cx="50" cy="38" rx="18" ry="12" fill="rgba(148,163,184,0.2)" />
                
                {/* Inner turret */}
                <circle cx="50" cy="42" r="22" fill="url(#basicInnerGrad)" stroke="#334155" strokeWidth="1.5" />
                
                {/* Panel details */}
                <g opacity="0.5">
                  <path d="M 50 25 L 52 28 L 48 28 Z" fill="#1e293b" />
                  <circle cx="38" cy="45" r="2" fill="#1e293b" />
                  <circle cx="62" cy="45" r="2" fill="#1e293b" />
                </g>
                
                {/* Upgrade armor */}
                {isUpgraded && (
                  <g>
                    <path d="M 50 23 L 54 26 L 50 29 L 46 26 Z" fill="#d4af37" opacity="0.8" />
                    <circle cx="35" cy="42" r="2.5" fill="#d4af37" opacity="0.7" />
                    <circle cx="65" cy="42" r="2.5" fill="#d4af37" opacity="0.7" />
                  </g>
                )}
                
                {!disableAnimations && renderCooldown(muzzlePoint.x, muzzlePoint.y)}
                {!disableAnimations && renderMuzzleFlash(muzzlePoint.x, muzzlePoint.y)}
                {renderCore(50, 45)}
            </>
        );
    }
  }

  return (
    <div
      className={cn(
        "relative select-none", 
        className,
        isJustBuilt && "animate-build-in"
      )}
      style={{ width: size, height: size }}
      aria-label={`Tower ${variant} – ${element}`}
    >
      <svg
        className="absolute inset-0 overflow-visible"
        viewBox="0 0 100 100"
        width={size}
        height={size}
      >
        <defs>
          <filter id="soft">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.5" result="b"/>
            <feMerge>
              <feMergeNode in="b"/><feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        
        {renderBase}
        {renderStructure()}
      </svg>
    </div>
  );
});

Tower.displayName = "Tower";
export default Tower;
