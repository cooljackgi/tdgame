
'use server';
/**
 * @fileOverview A Genkit flow to securely save the entire wave configuration to Firestore.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { getFirestore } from 'firebase-admin/firestore';
import { app } from '@/lib/firebase-admin'; // Admin app for server-side operations
import { requireAdminSession } from '@/lib/admin-auth';

const EnemyTypeSchema = z.enum(['standard', 'schnell', 'gepanzert', 'heilend', 'boss']);

const WaveEnemyDataSchema = z.object({
    type: EnemyTypeSchema,
    count: z.number(),
    spawnDelay: z.number(),
    health: z.number(),
    armor: z.number(),
    speed: z.number(),
    damage: z.number(),
    bounty: z.number(),
});

const WaveSchema = z.object({
    waveNumber: z.number(),
    enemies: WaveEnemyDataSchema,
});

const WavesDataSchema = z.array(WaveSchema);

export type WavesData = z.infer<typeof WavesDataSchema>;

const SaveWavesOutputSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});
export type SaveWavesOutput = z.infer<typeof SaveWavesOutputSchema>;


export async function saveWaveData(input: WavesData): Promise<SaveWavesOutput> {
  requireAdminSession();
  return saveWavesFlow(input);
}


const saveWavesFlow = ai.defineFlow(
  {
    name: 'saveWavesFlow',
    inputSchema: WavesDataSchema,
    outputSchema: SaveWavesOutputSchema,
  },
  async (waves) => {
    try {
        const db = getFirestore(app);
        const configRef = db.doc('game_config/balancing');
        
        // 'waves' is already a plain JSON array, so no conversion is needed.
        await configRef.set({ waves }, { merge: true });

        return { success: true };
    } catch (e: any) {
        console.error("Failed to save wave balancing data to Firestore:", e);
        return { success: false, error: e.message };
    }
  }
);
