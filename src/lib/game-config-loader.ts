
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

let cachedConfig: GameConfig | null = null;
let lastFetchTimestamp = 0;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Loads game configuration (towers, waves) from Firestore.
 * If Firestore data is unavailable or fails to load, it returns the local default data.
 * It includes a simple in-memory cache to reduce reads.
 */
export async function loadGameConfig(): Promise<GameConfig> {
    const now = Date.now();
    if (cachedConfig && (now - lastFetchTimestamp < CACHE_DURATION_MS)) {
        console.log("Returning cached game config.");
        return cachedConfig;
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
            
            const config = {
                towers: towersWithDps,
                waves: data.waves || defaultWaves,
            };
            
            cachedConfig = config;
            lastFetchTimestamp = now;
            console.log("Successfully loaded game config from Firestore.");
            return config;
        } else {
            console.warn("Firestore config document not found. Using local fallback.");
            return { towers: defaultTowers, waves: defaultWaves };
        }
    } catch (error) {
        console.error("Error loading game config from Firestore, using local fallback:", error);
        return { towers: defaultTowers, waves: defaultWaves };
    }
}
