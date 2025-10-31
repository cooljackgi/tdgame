
'use server';
/**
 * @fileOverview A Genkit flow to securely save tower balancing data.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import {writeFile} from 'fs/promises';
import {resolve} from 'path';
import type {Tower} from '@/lib/game-data/types';


// Define a schema for a single tower that matches the structure in game-data.ts
// but without the getter property, which can't be serialized.
const TowerEffectSchema = z.object({
  type: z.enum(['slow', 'stun', 'burn', 'pushback', 'splash', 'multishot', 'chain', 'pull', 'vulnerability', 'aura', 'armor_shred', 'lifesteal', 'crit', 'poison', 'persistent_cloud']),
  duration: z.number().optional(),
  potency: z.number().optional(),
  chance: z.number().optional(),
  distance: z.number().optional(),
  radius: z.number().optional(),
  targets: z.number().optional(),
  bounces: z.number().optional(),
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
    isBlocker: z.boolean().optional(),
    effect: TowerEffectSchema.optional(),
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
        const filePath = resolve(process.cwd(), 'src', 'lib', 'game-data', 'towers.ts');
        
        const fileHeader = `
import type { Tower } from './types';
`.trim();


        // Turn the tower objects into a string that can be written to the file
        const towersString = towers.map(tower => {
            // Remove the 'dps' property if it exists, as it's a getter
            const { dps, ...rest } = tower as any;
            
            // Re-stringify the object to ensure it's a clean JSON representation
            const towerData = { ...rest };
            delete towerData.dps; // Make sure it's gone
            
            let towerString = JSON.stringify(towerData, (key, value) => {
              if (typeof value === 'string' && key === 'description') {
                return value.replace(/'/g, "\\\'");
              }
              return value;
            });
            
            towerString = towerString.replace(/"([^"]+)":/g, '$1:');
            
            // Add the dps getter back
            return `${towerString.slice(0, -1)}, get dps() { return this.damage * (1000 / this.attackSpeed); } }`;
        }).join(',\n');

        const towersArrayString = `export const towers: Tower[] = [\n${towersString}\n];`;

        const newFileContent = `${fileHeader}\n\n${towersArrayString}\n`;

        await writeFile(filePath, newFileContent, 'utf8');

        return { success: true };
    } catch (e: any) {
        console.error("Failed to save balancing data:", e);
        return { success: false, error: e.message };
    }
  }
);
