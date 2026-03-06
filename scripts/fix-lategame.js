const https = require('https');

const API_KEY = 'meinSuperLangerGeheimerKeyundnochmehrtext';

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'studio--studio-8208926735-5ea4c.us-central1.hosted.app',
      path: path,
      method: method,
      headers: {
        'x-firedb-key': API_KEY,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    }).on('error', reject);

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function fixLateGame() {
  try {
    console.log('📖 Lade Balancing-Daten...\n');
    const data = await makeRequest('GET', '/api/admin/firestore-read?mode=balancing');
    const waves = data.data.waves;

    console.log('⚙️  LATE-GAME FIX wird angewendet...\n');

    // Ab Wave 30: Gold x3
    for (let i = 29; i < Math.min(50, waves.length); i++) {
      if (waves[i] && waves[i].enemies) {
        const oldGold = waves[i].enemies.goldReward || 20;
        const newGold = Math.floor(oldGold * 3);
        waves[i].enemies.goldReward = newGold;
        
        if (i === 29 || i === 35 || i === 44) {
          console.log(`✓ Wave ${i + 1}: ${oldGold} → ${newGold} Gold (x3)`);
        }
      }
    }

    // Zusätzlich: Gegner-HP ab Wave 35 um 30% reduzieren
    console.log('\n⚖️  Reduziere Gegner-HP ab Wave 35 um 30%...\n');
    for (let i = 34; i < Math.min(50, waves.length); i++) {
      if (waves[i] && waves[i].enemies) {
        const oldHP = waves[i].enemies.health || 1000;
        const newHP = Math.floor(oldHP * 0.7);
        waves[i].enemies.health = newHP;
        
        if (i === 34 || i === 39 || i === 44 || i === 49) {
          console.log(`✓ Wave ${i + 1}: ${oldHP} HP → ${newHP} HP (-30%)`);
        }
      }
    }

    console.log('\n📝 Schreibe zu Firestore...');
    const result = await makeRequest('POST', '/api/admin/firestore-write', {
      docPath: 'game_config/balancing',
      data: { waves }
    });

    if (result.success) {
      console.log('✅ LATE-GAME FIX erfolgreich!\n');
      console.log('✅ Waves 30-50 sollten jetzt schaffbar sein!');
    } else {
      console.error('❌ Fehler:', result.error);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

fixLateGame();
