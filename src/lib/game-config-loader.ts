// src/lib/game-config-loader.ts
import type { Tower, Wave } from '@/lib/game-data/types';

// Import local fallback data
import { towers as defaultTowers } from '@/lib/game-data/towers';
import { waves as defaultWaves } from '@/lib/game-data/enemies';

export type GameConfig = {
    towers: Tower[];
    waves: Wave[];
};

const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// --- Robuster, globaler Cache, um Hot-Reloading-Probleme in Next.js zu umgehen ---
type GlobalCache = {
    config: GameConfig | null;
    lastFetchTimestamp: number;
};

// Erweitere den globalen Namensraum, um TypeScript-Fehler zu vermeiden.
declare global {
  var __gameConfigCache: GlobalCache | undefined;
}

const getCache = (): GlobalCache => {
  if (!globalThis.__gameConfigCache) {
    globalThis.__gameConfigCache = {
      config: null,
      lastFetchTimestamp: 0,
    };
  }
  return globalThis.__gameConfigCache;
};


/**
 * Loads game configuration (towers, waves) through the server-side public API.
 * If the live data is unavailable or fails validation, it returns the local default data.
 * It includes a simple in-memory cache to reduce reads.
 */
export async function loadGameConfig(): Promise<GameConfig> {
    const now = Date.now();
    const cache = getCache();

    if (cache.config && (now - cache.lastFetchTimestamp < CACHE_DURATION_MS)) {
        // console.log("Returning cached game config."); // Log entfernt, um Konsole sauber zu halten
        return cache.config;
    }

    console.log("Fetching live game config...");
    try {
        const response = await fetch('/api/game-config', { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Game config request failed with status ${response.status}`);
        }

        const data = await response.json() as {
            source?: string;
            towers?: Omit<Tower, 'dps'>[];
            waves?: Wave[];
        };
        if (!Array.isArray(data.towers) || data.towers.length === 0 ||
            !Array.isArray(data.waves) || data.waves.length === 0) {
            throw new Error('Game config response is incomplete');
        }

        // Re-add the 'dps' getter because functions cannot be serialized as JSON.
        const towersWithDps = data.towers.map(towerData => ({
            ...towerData,
            get dps() {
                return this.damage * (1000 / this.attackSpeed);
            }
        }));

        const config: GameConfig = {
            towers: towersWithDps,
            waves: data.waves,
        };

        cache.config = config;
        cache.lastFetchTimestamp = now;
        console.log(`Successfully loaded live game config from ${data.source || 'server'}.`);
        return config;
    } catch (error) {
        console.error("Error loading live game config, using local fallback:", error);
        // Do not cache config on error to allow for retries
        return { towers: defaultTowers, waves: defaultWaves };
    }
}
