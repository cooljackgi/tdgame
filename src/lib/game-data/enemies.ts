
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
  "spawn_delay_base": 8000,
  "spawn_delay_min": 250
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
      spawnDelay: Math.max(f.spawn_delay_min, f.spawn_delay_base / finalCount),
      health: finalHealth,
      armor: Math.round(finalHealth * params.armorFactor * 0.5), // Reduced armor globally
      speed: parseFloat((speed * params.speedFactor).toFixed(2)),
      damage: Math.round(finalHealth / 10), // Damage is relative to health
      bounty: Math.round(bounty * params.bountyFactor),
    };

    return { waveNumber, enemies };
};

export let waves: Wave[] = [
  {
    "waveNumber": 1,
    "enemies": {
      "type": "standard",
      "count": 10,
      "spawnDelay": 800,
      "health": 110,
      "armor": 3,
      "speed": 1.2,
      "damage": 11,
      "bounty": 10
    }
  },
  {
    "waveNumber": 2,
    "enemies": {
      "type": "standard",
      "count": 12,
      "spawnDelay": 667,
      "health": 123,
      "armor": 3,
      "speed": 1.21,
      "damage": 12,
      "bounty": 10
    }
  },
  {
    "waveNumber": 3,
    "enemies": {
      "type": "schnell",
      "count": 14,
      "spawnDelay": 571,
      "health": 110,
      "armor": 1,
      "speed": 1.82,
      "damage": 11,
      "bounty": 11
    }
  },
  {
    "waveNumber": 4,
    "enemies": {
      "type": "standard",
      "count": 15,
      "spawnDelay": 533,
      "health": 155,
      "armor": 4,
      "speed": 1.22,
      "damage": 16,
      "bounty": 11
    }
  },
  {
    "waveNumber": 5,
    "enemies": {
      "type": "gepanzert",
      "count": 13,
      "spawnDelay": 615,
      "health": 266,
      "armor": 27,
      "speed": 0.98,
      "damage": 27,
      "bounty": 14
    }
  },
  {
    "waveNumber": 6,
    "enemies": {
      "type": "schnell",
      "count": 19,
      "spawnDelay": 421,
      "health": 148,
      "armor": 1,
      "speed": 1.84,
      "damage": 15,
      "bounty": 12
    }
  },
  {
    "waveNumber": 7,
    "enemies": {
      "type": "heilend",
      "count": 17,
      "spawnDelay": 471,
      "health": 267,
      "armor": 13,
      "speed": 1.24,
      "damage": 27,
      "bounty": 14
    }
  },
  {
    "waveNumber": 8,
    "enemies": {
      "type": "standard",
      "count": 21,
      "spawnDelay": 381,
      "health": 220,
      "armor": 6,
      "speed": 1.25,
      "damage": 22,
      "bounty": 12
    }
  },
  {
    "waveNumber": 9,
    "enemies": {
      "type": "schnell",
      "count": 25,
      "spawnDelay": 320,
      "health": 198,
      "armor": 2,
      "speed": 1.86,
      "damage": 20,
      "bounty": 13
    }
  },
  {
    "waveNumber": 10,
    "enemies": {
      "type": "boss",
      "count": 1,
      "spawnDelay": 8000,
      "health": 2799,
      "armor": 420,
      "speed": 1.09,
      "damage": 280,
      "bounty": 92
    }
  },
  {
    "waveNumber": 11,
    "enemies": {
      "type": "standard",
      "count": 25,
      "spawnDelay": 320,
      "health": 277,
      "armor": 7,
      "speed": 1.26,
      "damage": 28,
      "bounty": 12
    }
  },
  {
    "waveNumber": 12,
    "enemies": {
      "type": "schnell",
      "count": 30,
      "spawnDelay": 267,
      "health": 249,
      "armor": 2,
      "speed": 1.88,
      "damage": 25,
      "bounty": 14
    }
  },
  {
    "waveNumber": 13,
    "enemies": {
      "type": "standard",
      "count": 28,
      "spawnDelay": 286,
      "health": 348,
      "armor": 9,
      "speed": 1.28,
      "damage": 35,
      "bounty": 13
    }
  },
  {
    "waveNumber": 14,
    "enemies": {
      "type": "heilend",
      "count": 26,
      "spawnDelay": 308,
      "health": 498,
      "armor": 25,
      "speed": 1.28,
      "damage": 50,
      "bounty": 16
    }
  },
  {
    "waveNumber": 15,
    "enemies": {
      "type": "gepanzert",
      "count": 24,
      "spawnDelay": 333,
      "health": 601,
      "armor": 60,
      "speed": 1.03,
      "damage": 60,
      "bounty": 18
    }
  },
  {
    "waveNumber": 16,
    "enemies": {
      "type": "standard",
      "count": 33,
      "spawnDelay": 250,
      "health": 490,
      "armor": 12,
      "speed": 1.3,
      "damage": 49,
      "bounty": 14
    }
  },
  {
    "waveNumber": 17,
    "enemies": {
      "type": "standard",
      "count": 34,
      "spawnDelay": 250,
      "health": 549,
      "armor": 14,
      "speed": 1.31,
      "damage": 55,
      "bounty": 14
    }
  },
  {
    "waveNumber": 18,
    "enemies": {
      "type": "schnell",
      "count": 40,
      "spawnDelay": 250,
      "health": 439,
      "armor": 4,
      "speed": 1.95,
      "damage": 44,
      "bounty": 16
    }
  },
  {
    "waveNumber": 19,
    "enemies": {
      "type": "gepanzert",
      "count": 30,
      "spawnDelay": 267,
      "health": 947,
      "armor": 95,
      "speed": 1.06,
      "damage": 95,
      "bounty": 21
    }
  },
  {
    "waveNumber": 20,
    "enemies": {
      "type": "boss",
      "count": 2,
      "spawnDelay": 4000,
      "health": 7979,
      "armor": 1197,
      "speed": 1.18,
      "damage": 798,
      "bounty": 131
    }
  },
  {
    "waveNumber": 21,
    "enemies": {
      "type": "heilend",
      "count": 36,
      "spawnDelay": 250,
      "health": 1034,
      "armor": 52,
      "speed": 1.33,
      "damage": 103,
      "bounty": 18
    }
  },
  {
    "waveNumber": 22,
    "enemies": {
      "type": "standard",
      "count": 42,
      "spawnDelay": 250,
      "health": 1080,
      "armor": 27,
      "speed": 1.33,
      "damage": 108,
      "bounty": 15
    }
  },
  {
    "waveNumber": 23,
    "enemies": {
      "type": "standard",
      "count": 43,
      "spawnDelay": 250,
      "health": 1210,
      "armor": 30,
      "speed": 1.34,
      "damage": 121,
      "bounty": 15
    }
  },
  {
    "waveNumber": 24,
    "enemies": {
      "type": "schnell",
      "count": 49,
      "spawnDelay": 250,
      "health": 967,
      "armor": 10,
      "speed": 2.02,
      "damage": 97,
      "bounty": 17
    }
  },
  {
    "waveNumber": 25,
    "enemies": {
      "type": "gepanzert",
      "count": 37,
      "spawnDelay": 250,
      "health": 2024,
      "armor": 202,
      "speed": 1.08,
      "damage": 202,
      "bounty": 21
    }
  },
  {
    "waveNumber": 26,
    "enemies": {
      "type": "standard",
      "count": 48,
      "spawnDelay": 250,
      "health": 1700,
      "armor": 43,
      "speed": 1.36,
      "damage": 170,
      "bounty": 16
    }
  },
  {
    "waveNumber": 27,
    "enemies": {
      "type": "schnell",
      "count": 54,
      "spawnDelay": 250,
      "health": 1359,
      "armor": 14,
      "speed": 2.05,
      "damage": 136,
      "bounty": 18
    }
  },
  {
    "waveNumber": 28,
    "enemies": {
      "type": "heilend",
      "count": 45,
      "spawnDelay": 250,
      "health": 2284,
      "armor": 114,
      "speed": 1.37,
      "damage": 228,
      "bounty": 20
    }
  },
  {
    "waveNumber": 29,
    "enemies": {
      "type": "standard",
      "count": 52,
      "spawnDelay": 250,
      "health": 2388,
      "armor": 60,
      "speed": 1.38,
      "damage": 239,
      "bounty": 17
    }
  },
  {
    "waveNumber": 30,
    "enemies": {
      "type": "boss",
      "count": 3,
      "spawnDelay": 2667,
      "health": 28522,
      "armor": 4278,
      "speed": 1.25,
      "damage": 2852,
      "bounty": 142
    }
  },
  {
    "waveNumber": 31,
    "enemies": {
      "type": "standard",
      "count": 55,
      "spawnDelay": 250,
      "health": 2996,
      "armor": 75,
      "speed": 1.39,
      "damage": 300,
      "bounty": 18
    }
  },
  {
    "waveNumber": 32,
    "enemies": {
      "type": "standard",
      "count": 57,
      "spawnDelay": 250,
      "health": 3356,
      "armor": 84,
      "speed": 1.4,
      "damage": 336,
      "bounty": 18
    }
  },
  {
    "waveNumber": 33,
    "enemies": {
      "type": "schnell",
      "count": 64,
      "spawnDelay": 250,
      "health": 2682,
      "armor": 27,
      "speed": 2.11,
      "damage": 268,
      "bounty": 21
    }
  },
  {
    "waveNumber": 34,
    "enemies": {
      "type": "standard",
      "count": 60,
      "spawnDelay": 250,
      "health": 4209,
      "armor": 105,
      "speed": 1.41,
      "damage": 421,
      "bounty": 19
    }
  },
  {
    "waveNumber": 35,
    "enemies": {
      "type": "heilend",
      "count": 55,
      "spawnDelay": 250,
      "health": 5048,
      "armor": 252,
      "speed": 1.42,
      "damage": 505,
      "bounty": 24
    }
  },
  {
    "waveNumber": 36,
    "enemies": {
      "type": "schnell",
      "count": 69,
      "spawnDelay": 250,
      "health": 3768,
      "armor": 38,
      "speed": 2.14,
      "damage": 377,
      "bounty": 22
    }
  },
  {
    "waveNumber": 37,
    "enemies": {
      "type": "standard",
      "count": 64,
      "spawnDelay": 250,
      "health": 5914,
      "armor": 148,
      "speed": 1.44,
      "damage": 591,
      "bounty": 20
    }
  },
  {
    "waveNumber": 38,
    "enemies": {
      "type": "standard",
      "count": 66,
      "spawnDelay": 250,
      "health": 6623,
      "armor": 166,
      "speed": 1.44,
      "damage": 662,
      "bounty": 21
    }
  },
  {
    "waveNumber": 39,
    "enemies": {
      "type": "schnell",
      "count": 74,
      "spawnDelay": 250,
      "health": 5293,
      "armor": 53,
      "speed": 2.18,
      "damage": 529,
      "bounty": 23
    }
  },
  {
    "waveNumber": 40,
    "enemies": {
      "type": "boss",
      "count": 4,
      "spawnDelay": 2000,
      "health": 88915,
      "armor": 13337,
      "speed": 1.31,
      "damage": 8892,
      "bounty": 173
    }
  },
  {
    "waveNumber": 41,
    "enemies": {
      "type": "standard",
      "count": 70,
      "spawnDelay": 250,
      "health": 9305,
      "armor": 233,
      "speed": 1.46,
      "damage": 931,
      "bounty": 22
    }
  },
  {
    "waveNumber": 42,
    "enemies": {
      "type": "heilend",
      "count": 64,
      "spawnDelay": 250,
      "health": 11158,
      "armor": 558,
      "speed": 1.47,
      "damage": 1116,
      "bounty": 27
    }
  },
  {
    "waveNumber": 43,
    "enemies": {
      "type": "standard",
      "count": 73,
      "spawnDelay": 250,
      "health": 11672,
      "armor": 292,
      "speed": 1.48,
      "damage": 1167,
      "bounty": 23
    }
  },
  {
    "waveNumber": 44,
    "enemies": {
      "type": "standard",
      "count": 75,
      "spawnDelay": 250,
      "health": 13073,
      "armor": 327,
      "speed": 1.49,
      "damage": 1307,
      "bounty": 23
    }
  },
  {
    "waveNumber": 45,
    "enemies": {
      "type": "gepanzert",
      "count": 61,
      "spawnDelay": 250,
      "health": 19597,
      "armor": 1960,
      "speed": 1.2,
      "damage": 1960,
      "bounty": 31
    }
  },
  {
    "waveNumber": 46,
    "enemies": {
      "type": "standard",
      "count": 78,
      "spawnDelay": 250,
      "health": 16399,
      "armor": 410,
      "speed": 1.5,
      "damage": 1640,
      "bounty": 24
    }
  },
  {
    "waveNumber": 47,
    "enemies": {
      "type": "standard",
      "count": 79,
      "spawnDelay": 250,
      "health": 18367,
      "armor": 459,
      "speed": 1.51,
      "damage": 1837,
      "bounty": 25
    }
  },
  {
    "waveNumber": 48,
    "enemies": {
      "type": "schnell",
      "count": 89,
      "spawnDelay": 250,
      "health": 14682,
      "armor": 147,
      "speed": 2.28,
      "damage": 1468,
      "bounty": 28
    }
  },
  {
    "waveNumber": 49,
    "enemies": {
      "type": "heilend",
      "count": 74,
      "spawnDelay": 250,
      "health": 24669,
      "armor": 1233,
      "speed": 1.52,
      "damage": 2467,
      "bounty": 31
    }
  },
  {
    "waveNumber": 50,
    "enemies": {
      "type": "boss",
      "count": 6,
      "spawnDelay": 1333,
      "health": 276226,
      "armor": 41434,
      "speed": 1.38,
      "damage": 27623,
      "bounty": 211
    }
  }
];

