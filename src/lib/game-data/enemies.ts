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
  "bounty_exponent": 1.02,
  "spawn_delay_base": 800,
  "spawn_delay_min": 200,
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

    // Rüstungsfaktor für gepanzerte Gegner reduziert
    const baseParams = {
        standard:  { armorFactor: 0.05, speedFactor: 1.0, healthFactor: 1.0, bountyFactor: 1.0, countFactor: 1.0 },
        schnell:   { armorFactor: 0.02, speedFactor: 1.5, healthFactor: 0.8, bountyFactor: 1.1, countFactor: 1.1 },
        gepanzert: { armorFactor: 0.12, speedFactor: 0.8, healthFactor: 1.5, bountyFactor: 1.4, countFactor: 0.8 }, // armorFactor von 0.20 auf 0.12, bounty von 1.3 auf 1.4
        heilend:   { armorFactor: 0.10, speedFactor: 1.0, healthFactor: 1.2, bountyFactor: 1.2, countFactor: 0.9 },
        boss:      { armorFactor: 0.15, speedFactor: 0.9, healthFactor: 12.0, bountyFactor: 8.0, countFactor: 1/15 }, // Boss-Rüstung auch leicht reduziert
    };
    
    const params = baseParams[type];
    
    const finalCount = Math.max(1, Math.round(count * params.countFactor));
    const finalHealth = Math.round(hp * params.healthFactor);
    
    const enemies: WaveEnemyData = {
      type: type,
      count: finalCount,
      spawnDelay: Math.max(formulas.spawn_delay_min, formulas.spawn_delay_base / (1 + 0.1 * (waveNumber-1))), // Spawn-Verzögerung skaliert jetzt
      health: finalHealth,
      armor: Math.round(finalHealth * params.armorFactor),
      speed: parseFloat((speed * params.speedFactor).toFixed(2)),
      damage: Math.round(finalHealth / 10), // Damage is relative to health
      bounty: Math.round(bounty * params.bountyFactor),
    };

    return { waveNumber, enemies };
};

export let waves: Wave[] = Array.from({ length: 50 }, (_, i) => generateProceduralWave(i + 1, waveFormulaCoefficients));
