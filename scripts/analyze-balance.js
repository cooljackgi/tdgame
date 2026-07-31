const { fetchData } = require('./balance-api');
const {
  estimateWaveDurationSeconds,
  findMixedBurnUnits,
  getTierStats,
} = require('./balance-model');

async function analyzeBalance() {
  try {
    const data = await fetchData('/api/admin/firestore-read?mode=balancing');
    const waves = data.data.waves;
    const towers = data.data.towers;

    console.log('================= WELLEN-SCHWIERIGKEITSANSTIEG =================\n');
    waves.slice(0, 50).forEach((wave, index) => {
      const enemies = wave.enemies || {};
      const totalHealth = (enemies.count || 0) * (enemies.health || 0);
      const duration = estimateWaveDurationSeconds(wave);
      const requiredDps = duration > 0 ? totalHealth / duration : 0;
      console.log(
        `Wave ${index + 1}: ${enemies.count || 0} x ${enemies.type || '?'} ` +
        `(${enemies.health || 0} HP, ${Number(enemies.armor || 0).toFixed(0)} ARM) ` +
        `= ${totalHealth} HP | Basisfenster ${duration.toFixed(1)}s | ~${requiredDps.toFixed(0)} DPS`
      );
    });

    console.log('\n================= TOWER DPS ANALYSE (TOP 10) =================\n');
    const towerDps = towers
      .filter(tower => tower.damage > 0 && tower.attackSpeed > 0)
      .map(tower => ({
        name: tower.name,
        tier: tower.tier,
        cost: tower.cost,
        dps: tower.damage / (tower.attackSpeed / 1000),
      }))
      .sort((left, right) => right.dps - left.dps)
      .slice(0, 10);

    towerDps.forEach((tower, index) => {
      const efficiency = tower.cost > 0 ? tower.dps / tower.cost * 100 : 0;
      console.log(`${index + 1}. ${tower.name} (T${tower.tier}): ${tower.dps.toFixed(2)} DPS | Cost: ${tower.cost} | Effizienz: ${efficiency.toFixed(1)}`);
    });

    console.log('\n================= KOSTEN- UND DATENPRÜFUNG =================\n');
    console.log('Durchschnittliche Kosten pro Tier (alle Türme, einheitliche Berechnung):');
    for (const stats of getTierStats(towers)) {
      console.log(`  Tier ${stats.tier}: Ø${stats.average.toFixed(0)} (${stats.min}-${stats.max}, ${stats.count} Türme)`);
    }

    const burnUnits = findMixedBurnUnits(towers);
    if (burnUnits.mixed) {
      console.log('\n⚠️  Burn-Potency nutzt gemischte Einheiten:');
      console.log(`  Relativ zum Trefferschaden: ${burnUnits.relative.map(entry => `${entry.tower}=${entry.potency}`).join(', ')}`);
      console.log(`  Absoluter DPS-Wert: ${burnUnits.absolute.map(entry => `${entry.tower}=${entry.potency}`).join(', ')}`);
      console.log('  Die Laufzeit muss Werte > 1 als absoluten DPS-Wert behandeln.');
    }

    console.log('\n✅ Balancing-Analyse abgeschlossen');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exitCode = 1;
  }
}

analyzeBalance();
