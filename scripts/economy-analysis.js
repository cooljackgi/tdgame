const { fetchData } = require('./balance-api');

async function fullEconomyAnalysis() {
  try {
    console.log('📖 Lade Balancing-Daten...\n');
    const data = await fetchData('/api/admin/firestore-read?mode=balancing');
    const waves = data.data.waves;
    const towers = data.data.towers;

    console.log('================= GOLD-WIRTSCHAFT =================\n');

    let totalGold = 0;
    const goldPerWave = [];
    
    for (let i = 0; i < Math.min(50, waves.length); i++) {
      const wave = waves[i];
      const enemies = wave.enemies || {};
      const count = enemies.count || 0;
      const goldPerEnemy = enemies.goldReward || 10; // Default falls nicht definiert
      const waveGold = count * goldPerEnemy;
      totalGold += waveGold;
      goldPerWave.push({ wave: i + 1, gold: waveGold, total: totalGold });
    }

    console.log('Gold-Einkommen (erste 10 Wellen):');
    goldPerWave.slice(0, 10).forEach(g => {
      console.log(`  Wave ${g.wave}: ${g.gold} Gold | Gesamt: ${g.total}`);
    });

    console.log('\nGold-Meilensteine:');
    [5, 10, 15, 20, 25, 30, 40, 50].forEach(w => {
      const gp = goldPerWave[w - 1];
      if (gp) console.log(`  Nach Wave ${w}: ${gp.total} Gold gesamt`);
    });

    console.log('\n================= TOWER-KOSTEN vs VERFÜGBARES GOLD =================\n');

    // Tier-0 Towers (Start)
    const tier0Avg = towers.filter(t => t.tier === 0 && t.cost > 1).reduce((sum, t) => sum + t.cost, 0) / 
                     towers.filter(t => t.tier === 0 && t.cost > 1).length;
    
    // Tier-1 Towers
    const tier1 = towers.filter(t => t.tier === 1);
    const tier1Avg = tier1.reduce((sum, t) => sum + t.cost, 0) / tier1.length;
    
    // Tier-2 Towers
    const tier2 = towers.filter(t => t.tier === 2);
    const tier2Avg = tier2.reduce((sum, t) => sum + t.cost, 0) / tier2.length;
    
    // Tier-3 Towers
    const tier3 = towers.filter(t => t.tier === 3);
    const tier3Avg = tier3.reduce((sum, t) => sum + t.cost, 0) / tier3.length;

    console.log('Durchschnittliche Tower-Kosten:');
    console.log(`  Tier 0: ~${tier0Avg.toFixed(0)} Gold`);
    console.log(`  Tier 1: ~${tier1Avg.toFixed(0)} Gold`);
    console.log(`  Tier 2: ~${tier2Avg.toFixed(0)} Gold`);
    console.log(`  Tier 3: ~${tier3Avg.toFixed(0)} Gold`);

    console.log('\n================= SCHADEN vs GEGNER-HP =================\n');

    // Berechne wie viel DPS man braucht
    const criticalWaves = [1, 5, 10, 15, 20, 25, 30, 40, 50];
    
    console.log('Benötigter DPS pro Welle (bei 60 Sekunden):');
    criticalWaves.forEach(waveNum => {
      if (waveNum <= waves.length) {
        const wave = waves[waveNum - 1];
        const e = wave.enemies || {};
        const totalHP = (e.count || 0) * (e.health || 0);
        const requiredDPS = totalHP / 60; // Annahme: 60 Sekunden pro Welle
        console.log(`  Wave ${waveNum}: ${totalHP.toFixed(0)} HP gesamt → ~${requiredDPS.toFixed(0)} DPS benötigt`);
      }
    });

    console.log('\n================= LEISTBARKEIT-ANALYSE =================\n');

    // Kann man sich genug Towers leisten?
    const goldAt10 = goldPerWave[9]?.total || 0;
    const goldAt20 = goldPerWave[19]?.total || 0;
    const goldAt30 = goldPerWave[29]?.total || 0;

    const tier2TowersAt10 = Math.floor(goldAt10 / tier2Avg);
    const tier2TowersAt20 = Math.floor(goldAt20 / tier2Avg);
    const tier3TowersAt30 = Math.floor(goldAt30 / tier3Avg);

    console.log('Wie viele Towers kann man sich leisten?');
    console.log(`  Nach Wave 10: ${goldAt10} Gold → ~${tier2TowersAt10} Tier-2 Towers`);
    console.log(`  Nach Wave 20: ${goldAt20} Gold → ~${tier2TowersAt20} Tier-2 Towers`);
    console.log(`  Nach Wave 30: ${goldAt30} Gold → ~${tier3TowersAt30} Tier-3 Towers`);

    // Jetzt schauen: Reicht das?
    const wave10HP = (waves[9].enemies.count || 0) * (waves[9].enemies.health || 0);
    const wave20HP = (waves[19].enemies.count || 0) * (waves[19].enemies.health || 0);
    
    const avgTier2DPS = tier2.reduce((sum, t) => {
      const dps = t.damage / (t.attackSpeed / 1000);
      return sum + dps;
    }, 0) / tier2.length;

    const actualDPSAt10 = tier2TowersAt10 * avgTier2DPS;
    const requiredDPSAt10 = wave10HP / 60;

    console.log('\n================= BALANCING-FAZIT =================\n');
    console.log(`Wave 10: ${actualDPSAt10.toFixed(0)} DPS verfügbar vs ${requiredDPSAt10.toFixed(0)} DPS benötigt`);
    
    if (actualDPSAt10 < requiredDPSAt10 * 0.5) {
      console.log('⚠️  PROBLEM: Zu wenig DPS möglich! Spieler haben nicht genug Gold.');
    } else if (actualDPSAt10 > requiredDPSAt10 * 2) {
      console.log('⚠️  PROBLEM: Zu viel DPS! Game ist zu einfach.');
    } else {
      console.log('✓ Balance scheint OK zu sein.');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exitCode = 1;
  }
}

fullEconomyAnalysis();
