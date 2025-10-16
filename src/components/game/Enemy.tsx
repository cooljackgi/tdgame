// src/components/game/Enemy.tsx
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { enemyIconPaths } from "./icons/enemy-icons";
import type { EnemyType, EnemyStatusEffect } from '@/lib/game-data/types';
import { Progress } from "../ui/progress";
import { Flame, ShieldOff, ShieldAlert, Snowflake, Biohazard, Sparkle } from "lucide-react";


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
};

const effectIconMap: Partial<Record<EnemyStatusEffect['type'], React.FC<any>>> = {
  burn: Flame,
  slow: Snowflake,
  vulnerability: ShieldOff,
  armor_shred: ShieldAlert,
  lifesteal: Biohazard,
  stun: Sparkle,
};

const effectIconClasses: Partial<Record<EnemyStatusEffect['type'], string>> = {
  burn: "text-orange-400 -top-1 -right-1",
  slow: "text-sky-300 -bottom-1 -left-1",
  vulnerability: "text-pink-400 -top-1 -left-1",
  armor_shred: "text-yellow-400 -bottom-1 -right-1",
  lifesteal: "text-green-500 -bottom-1 -right-1",
  stun: "text-yellow-300 -top-1.5 left-1/2 -translate-x-1/2",
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

  const iconClass = cn(
    "transition-all duration-100",
    typeColors[type],
    wasHit && "animate-flash",
    isDamaged && "animate-wobble"
  );
  

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
      
      {effects.map((effect, i) => {
          const Icon = effectIconMap[effect.type];
          const iconPositionClass = effectIconClasses[effect.type];
          if (Icon && iconPositionClass) {
            return <Icon key={`effect-${i}`} className={cn("effect-icon absolute", iconPositionClass)} />;
          }
          return null;
      })}
    </div>
  );
});

EnemyComponent.displayName = "EnemyComponent";
export default EnemyComponent;
