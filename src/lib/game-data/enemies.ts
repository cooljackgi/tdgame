
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

export let waves: Wave[] = [
  {
    "waveNumber": 1,
    "enemies": {
      "type": "standard",
      "count": 10,
      "spawnDelay": 1200,
      "health": 100,
      "armor": 0,
      "speed": 1,
      "damage": 10,
      "bounty": 10
    }
  },
  {
    "waveNumber": 2,
    "enemies": {
      "type": "standard",
      "count": 12,
      "spawnDelay": 1100,
      "health": 130,
      "armor": 5,
      "speed": 1.03,
      "damage": 11,
      "bounty": 11
    }
  },
  {
    "waveNumber": 3,
    "enemies": {
      "type": "standard",
      "count": 15,
      "spawnDelay": 900,
      "health": 160,
      "armor": 0,
      "speed": 1.15,
      "damage": 12,
      "bounty": 12
    }
  },
  {
    "waveNumber": 4,
    "enemies": {
      "type": "schnell",
      "count": 13,
      "spawnDelay": 800,
      "health": 180,
      "armor": 10,
      "speed": 1.6,
      "damage": 13,
      "bounty": 14
    }
  },
  {
    "waveNumber": 5,
    "enemies": {
      "type": "gepanzert",
      "count": 8,
      "spawnDelay": 1500,
      "health": 370,
      "armor": 65,
      "speed": 0.9,
      "damage": 20,
      "bounty": 21
    }
  },
  {
    "waveNumber": 6,
    "enemies": {
      "type": "schnell",
      "count": 18,
      "spawnDelay": 600,
      "health": 230,
      "armor": 10,
      "speed": 1.7,
      "damage": 15,
      "bounty": 14
    }
  },
  {
    "waveNumber": 7,
    "enemies": {
      "type": "heilend",
      "count": 10,
      "spawnDelay": 1800,
      "health": 450,
      "armor": 30,
      "speed": 1.16,
      "damage": 25,
      "bounty": 25
    }
  },
  {
    "waveNumber": 8,
    "enemies": {
      "type": "standard",
      "count": 20,
      "spawnDelay": 500,
      "health": 480,
      "armor": 25,
      "speed": 1.25,
      "damage": 22,
      "bounty": 16
    }
  },
  {
    "waveNumber": 9,
    "enemies": {
      "type": "schnell",
      "count": 22,
      "spawnDelay": 400,
      "health": 350,
      "armor": 15,
      "speed": 1.8,
      "damage": 18,
      "bounty": 18
    }
  },
  {
    "waveNumber": 10,
    "enemies": {
      "type": "boss",
      "count": 1,
      "spawnDelay": 1000,
      "health": 6500,
      "armor": 100,
      "speed": 0.9,
      "damage": 180,
      "bounty": 250
    }
  },
  {
    "waveNumber": 11,
    "enemies": {
      "type": "gepanzert",
      "count": 12,
      "spawnDelay": 1200,
      "health": 850,
      "armor": 160,
      "speed": 0.92,
      "damage": 40,
      "bounty": 30
    }
  },
  {
    "waveNumber": 12,
    "enemies": {
      "type": "standard",
      "count": 25,
      "spawnDelay": 400,
      "health": 750,
      "armor": 40,
      "speed": 1.3,
      "damage": 30,
      "bounty": 22
    }
  },
  {
    "waveNumber": 13,
    "enemies": {
      "type": "schnell",
      "count": 28,
      "spawnDelay": 350,
      "health": 500,
      "armor": 20,
      "speed": 1.95,
      "damage": 25,
      "bounty": 24
    }
  },
  {
    "waveNumber": 14,
    "enemies": {
      "type": "heilend",
      "count": 15,
      "spawnDelay": 1500,
      "health": 1000,
      "armor": 50,
      "speed": 1.3,
      "damage": 40,
      "bounty": 40
    }
  },
  {
    "waveNumber": 15,
    "enemies": {
      "type": "gepanzert",
      "count": 18,
      "spawnDelay": 1000,
      "health": 1200,
      "armor": 200,
      "speed": 0.95,
      "damage": 50,
      "bounty": 45
    }
  },
  {
    "waveNumber": 16,
    "enemies": {
      "type": "standard",
      "count": 28,
      "spawnDelay": 300,
      "health": 1100,
      "armor": 60,
      "speed": 1.4,
      "damage": 45,
      "bounty": 28
    }
  },
  {
    "waveNumber": 17,
    "enemies": {
      "type": "schnell",
      "count": 35,
      "spawnDelay": 300,
      "health": 700,
      "armor": 30,
      "speed": 2,
      "damage": 35,
      "bounty": 30
    }
  },
  {
    "waveNumber": 18,
    "enemies": {
      "type": "gepanzert",
      "count": 20,
      "spawnDelay": 900,
      "health": 1600,
      "armor": 250,
      "speed": 1,
      "damage": 60,
      "bounty": 55
    }
  },
  {
    "waveNumber": 19,
    "enemies": {
      "type": "heilend",
      "count": 20,
      "spawnDelay": 1200,
      "health": 1500,
      "armor": 80,
      "speed": 1.4,
      "damage": 50,
      "bounty": 50
    }
  },
  {
    "waveNumber": 20,
    "enemies": {
      "type": "boss",
      "count": 1,
      "spawnDelay": 3000,
      "health": 18000,
      "armor": 450,
      "speed": 1,
      "damage": 300,
      "bounty": 500
    }
  },
  {
    "waveNumber": 21,
    "enemies": {
      "type": "heilend",
      "count": 36,
      "spawnDelay": 200,
      "health": 1158,
      "armor": 116,
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
      "armor": 455,
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
      "armor": 256,
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
      "armor": 9630,
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
      "armor": 566,
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
      "armor": 29909,
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
      "armor": 1251,
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
      "armor": 4393,
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
      "armor": 2765,
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
      "armor": 92894,
      "speed": 1.38,
      "damage": 30965,
      "bounty": 211
    }
  }
];
