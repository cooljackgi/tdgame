const NORMAL_START_RESOURCES = 1250;
const PASSIVE_INCOME_PER_SECOND = 5;
const INTERMISSION_SECONDS = 15;
const BASE_PATH_STEPS = 22;
const UPGRADE_REFUND_RATE = 0.75;

const asNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const median = values => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function getTierStats(towers, valueSelector = tower => asNumber(tower.cost)) {
  const stats = new Map();
  for (const tower of towers) {
    const tier = asNumber(tower.tier);
    const value = valueSelector(tower);
    if (!stats.has(tier)) stats.set(tier, []);
    stats.get(tier).push(value);
  }
  return [...stats.entries()]
    .sort(([left], [right]) => left - right)
    .map(([tier, values]) => ({
      tier,
      average: average(values),
      median: median(values),
      min: Math.min(...values),
      max: Math.max(...values),
      count: values.length,
    }));
}

function getAcquisitionCosts(towers) {
  const byId = new Map(towers.map(tower => [tower.id, tower]));
  const costs = new Map();

  for (const tower of towers.filter(tower => tower.isBase)) {
    costs.set(tower.id, asNumber(tower.cost));
  }

  for (let pass = 0; pass < towers.length; pass++) {
    let changed = false;
    for (const parent of towers) {
      const parentPathCost = costs.get(parent.id);
      if (parentPathCost == null) continue;
      for (const childId of parent.upgradesTo || []) {
        const child = byId.get(childId);
        if (!child) continue;
        const upgradeCost = Math.max(0, asNumber(child.cost) - Math.floor(asNumber(parent.cost) * UPGRADE_REFUND_RATE));
        const candidate = parentPathCost + upgradeCost;
        if (!costs.has(childId) || candidate < costs.get(childId)) {
          costs.set(childId, candidate);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  return new Map(towers.map(tower => [tower.id, costs.get(tower.id) ?? asNumber(tower.cost)]));
}

function estimateWaveDurationSeconds(wave) {
  const enemies = wave.enemies || {};
  const count = Math.max(1, asNumber(enemies.count, 1));
  const spawnSeconds = Math.max(0, count - 1) * asNumber(enemies.spawnDelay, 0) / 1000;
  const travelSeconds = BASE_PATH_STEPS / Math.max(0.1, asNumber(enemies.speed, 1));
  return spawnSeconds + travelSeconds;
}

function getWaveBounty(wave) {
  const enemies = wave.enemies || {};
  return asNumber(enemies.count) * asNumber(enemies.bounty);
}

function buildEconomyTimeline(waves) {
  let cumulativeBounty = 0;
  let cumulativePassive = 0;

  return waves.map((wave, index) => {
    const waveSeconds = estimateWaveDurationSeconds(wave);
    const intermissionIncome = INTERMISSION_SECONDS * PASSIVE_INCOME_PER_SECOND;
    const beforeWave = NORMAL_START_RESOURCES + cumulativeBounty + cumulativePassive + intermissionIncome;
    cumulativePassive += intermissionIncome + waveSeconds * PASSIVE_INCOME_PER_SECOND;
    const bounty = getWaveBounty(wave);
    cumulativeBounty += bounty;
    return {
      wave: asNumber(wave.waveNumber, index + 1),
      bounty,
      waveSeconds,
      beforeWave,
      afterWave: NORMAL_START_RESOURCES + cumulativeBounty + cumulativePassive,
      cumulativeBounty,
      cumulativePassive,
    };
  });
}

function damageAfterArmor(amount, armor) {
  const rawDamage = Math.max(0, asNumber(amount));
  const calculatedDamage = Math.floor(rawDamage - Math.max(0, asNumber(armor)));
  const minimumDamage = Math.max(1, Math.floor(rawDamage * 0.1));
  return Math.max(calculatedDamage, minimumDamage);
}

function resolveBurnDps(potency, hitDamage) {
  const value = asNumber(potency);
  return value <= 1 ? value * hitDamage : value;
}

function estimateTowerDps(tower, armor, targetCount = 1) {
  const attackSpeed = asNumber(tower.attackSpeed);
  if (attackSpeed <= 0) return { direct: 0, effects: 0, total: 0 };

  const attacksPerSecond = 1000 / attackSpeed;
  const effects = Array.isArray(tower.effects) ? tower.effects : [];
  const crit = effects.find(effect => effect.type === 'crit');
  const critChance = Math.max(0, Math.min(1, asNumber(crit?.chance)));
  const critMultiplier = crit ? Math.max(1, asNumber(crit.potency, 2)) : 1;
  const normalHit = damageAfterArmor(tower.damage, armor);
  const criticalHit = damageAfterArmor(asNumber(tower.damage) * critMultiplier, armor);
  const expectedPrimaryHit = normalHit * (1 - critChance) + criticalHit * critChance;
  const multishot = effects.find(effect => effect.type === 'multishot');
  const primaryTargets = multishot ? Math.min(targetCount, Math.max(1, asNumber(multishot.targets, 1))) : 1;
  let directPerAttack = expectedPrimaryHit * primaryTargets;

  const chain = effects.find(effect => effect.type === 'chain');
  if (chain) {
    const bounces = Math.min(Math.max(0, targetCount - 1), Math.max(0, asNumber(chain.bounces)));
    for (let index = 1; index <= bounces; index++) {
      directPerAttack += damageAfterArmor(
        asNumber(tower.damage) * Math.pow(asNumber(chain.potency, 0.7), index),
        armor
      );
    }
  }

  const splash = effects.find(effect => effect.type === 'splash');
  if (splash && targetCount > 1) {
    const estimatedSecondaryTargets = Math.min(targetCount - 1, Math.max(1, Math.round(asNumber(splash.radius, 1))));
    directPerAttack += estimatedSecondaryTargets * damageAfterArmor(
      asNumber(tower.damage) * asNumber(splash.potency, 0.5),
      armor
    );
  }

  let effectDps = 0;
  for (const effect of effects) {
    if (effect.type === 'burn') {
      const chance = Math.max(0, Math.min(1, asNumber(effect.chance, 1)));
      const durationSeconds = Math.max(0, asNumber(effect.duration)) / 1000;
      effectDps += attacksPerSecond * primaryTargets * chance * resolveBurnDps(effect.potency, asNumber(tower.damage)) * durationSeconds;
    }
    if (effect.type === 'persistent_cloud' && ['burn', 'poison'].includes(effect.cloudEffect)) {
      effectDps += asNumber(effect.potency);
    }
  }

  const direct = directPerAttack * attacksPerSecond;
  return { direct, effects: effectDps, total: direct + effectDps };
}

function findMixedBurnUnits(towers) {
  const relative = [];
  const absolute = [];
  for (const tower of towers) {
    for (const effect of tower.effects || []) {
      if (effect.type !== 'burn') continue;
      (asNumber(effect.potency) <= 1 ? relative : absolute).push({ tower: tower.name, potency: asNumber(effect.potency) });
    }
  }
  return { relative, absolute, mixed: relative.length > 0 && absolute.length > 0 };
}

module.exports = {
  NORMAL_START_RESOURCES,
  PASSIVE_INCOME_PER_SECOND,
  INTERMISSION_SECONDS,
  average,
  median,
  getTierStats,
  getAcquisitionCosts,
  estimateWaveDurationSeconds,
  getWaveBounty,
  buildEconomyTimeline,
  damageAfterArmor,
  resolveBurnDps,
  estimateTowerDps,
  findMixedBurnUnits,
};
