const { fetchData } = require('./balance-api');

async function verifyChanges() {
  try {
    console.log('📖 Verifiziere Balance-Daten...\n');
    const data = await fetchData('/api/admin/firestore-read?mode=balancing');
    const towers = data.data.towers;

    console.log('✅ BALANCE-UPDATES VERIFIZIERT:\n');
    
    console.log(`  Gravitations-Turm: Damage=${towers[33].damage} (erwartet: 350), Cost=${towers[33].cost} (erwartet: 1200)`);
    console.log(`  Sturmfront: Damage=${towers[21].damage} (erwartet: 105)`);
    console.log(`  Dornen-Balliste: Cost=${towers[15].cost} (erwartet: 420)`);
    console.log(`  Licht-Balliste: Cost=${towers[16].cost} (erwartet: 380)`);
    console.log(`  Schatten-Balliste: Cost=${towers[17].cost} (erwartet: 410)\n`);

    const allCorrect = 
      towers[33].damage === 350 &&
      towers[33].cost === 1200 &&
      towers[21].damage === 105 &&
      towers[15].cost === 420 &&
      towers[16].cost === 380 &&
      towers[17].cost === 410;

    if (allCorrect) {
      console.log('🎉 ALLE UPDATES ERFOLGREICH GESPEICHERT!\n');
    } else {
      console.log('⚠️  Einige Updates nicht korrekt!\n');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exitCode = 1;
  }
}

verifyChanges();
