const https = require('https');

const API_KEY = 'meinSuperLangerGeheimerKeyundnochmehrtext';
const BASE_URL = 'studio--studio-8208926735-5ea4c.us-central1.hosted.app';

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
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

async function applySecondRound() {
  try {
    // Lese balancing data
    console.log('📖 Lese Balancing-Daten...');
    const data = await makeRequest('GET', '/api/admin/firestore-read?mode=balancing');
    const towers = data.data.towers;

    console.log(`✓ ${towers.length} Towers gelesen\n`);
    console.log('⚙️  Wende ZWEITE NERF-RUNDE an...\n');

    // Dornen-Balliste (Index 15): 370 → 420
    towers[15].cost = 420;
    console.log(`✓ Dornen-Balliste: Cost 370 → 420`);

    // Licht-Balliste (Index 16): 320 → 380
    towers[16].cost = 380;
    console.log(`✓ Licht-Balliste: Cost 320 → 380`);

    // Schatten-Balliste (Index 17): 380 → 410
    towers[17].cost = 410;
    console.log(`✓ Schatten-Balliste: Cost 380 → 410`);

    // Schreibe zurück
    console.log('\n📝 Schreibe zu Firestore...');
    const result = await makeRequest('POST', '/api/admin/firestore-write', {
      docPath: 'game_config/balancing',
      data: { towers }
    });

    if (result.success) {
      console.log('✅ ZWEITE NERF-RUNDE erfolgreich!\n');
      
      // Verifiziere
      console.log('🔍 Verifiziere...');
      const verify = await makeRequest('GET', '/api/admin/firestore-read?mode=balancing');
      const vt = verify.data.towers;
      console.log(`  Dornen-Balliste Cost: ${vt[15].cost} ✓`);
      console.log(`  Licht-Balliste Cost: ${vt[16].cost} ✓`);
      console.log(`  Schatten-Balliste Cost: ${vt[17].cost} ✓`);
    } else {
      console.error('❌ Fehler:', result.error);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

applySecondRound();
