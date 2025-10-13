

import type { LucideIcon } from 'lucide-react';
import {
  IconFire,
  IconWater,
  IconEarth,
  IconAir,
  IconNature,
  IconLight,
  IconDark,
  IconNeutral,
} from "@/components/game/icons/tower-icons";
import type { Element, EnemyType } from './types';

export const GRID_ROWS = 12;
export const GRID_COLS = 12;

export const LOCAL_STORAGE_KEY = 'nexus-singleplayer-save';
export const ALL_PICKABLE_ELEMENTS: Element[] = ['fire', 'water', 'earth', 'air', 'light', 'dark', 'nature'];
export const INTERMISSION_TIME = 15;

export const difficultyModifiers = {
  Einfach: {
    startLives: 30,
    startResources: 1500,
    enemyHealth: 0.8,
  },
  Normal: {
    startLives: 20,
    startResources: 1250,
    enemyHealth: 1.0,
  },
  Schwer: {
    startLives: 10,
    startResources: 1000,
    enemyHealth: 1.25,
  },
};

export const elementIcons: Record<Element, React.FC<any>> = {
  fire: IconFire,
  water: IconWater,
  earth: IconEarth,
  air: IconAir,
  nature: IconNature,
  light: IconLight,
  dark: IconDark,
  neutral: IconNeutral,
};

export const elementColors: Record<Element, string> = {
  fire:  "text-red-400",
  water: "text-sky-400",
  earth: "text-amber-500",
  air:   "text-zinc-300",
  nature:"text-emerald-400",
  light: "text-yellow-300",
  dark:  "text-violet-300",
  neutral:"text-slate-200",
};

export const elementBackgroundColors: Record<Element, string> = {
    fire: 'bg-red-900/40 hover:bg-red-900/60',
    water: 'bg-blue-900/40 hover:bg-blue-900/60',
    earth: 'bg-yellow-900/40 hover:bg-yellow-900/60',
    air: 'bg-gray-700/40 hover:bg-gray-700/60',
    nature: 'bg-green-900/40 hover:bg-green-900/60',
    light: 'bg-yellow-800/40 hover:bg-yellow-800/60',
    dark: 'bg-purple-900/40 hover:bg-purple-900/60',
    neutral: 'bg-gray-800/20 hover:bg-gray-800/40',
};


export const elementProjectileColors: Record<Element, string> = {
  fire: '#ef4444',
  water: '#3b82f6',
  earth: '#a16207',
  air: '#e0f2fe',
  nature: '#22c55e',
  light: '#facc15',
  dark: '#7e22ce',
  neutral: '#9ca3af',
};
