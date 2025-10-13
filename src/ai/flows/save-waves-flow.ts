
'use server';
/**
 * @fileOverview A Genkit flow to securely save the entire wave configuration.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { writeFile } from 'fs/promises';
import { resolve } from 'path';

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
        const filePath = resolve(process.cwd(), 'src', 'lib', 'game-data', 'enemies.ts');
        
        // We will keep the formula logic in the file, but overwrite the `waves` array.
        const fileHeader = `
import type { Wave, WaveEnemyData, EnemyType } from './types';

// Diese Formeln dienen jetzt als Basis für die *initiale* Generierung
// und als Referenz im UI. Die Wellen selbst werden als komplette Objekte gespeichert.
export const waveFormulaCoefficients = {
  "hp_base": 100,
  "hp_exponent": 1.12,
  "speed_base": 1.2,
  "speed_exponent": 1.005,
  "count_base": 10,
  "count_increment": 1.5,
  "bounty_base": 10,
  "bounty_exponent": 1.02
};

export function generateProceduralWave(waveNumber: number, formulas: typeof waveFormulaCoefficients): Wave {
    const f = formulas;
    
    const hp = f.hp_base * Math.pow(f.hp_exponent, waveNumber - 1);
    const speed = f.speed_base * Math.pow(f.speed_exponent, waveNumber - 1);
    const count = f.count_base + (f.count_increment * (waveNumber - 1));
    const bounty = f.bounty_base * Math.pow(f.bounty_exponent, waveNumber - 1);

    let type: EnemyType = 'standard';
    if (waveNumber > 0 && waveNumber % 10 === 0) type = 'boss';
    else if (waveNumber % 7 === 0) type = 'heilend';
    else if (waveNumber % 5 === 0) type = 'gepanzert';
    else if (waveNumber % 3 === 0) type = 'schnell';

    const baseParams = {
        standard:  { armorFactor: 0.05, speedFactor: 1.0, healthFactor: 1.0, bountyFactor: 1.0, countFactor: 1.0 },
        schnell:   { armorFactor: 0.02, speedFactor: 1.5, healthFactor: 0.8, bountyFactor: 1.1, countFactor: 1.1 },
        gepanzert: { armorFactor: 0.20, speedFactor: 0.8, healthFactor: 1.5, bountyFactor: 1.3, countFactor: 0.8 },
        heilend:   { armorFactor: 0.10, speedFactor: 1.0, healthFactor: 1.2, bountyFactor: 1.2, countFactor: 0.9 },
        boss:      { armorFactor: 0.30, speedFactor: 0.9, healthFactor: 12.0, bountyFactor: 8.0, countFactor: 1/15 },
    };
    
    const params = baseParams[type];
    
    const finalCount = Math.max(1, Math.round(count * params.countFactor));
    const finalHealth = Math.round(hp * params.healthFactor);
    
    const enemies: WaveEnemyData = {
      type: type,
      count: finalCount,
      spawnDelay: Math.max(200, 3000 / finalCount),
      health: finalHealth,
      armor: Math.round(finalHealth * params.armorFactor),
      speed: parseFloat((speed * params.speedFactor).toFixed(2)),
      damage: Math.round(finalHealth / 10), // Damage is relative to health
      bounty: Math.round(bounty * params.bountyFactor),
    };

    return { waveNumber, enemies };
};
`.trim();

        // Turn the tower objects into a string that can be written to the file
        const wavesArrayString = `export let waves: Wave[] = ${JSON.stringify(waves, null, 2)};`;

        const newFileContent = `${fileHeader}\n\n${wavesArrayString}\n`;

        await writeFile(filePath, newFileContent, 'utf8');

        return { success: true };
    } catch (e: any) {
        console.error("Failed to save wave balancing data:", e);
        return { success: false, error: e.message };
    }
  }
);
