
'use server';
/**
 * @fileOverview A Genkit flow to securely save tower balancing data to Firestore.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { getFirestore } from 'firebase-admin/firestore';
import { app } from '@/lib/firebase-admin'; // Admin app for server-side operations
import { requireAdminSession } from '@/lib/admin-auth';
import type { Tower } from '@/lib/game-data/types';

// Zod schemas remain the same to validate the input data structure.
const TowerEffectSchema = z.object({
  type: z.enum(['slow', 'stun', 'burn', 'pushback', 'splash', 'multishot', 'chain', 'pull', 'vulnerability', 'aura', 'armor_shred', 'lifesteal', 'crit', 'poison', 'persistent_cloud']),
  duration: z.number().optional(),
  potency: z.number().optional(),
  chance: z.number().optional(),
  distance: z.number().optional(),
  radius: z.number().optional(),
  targets: z.number().optional(),
  bounces: z.number().optional(),
  vfxType: z.string().optional(), // Added for splash vfx
  cloudEffect: z.string().optional(), // for persistent_cloud
}).passthrough();


const TowerSchema = z.object({
    id: z.string(),
    name: z.string(),
    tier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    elements: z.array(z.string()), // Simplified for validation
    cost: z.number(),
    damage: z.number(),
    range: z.number(),
    attackSpeed: z.number(),
    description: z.string(),
    maxHealth: z.number(),
    buildTimeMs: z.number().optional(),
    isBlocker: z.boolean().optional(),
    effects: z.array(TowerEffectSchema).optional(),
    upgradesTo: z.array(z.string()).optional(),
    isBase: z.boolean(),
});

const BalancingDataSchema = z.array(TowerSchema);
export type BalancingData = z.infer<typeof BalancingDataSchema>;

const SaveBalancingOutputSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});
export type SaveBalancingOutput = z.infer<typeof SaveBalancingOutputSchema>;


export async function saveBalancingData(input: BalancingData): Promise<SaveBalancingOutput> {
  requireAdminSession();
  return saveBalancingFlow(input);
}


const saveBalancingFlow = ai.defineFlow(
  {
    name: 'saveBalancingFlow',
    inputSchema: BalancingDataSchema,
    outputSchema: SaveBalancingOutputSchema,
  },
  async (towers) => {
    try {
        const db = getFirestore(app);
        const configRef = db.doc('game_config/balancing');
        
        // Convert towers to plain JSON objects, removing the 'dps' getter.
        const towersAsJson = towers.map(tower => {
            const { dps, ...rest } = tower as any;
            return rest;
        });

        // Use 'set' with 'merge: true' to update only the 'towers' field in the document.
        await configRef.set({ towers: towersAsJson }, { merge: true });

        return { success: true };
    } catch (e: any) {
        console.error("Failed to save tower balancing data to Firestore:", e);
        return { success: false, error: e.message };
    }
  }
);
