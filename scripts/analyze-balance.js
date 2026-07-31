const { fetchData } = require('./balance-api');

async function analyzeBalance() {
  try {
    const data = await fetchData('/api/admin/firestore-read?mode=balancing');
    const waves = data.data.waves;
    const towers = data.data.towers;

    console.log('================= WELLEN-SCHWIERIGKEITSANSTIEG =================\n');

    waves.slice(0, 50).forEach((wave, idx) => {
      const w = wave.enemies || {};
      const totalHealthPerWave = (w.count || 0) * (w.health || 0);
      const armor = w.armor || 0;
      const flatArmor = Number(armor).toFixed(0);
      console.log(`Wave ${idx + 1}: ${w.count || 0} x ${w.type || '?'} (${w.health || 0} HP, ${flatArmor} ARM) = ${totalHealthPerWave} HP/Welle`);
    });

    console.log('\n================= TOWER DPS ANALYSE (TOP 10) =================\n');

    const towerDps = towers
      .filter(t => t.damage > 0)
      .map(t => ({
        name: t.name,
        tier: t.tier,
        damage: t.damage,
        attackSpeed: t.attackSpeed,
        cost: t.cost,
        dps: t.damage / (t.attackSpeed / 1000)
      }))
      .sort((a, b) => b.dps - a.dps)
      .slice(0, 10);

    towerDps.forEach((t, idx) => {
      const efficiency = (t.dps / t.cost * 100).toFixed(1);
      console.log(`${idx + 1}. ${t.name} (T${t.tier}): ${t.dps.toFixed(2)} DPS | Cost: ${t.cost} | Effizienz: ${efficiency}`);
    });

    console.log('\n================= PROBLEM-ANALYSE =================\n');

    // Check for cost jumps
    const costByTier = {};
    towers.forEach(t => {
      if (!costByTier[t.tier]) costByTier[t.tier] = [];
      costByTier[t.tier].push(t.cost);
    });

    console.log('Durchschnittliche Kosten pro Tier:');
    Object.keys(costByTier).sort((a, b) => a - b).forEach(tier => {
      const costs = costByTier[tier];
      const avg = (costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(0);
      const min = Math.min(...costs);
      const max = Math.max(...costs);
      console.log(`  Tier ${tier}: Ø${avg} (${min}-${max})`);
    });

    console.log('\n✅ Balancing-Analyse abgeschlossen');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exitCode = 1;
  }
}

analyzeBalance();
