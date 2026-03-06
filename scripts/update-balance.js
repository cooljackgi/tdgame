const API_KEY = 'meinSuperLangerGeheimerKeyundnochmehrtext';
const BASE_URL = 'https://studio--studio-8208926735-5ea4c.us-central1.hosted.app';

async function main() {
  try {
    // Lese balancing data
    console.log('📖 Lese Balancing-Daten...');
    const readRes = await fetch(`${BASE_URL}/api/admin/firestore-read?mode=balancing`, {
      headers: { 'x-firedb-key': API_KEY }
    });
    const data = await readRes.json();
    
    if (!data.data) {
      console.error('❌ Keine Daten erhalten:', data);
      return;
    }

    const towers = data.data.towers;
    console.log(`✓ ${towers.length} Towers gelesen`);

    // Änderungen anwenden
    console.log('\n⚙️  Wende Änderungen an...');
    
    // Gravitations-Turm (Index 33)
    towers[33].damage = 350;
    towers[33].cost = 1200;
    console.log(`✓ Gravitations-Turm: ${1120} DPS → ${350}, Cost ${800} → 1200`);

    // Sturmfront (Index 21)
    towers[21].damage = 105;
    console.log(`✓ Sturmfront: Damage 135 → 105`);

    // Dornen-Balliste (Index 15)
    towers[15].cost = 370;
    console.log(`✓ Dornen-Balliste: Cost 310 → 370`);

    // Schatten-Balliste (Index 17)
    towers[17].cost = 380;
    console.log(`✓ Schatten-Balliste: Cost 320 → 380`);

    // Schreibe zurück
    console.log('\n📝 Schreibe zu Firestore...');
    const writeRes = await fetch(`${BASE_URL}/api/admin/firestore-write`, {
      method: 'POST',
      headers: {
        'x-firedb-key': API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        docPath: 'game_config/balancing',
        data: { towers }
      })
    });

    const result = await writeRes.json();
    if (result.success) {
      console.log('✅ Balance-Update erfolgreich!');
    } else {
      console.error('❌ Fehler:', result.error);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

main();
