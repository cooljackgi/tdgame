
import type { Wave, WaveEnemyData, EnemyType } from './types';

// Diese Formeln dienen jetzt als Basis für die *initiale* Generierung
// und als Referenz im UI. Die Wellen selbst werden als komplette Objekte gespeichert.
export const waveFormulaCoefficients = {
  "hp_base": 110,
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
        gepanzert: { armorFactor: 0.15, speedFactor: 0.8, healthFactor: 1.6, bountyFactor: 1.3, countFactor: 0.8 },
        heilend:   { armorFactor: 0.08, speedFactor: 1.0, healthFactor: 1.3, bountyFactor: 1.2, countFactor: 0.9 },
        boss:      { armorFactor: 0.25, speedFactor: 0.9, healthFactor: 12.0, bountyFactor: 8.0, countFactor: 1/15 },
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

export let waves: Wave[] = [
  {
    "waveNumber": 1,
    "enemies": {
      "type": "standard",
      "count": 10,
      "spawnDelay": 300,
      "health": 110,
      "armor": 6,
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
      "spawnDelay": 250,
      "health": 123,
      "armor": 6,
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
      "spawnDelay": 214.28571428571428,
      "health": 123,
      "armor": 2,
      "speed": 1.82,
      "damage": 12,
      "bounty": 11
    }
  },
  {
    "waveNumber": 4,
    "enemies": {
      "type": "standard",
      "count": 15,
      "spawnDelay": 200,
      "health": 155,
      "armor": 8,
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
      "spawnDelay": 230.76923076923077,
      "health": 298,
      "armor": 45,
      "speed": 0.98,
      "damage": 30,
      "bounty": 14
    }
  },
  {
    "waveNumber": 6,
    "enemies": {
      "type": "schnell",
      "count": 19,
      "spawnDelay": 157.89473684210525,
      "health": 165,
      "armor": 3,
      "speed": 1.84,
      "damage": 17,
      "bounty": 12
    }
  },
  {
    "waveNumber": 7,
    "enemies": {
      "type": "heilend",
      "count": 17,
      "spawnDelay": 176.47058823529412,
      "health": 299,
      "armor": 24,
      "speed": 1.24,
      "damage": 30,
      "bounty": 14
    }
  },
  {
    "waveNumber": 8,
    "enemies": {
      "type": "standard",
      "count": 21,
      "spawnDelay": 142.85714285714286,
      "health": 220,
      "armor": 11,
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
      "spawnDelay": 120,
      "health": 221,
      "armor": 4,
      "speed": 1.86,
      "damage": 22,
      "bounty": 13
    }
  },
  {
    "waveNumber": 10,
    "enemies": {
      "type": "boss",
      "count": 2,
      "spawnDelay": 1500,
      "health": 3137,
      "armor": 784,
      "speed": 1.09,
      "damage": 314,
      "bounty": 92
    }
  },
  {
    "waveNumber": 11,
    "enemies": {
      "type": "standard",
      "count": 25,
      "spawnDelay": 120,
      "health": 277,
      "armor": 14,
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
      "spawnDelay": 100,
      "health": 278,
      "armor": 6,
      "speed": 1.88,
      "damage": 28,
      "bounty": 14
    }
  },
  {
    "waveNumber": 13,
    "enemies": {
      "type": "standard",
      "count": 28,
      "spawnDelay": 107.14285714285714,
      "health": 348,
      "armor": 17,
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
      "spawnDelay": 115.38461538461539,
      "health": 557,
      "armor": 45,
      "speed": 1.28,
      "damage": 56,
      "bounty": 16
    }
  },
  {
    "waveNumber": 15,
    "enemies": {
      "type": "gepanzert",
      "count": 24,
      "spawnDelay": 125,
      "health": 673,
      "armor": 101,
      "speed": 1.03,
      "damage": 67,
      "bounty": 18
    }
  },
  {
    "waveNumber": 16,
    "enemies": {
      "type": "standard",
      "count": 33,
      "spawnDelay": 200,
      "health": 490,
      "armor": 25,
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
      "spawnDelay": 200,
      "health": 549,
      "armor": 27,
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
      "spawnDelay": 200,
      "health": 491,
      "armor": 10,
      "speed": 1.95,
      "damage": 49,
      "bounty": 16
    }
  },
  {
    "waveNumber": 19,
    "enemies": {
      "type": "gepanzert",
      "count": 30,
      "spawnDelay": 200,
      "health": 1060,
      "armor": 159,
      "speed": 1.06,
      "damage": 106,
      "bounty": 21
    }
  },
  {
    "waveNumber": 20,
    "enemies": {
      "type": "boss",
      "count": 3,
      "spawnDelay": 1000,
      "health": 8940,
      "armor": 2235,
      "speed": 1.18,
      "damage": 894,
      "bounty": 131
    }
  },
  {
    "waveNumber": 21,
    "enemies": {
      "type": "heilend",
      "count": 36,
      "spawnDelay": 200,
      "health": 1158,
      "armor": 93,
      "speed": 1.33,
      "damage": 116,
      "bounty": 18
    }
  },
  {
    "waveNumber": 22,
    "enemies": {
      "type": "standard",
      "count": 42,
      "spawnDelay": 200,
      "health": 1080,
      "armor": 54,
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
      "spawnDelay": 200,
      "health": 1210,
      "armor": 61,
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
      "spawnDelay": 200,
      "health": 1084,
      "armor": 22,
      "speed": 2.02,
      "damage": 108,
      "bounty": 17
    }
  },
  {
    "waveNumber": 25,
    "enemies": {
      "type": "gepanzert",
      "count": 37,
      "spawnDelay": 200,
      "health": 2277,
      "armor": 342,
      "speed": 1.08,
      "damage": 228,
      "bounty": 21
    }
  },
  {
    "waveNumber": 26,
    "enemies": {
      "type": "standard",
      "count": 48,
      "spawnDelay": 200,
      "health": 1700,
      "armor": 85,
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
      "spawnDelay": 200,
      "health": 1523,
      "armor": 30,
      "speed": 2.05,
      "damage": 152,
      "bounty": 18
    }
  },
  {
    "waveNumber": 28,
    "enemies": {
      "type": "heilend",
      "count": 45,
      "spawnDelay": 200,
      "health": 2559,
      "armor": 205,
      "speed": 1.37,
      "damage": 256,
      "bounty": 20
    }
  },
  {
    "waveNumber": 29,
    "enemies": {
      "type": "standard",
      "count": 52,
      "spawnDelay": 200,
      "health": 2388,
      "armor": 119,
      "speed": 1.38,
      "damage": 239,
      "bounty": 17
    }
  },
  {
    "waveNumber": 30,
    "enemies": {
      "type": "boss",
      "count": 4,
      "spawnDelay": 750,
      "health": 32100,
      "armor": 8025,
      "speed": 1.25,
      "damage": 3210,
      "bounty": 142
    }
  },
  {
    "waveNumber": 31,
    "enemies": {
      "type": "standard",
      "count": 55,
      "spawnDelay": 200,
      "health": 2996,
      "armor": 150,
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
      "spawnDelay": 200,
      "health": 3356,
      "armor": 168,
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
      "spawnDelay": 200,
      "health": 3007,
      "armor": 60,
      "speed": 2.11,
      "damage": 301,
      "bounty": 21
    }
  },
  {
    "waveNumber": 34,
    "enemies": {
      "type": "standard",
      "count": 60,
      "spawnDelay": 200,
      "health": 4209,
      "armor": 210,
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
      "spawnDelay": 200,
      "health": 5657,
      "armor": 453,
      "speed": 1.42,
      "damage": 566,
      "bounty": 24
    }
  },
  {
    "waveNumber": 36,
    "enemies": {
      "type": "schnell",
      "count": 69,
      "spawnDelay": 200,
      "health": 4224,
      "armor": 84,
      "speed": 2.14,
      "damage": 422,
      "bounty": 22
    }
  },
  {
    "waveNumber": 37,
    "enemies": {
      "type": "standard",
      "count": 64,
      "spawnDelay": 200,
      "health": 5914,
      "armor": 296,
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
      "spawnDelay": 200,
      "health": 6623,
      "armor": 331,
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
      "spawnDelay": 200,
      "health": 5934,
      "armor": 119,
      "speed": 2.18,
      "damage": 593,
      "bounty": 23
    }
  },
  {
    "waveNumber": 40,
    "enemies": {
      "type": "boss",
      "count": 5,
      "spawnDelay": 600,
      "health": 99697,
      "armor": 24924,
      "speed": 1.31,
      "damage": 9970,
      "bounty": 173
    }
  },
  {
    "waveNumber": 41,
    "enemies": {
      "type": "standard",
      "count": 70,
      "spawnDelay": 200,
      "health": 9305,
      "armor": 465,
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
      "spawnDelay": 200,
      "health": 12506,
      "armor": 1000,
      "speed": 1.47,
      "damage": 1251,
      "bounty": 27
    }
  },
  {
    "waveNumber": 43,
    "enemies": {
      "type": "standard",
      "count": 73,
      "spawnDelay": 200,
      "health": 11672,
      "armor": 584,
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
      "spawnDelay": 200,
      "health": 13073,
      "armor": 654,
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
      "spawnDelay": 200,
      "health": 21963,
      "armor": 3294,
      "speed": 1.2,
      "damage": 2196,
      "bounty": 31
    }
  },
  {
    "waveNumber": 46,
    "enemies": {
      "type": "standard",
      "count": 78,
      "spawnDelay": 200,
      "health": 16399,
      "armor": 820,
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
      "spawnDelay": 200,
      "health": 18367,
      "armor": 918,
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
      "spawnDelay": 200,
      "health": 16456,
      "armor": 329,
      "speed": 2.28,
      "damage": 1646,
      "bounty": 28
    }
  },
  {
    "waveNumber": 49,
    "enemies": {
      "type": "heilend",
      "count": 74,
      "spawnDelay": 200,
      "health": 27647,
      "armor": 2212,
      "speed": 1.52,
      "damage": 2765,
      "bounty": 31
    }
  },
  {
    "waveNumber": 50,
    "enemies": {
      "type": "boss",
      "count": 6,
      "spawnDelay": 500,
      "health": 309645,
      "armor": 77411,
      "speed": 1.38,
      "damage": 30965,
      "bounty": 211
    }
  }
];
