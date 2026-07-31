const { fetchData, makeRequest } = require('./balance-api');

async function main() {
  try {
    // Lese balancing data
    console.log('📖 Lese Balancing-Daten...');
    const data = await fetchData('/api/admin/firestore-read?mode=balancing');
    
    if (!data.data) {
      console.error('❌ Keine Daten erhalten:', data);
      process.exitCode = 1;
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
    const result = await makeRequest('POST', '/api/admin/firestore-write', {
      docPath: 'game_config/balancing',
      data: { towers }
    });

    if (result.success) {
      console.log('✅ Balance-Update erfolgreich!');
    } else {
      console.error('❌ Fehler:', result.error);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exitCode = 1;
  }
}

main();
