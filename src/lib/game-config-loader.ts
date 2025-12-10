// src/lib/game-config-loader.ts
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
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
 * Loads game configuration (towers, waves) from Firestore.
 * If Firestore data is unavailable or fails to load, it returns the local default data.
 * It includes a simple in-memory cache to reduce reads.
 */
export async function loadGameConfig(): Promise<GameConfig> {
    const now = Date.now();
    const cache = getCache();

    if (cache.config && (now - cache.lastFetchTimestamp < CACHE_DURATION_MS)) {
        // console.log("Returning cached game config."); // Log entfernt, um Konsole sauber zu halten
        return cache.config;
    }

    console.log("Fetching game config from Firestore...");
    try {
        const configRef = doc(db, 'game_config/balancing');
        const docSnap = await getDoc(configRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            const towersData = data.towers as Omit<Tower, 'dps'>[];

            // Re-add the 'dps' getter to each tower object
            const towersWithDps = towersData.map(towerData => ({
                ...towerData,
                get dps() {
                    return this.damage * (1000 / this.attackSpeed);
                }
            }));
            
            const config: GameConfig = {
                towers: towersWithDps,
                waves: data.waves || defaultWaves,
            };
            
            cache.config = config;
            cache.lastFetchTimestamp = now;
            console.log("Successfully loaded game config from Firestore.");
            return config;
        } else {
            console.warn("Firestore config document not found. Using local fallback.");
            const fallbackConfig = { towers: defaultTowers, waves: defaultWaves };
            cache.config = fallbackConfig; // Cache fallback to prevent re-fetching on every call
            cache.lastFetchTimestamp = now;
            return fallbackConfig;
        }
    } catch (error) {
        console.error("Error loading game config from Firestore, using local fallback:", error);
        // Do not cache config on error to allow for retries
        return { towers: defaultTowers, waves: defaultWaves };
    }
}
