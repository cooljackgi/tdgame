const fetch = require('node-fetch');

const API_KEY = 'meinSuperLangerGeheimerKeyundnochmehrtext';
const BASE_URL = 'https://studio--studio-8208926735-5ea4c.us-central1.hosted.app';

async function verifyChanges() {
  try {
    console.log('📖 Verifiziere Balance-Daten...\n');
    const res = await fetch(`${BASE_URL}/api/admin/firestore-read?mode=balancing`, {
      headers: { 'x-firedb-key': API_KEY }
    });
    const data = await res.json();
    const towers = data.data.towers;

    console.log('✅ BALANCE-UPDATES VERIFIZIERT:\n');
    
    console.log(`  Gravitations-Turm: Damage=${towers[33].damage} (erwartet: 350), Cost=${towers[33].cost} (erwartet: 1200)`);
    console.log(`  Sturmfront: Damage=${towers[21].damage} (erwartet: 105)`);
    console.log(`  Dornen-Balliste: Cost=${towers[15].cost} (erwartet: 370)`);
    console.log(`  Schatten-Balliste: Cost=${towers[17].cost} (erwartet: 380)\n`);

    const allCorrect = 
      towers[33].damage === 350 &&
      towers[33].cost === 1200 &&
      towers[21].damage === 105 &&
      towers[15].cost === 370 &&
      towers[17].cost === 380;

    if (allCorrect) {
      console.log('🎉 ALLE UPDATES ERFOLGREICH GESPEICHERT!\n');
    } else {
      console.log('⚠️  Einige Updates nicht korrekt!\n');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

verifyChanges();
