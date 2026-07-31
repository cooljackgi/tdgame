const { makeRequest } = require('./balance-api');

async function fixEconomy() {
  try {
    console.log('📖 Lade Balancing-Daten...\n');
    const data = await makeRequest('GET', '/api/admin/firestore-read?mode=balancing');
    const waves = data.data.waves;

    console.log('⚙️  WIRTSCHAFTS-FIX wird angewendet...\n');

    let changesCount = 0;

    // 1. Boss-Waves massiv erhöhen
    const bossWaves = [9, 19, 29, 39, 49]; // 0-indexed: Wave 10, 20, 30, 40, 50
    const bossGoldRewards = [500, 800, 1200, 2000, 3000];

    bossWaves.forEach((waveIdx, i) => {
      if (waves[waveIdx] && waves[waveIdx].enemies) {
        const oldGold = waves[waveIdx].enemies.goldReward || 10;
        waves[waveIdx].enemies.goldReward = bossGoldRewards[i];
        console.log(`✓ Wave ${waveIdx + 1} (Boss): ${oldGold} → ${bossGoldRewards[i]} Gold pro Enemy`);
        changesCount++;
      }
    });

    console.log('');

    // 2. Ab Wave 15: Gold-Rewards verdoppeln
    for (let i = 14; i < Math.min(50, waves.length); i++) {
      if (waves[i] && waves[i].enemies && !bossWaves.includes(i)) {
        const oldGold = waves[i].enemies.goldReward || 10;
        const newGold = Math.floor(oldGold * 2);
        waves[i].enemies.goldReward = newGold;
        
        if (i === 14 || i === 24 || i === 34 || i === 44) {
          console.log(`✓ Wave ${i + 1}: ${oldGold} → ${newGold} Gold pro Enemy (x2)`);
          changesCount++;
        }
      }
    }

    console.log(`\n✓ ${changesCount} Waves angepasst\n`);

    // 3. Schreibe zurück
    console.log('📝 Schreibe zu Firestore...');
    const result = await makeRequest('POST', '/api/admin/firestore-write', {
      docPath: 'game_config/balancing',
      data: { waves }
    });

    if (result.success) {
      console.log('✅ WIRTSCHAFTS-FIX erfolgreich!\n');
      
      // Verifiziere
      console.log('🔍 Neue Gold-Bilanz:');
      const verify = await makeRequest('GET', '/api/admin/firestore-read?mode=balancing');
      const vWaves = verify.data.waves;
      
      let totalGold = 0;
      vWaves.slice(0, 50).forEach((w, idx) => {
        const e = w.enemies || {};
        const waveGold = (e.count || 0) * (e.goldReward || 10);
        totalGold += waveGold;
      });

      console.log(`  Nach Wave 10: ${vWaves.slice(0, 10).reduce((sum, w) => sum + (w.enemies.count * w.enemies.goldReward), 0)} Gold`);
      console.log(`  Nach Wave 20: ${vWaves.slice(0, 20).reduce((sum, w) => sum + (w.enemies.count * w.enemies.goldReward), 0)} Gold`);
      console.log(`  Nach Wave 30: ${vWaves.slice(0, 30).reduce((sum, w) => sum + (w.enemies.count * w.enemies.goldReward), 0)} Gold`);
      console.log(`  Nach Wave 50: ${totalGold} Gold\n`);
      
      console.log('✅ Game sollte jetzt schaffbar sein!');
    } else {
      console.error('❌ Fehler:', result.error);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exitCode = 1;
  }
}

fixEconomy();
