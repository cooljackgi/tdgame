const { fetchData } = require('./balance-api');
const {
  NORMAL_START_RESOURCES,
  PASSIVE_INCOME_PER_SECOND,
  average,
  median,
  buildEconomyTimeline,
  estimateTowerDps,
  getAcquisitionCosts,
  getTierStats,
} = require('./balance-model');

async function fullEconomyAnalysis() {
  try {
    console.log('📖 Lade Balancing-Daten...\n');
    const data = await fetchData('/api/admin/firestore-read?mode=balancing');
    const waves = data.data.waves.slice(0, 50);
    const towers = data.data.towers;
    const timeline = buildEconomyTimeline(waves);

    console.log('================= RESSOURCEN-WIRTSCHAFT =================\n');
    console.log(`Normal: ${NORMAL_START_RESOURCES} Startressourcen + ${PASSIVE_INCOME_PER_SECOND}/s + Gegner-Bounty`);
    console.log('Die alte goldReward-Eigenschaft wird nicht verwendet, weil das Spiel bei Kills bounty auszahlt.\n');
    console.log('Erste 10 Wellen (Brutto-Budget ohne Ausgaben):');
    timeline.slice(0, 10).forEach(entry => {
      console.log(
        `  Wave ${entry.wave}: vorher ${entry.beforeWave.toFixed(0)} | ` +
        `Bounty ${entry.bounty.toFixed(0)} | Dauer ~${entry.waveSeconds.toFixed(1)}s | danach ${entry.afterWave.toFixed(0)}`
      );
    });

    console.log('\nRessourcen-Meilensteine:');
    [5, 10, 15, 20, 25, 30, 40, 50].forEach(waveNumber => {
      const entry = timeline[waveNumber - 1];
      if (entry) console.log(`  Vor Wave ${waveNumber}: ${entry.beforeWave.toFixed(0)} | Nach Wave: ${entry.afterWave.toFixed(0)}`);
    });

    console.log('\n================= TOWER- UND UPGRADE-KOSTEN =================\n');
    const acquisitionCosts = getAcquisitionCosts(towers);
    console.log('Angezeigter Zielwert / günstigster kumulierter Bau- und Upgradeaufwand:');
    const displayedStats = getTierStats(towers);
    const acquisitionStats = getTierStats(towers, tower => acquisitionCosts.get(tower.id));
    for (const displayed of displayedStats) {
      const acquisition = acquisitionStats.find(entry => entry.tier === displayed.tier);
      console.log(
        `  Tier ${displayed.tier}: Ziel Ø${displayed.average.toFixed(0)} | ` +
        `Erwerb Ø${acquisition.average.toFixed(0)} (Median ${acquisition.median.toFixed(0)})`
      );
    }

    console.log('\n================= ARMOR-BEREINIGTE WAVE-10-PRÜFUNG =================\n');
    const wave10 = waves[9];
    const enemies = wave10.enemies || {};
    const budgetBeforeWave10 = timeline[9].beforeWave;
    const tier2 = towers.filter(tower => tower.tier === 2);
    const tier2Costs = tier2.map(tower => acquisitionCosts.get(tower.id));
    const medianTier2Cost = median(tier2Costs);
    const affordableTier2 = Math.floor(budgetBeforeWave10 / medianTier2Cost);
    const tier2Dps = tier2.map(tower => ({
      name: tower.name,
      ...estimateTowerDps(tower, enemies.armor || 0, enemies.count || 1),
    }));
    const medianEffectiveDps = median(tier2Dps.map(tower => tower.total));
    const averageEffectiveDps = average(tier2Dps.map(tower => tower.total));
    const requiredDps = (enemies.count * enemies.health) / timeline[9].waveSeconds;
    const portfolioDps = affordableTier2 * medianEffectiveDps;
    const engagementMultiplier = portfolioDps > 0 ? requiredDps / portfolioDps : Infinity;

    console.log(`Budget vor Wave 10: ${budgetBeforeWave10.toFixed(0)} (inkl. Startkapital und passivem Einkommen)`);
    console.log(`Median-Erwerbskosten Tier 2: ${medianTier2Cost.toFixed(0)} → theoretisch bis zu ${affordableTier2} Türme`);
    console.log(`Tier-2-DPS gegen ${enemies.armor} Rüstung: Median ${medianEffectiveDps.toFixed(1)}, Ø${averageEffectiveDps.toFixed(1)}`);
    console.log(`Theoretisches Portfolio: ~${portfolioDps.toFixed(0)} DPS vs. ~${requiredDps.toFixed(0)} benötigte DPS`);
    console.log(`Benötigte Verlängerung gegenüber dem Basispfad: ~${engagementMultiplier.toFixed(1)}x`);

    console.log('\nEffektivste Tier-2-Türme gegen Wave 10:');
    tier2Dps.sort((left, right) => right.total - left.total).slice(0, 5).forEach((tower, index) => {
      console.log(`  ${index + 1}. ${tower.name}: ${tower.total.toFixed(1)} DPS (${tower.direct.toFixed(1)} direkt + ${tower.effects.toFixed(1)} Effekte)`);
    });

    console.log('\n================= BALANCING-FAZIT =================\n');
    console.log('Die Rechnung ist eine Brutto-Obergrenze: Bauzeiten, Reichweite, Elemente und tatsächliches Mazing reduzieren die nutzbare Leistung.');
    if (engagementMultiplier < 0.5) {
      console.log('⚠️  Hohes Risiko für eine zu leichte frühe Spielphase – Effekt- und Upgradeökonomie prüfen.');
    } else if (engagementMultiplier <= 1.5) {
      console.log('✓ Wave 10 ist bereits mit einem kurzen Weg plausibel schaffbar.');
    } else if (engagementMultiplier <= 4.5) {
      console.log('✓ Wave 10 verlangt deutliches Mazing, liegt aber noch im vorgesehenen Spielfeld-Korridor.');
    } else {
      console.log('⚠️  Wave 10 verlangt nahezu maximales Mazing; mit echten Spielständen weiter beobachten.');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exitCode = 1;
  }
}

fullEconomyAnalysis();
