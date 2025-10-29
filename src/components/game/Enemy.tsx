
// src/components/game/Enemy.tsx
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { enemyIconPaths, enemyTombstonePath } from "./icons/enemy-icons";
import type { EnemyType, EnemyStatusEffect } from '@/lib/game-data/types';
import { Progress } from "../ui/progress";
import { Flame, ShieldOff, ShieldAlert, Snowflake, Biohazard, Sparkle, Wind, VenetianMask, Zap, Star } from "lucide-react";


export type EnemyProps = {
  type: EnemyType;
  health: number;
  maxHealth: number;
  isStunned?: boolean;
  wasHit?: boolean;
  isDamaged?: boolean;
  effects: EnemyStatusEffect[];
  isGhost?: boolean; // Debug-Prop
  className?: string;
  isDying?: boolean; // New prop for death animation
};

const effectIconMap: Partial<Record<EnemyStatusEffect['type'], React.FC<any>>> = {
  burn: Flame,
  slow: Snowflake,
  vulnerability: ShieldOff,
  armor_shred: ShieldAlert,
  lifesteal: Biohazard, // Placeholder, usually not shown on enemy
  poison: Biohazard,
  stun: Star,
  pushback: Wind,
  pull: VenetianMask,
  chain: Zap,
};

const effectIconClasses: Partial<Record<EnemyStatusEffect['type'], string>> = {
  burn: "text-orange-400 -top-1 -right-1",
  slow: "text-sky-300 -bottom-1 -left-1",
  vulnerability: "text-pink-400 -top-1 -left-1",
  armor_shred: "text-yellow-400 -bottom-1 -right-1",
  poison: "text-green-500 -bottom-1.5 -right-1",
  stun: "text-yellow-300 -top-1.5 left-1/2 -translate-x-1/2 animate-spin",
  pushback: "text-gray-300 -bottom-1.5 left-1/2 -translate-x-1/2",
  pull: "text-purple-400 -top-1.5 -left-1",
  chain: "text-blue-300 -top-1.5 -right-1"
};


const EnemyComponent = React.memo(function EnemyComponent({
  type,
  health,
  maxHealth,
  isStunned,
  wasHit,
  isDamaged,
  effects,
  isGhost,
  className,
  isDying,
}: EnemyProps) {
  const iconPath = enemyIconPaths[type];
  const healthPercentage = (health / maxHealth) * 100;

  const typeColors: Record<EnemyType, string> = {
    standard: "text-zinc-300",
    schnell: "text-sky-400",
    gepanzert: "text-slate-400",
    heilend: "text-emerald-400",
    boss: "text-violet-400",
  };

  const typeAnimation: Record<EnemyType, string> = {
    standard: "animate-wobble",
    schnell: "animate-aura-pulse",
    gepanzert: "animate-aura-pulse",
    heilend: "animate-aura-pulse",
    boss: "animate-aura-pulse",
  };

  const iconClass = cn(
    "transition-all duration-100",
    typeColors[type],
    !wasHit && typeAnimation[type] // Only apply idle animation if not being hit
  );
  
  const activeEffects = effects.filter(e => e.expires > Date.now());
  
  const allVisibleEffects = React.useMemo(() => {
    const visible = new Map<EnemyStatusEffect['type'], EnemyStatusEffect>();
    activeEffects.forEach(e => visible.set(e.type, e));
    if (isStunned && !visible.has('stun')) {
        visible.set('stun', { type: 'stun', expires: Number.MAX_SAFE_INTEGER, potency: 1 });
    }
    return Array.from(visible.values());
  }, [activeEffects, isStunned]);

  if (isDying) {
    return (
      <div className={cn("relative w-16 h-16 flex items-center justify-center animate-grave-fade", className)}>
        <svg viewBox="0 0 24 24" className="h-full w-full text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d={enemyTombstonePath} />
        </svg>
      </div>
    );
  }

  return (
    <div
      className={cn("relative w-8 h-8 flex items-center justify-center", className)}
    >
      <div className="absolute bottom-full mb-1 w-10">
        <Progress value={healthPercentage} className="h-1.5 bg-black/30" />
      </div>
      <svg
        viewBox="0 0 24 24"
        className={cn(
          "h-full w-full drop-shadow-lg", 
          iconClass,
          isGhost && "border-2 border-red-500 rounded-full" // Debug-Highlight
        )}
        fill="currentColor"
        stroke="black"
        strokeWidth="0.5"
      >
        <path d={iconPath} />
      </svg>
      
      {allVisibleEffects.map((effect, i) => {
          const Icon = effectIconMap[effect.type];
          const iconPositionClass = effectIconClasses[effect.type];
          if (Icon && iconPositionClass) {
            return (
              <Icon
                key={`effect-${effect.type}-${i}`}
                className={cn(
                  "absolute z-10 h-3.5 w-3.5 drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]",
                  iconPositionClass
                )}
                strokeWidth={2.5}
              />
            );
          }
          return null;
      })}

      {wasHit && <div className="absolute inset-0 bg-white animate-dmg-flash rounded-full pointer-events-none" />}
    </div>
  );
});

EnemyComponent.displayName = "EnemyComponent";
export default EnemyComponent;
