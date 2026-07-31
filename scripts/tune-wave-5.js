const { fetchData, makeRequest } = require('./balance-api');

const EXPECTED_HEALTH = 472;
const EXPECTED_ARMOR = 25;
const TARGET_HEALTH = 360;
const TARGET_ARMOR = 15;

async function tuneWave5() {
  const response = await fetchData('/api/admin/firestore-read?mode=balancing');
  const waves = response.data.waves;
  const wave5 = waves[4];

  if (
    wave5?.waveNumber === 5 &&
    wave5?.enemies?.health === TARGET_HEALTH &&
    wave5?.enemies?.armor === TARGET_ARMOR
  ) {
    console.log(`Welle 5 ist bereits auf ${TARGET_HEALTH} HP/${TARGET_ARMOR} Rüstung eingestellt.`);
    return;
  }

  if (
    wave5?.waveNumber !== 5 ||
    wave5?.enemies?.health !== EXPECTED_HEALTH ||
    wave5?.enemies?.armor !== EXPECTED_ARMOR
  ) {
    throw new Error(
      `Abbruch: Welle 5 hat nicht die erwarteten Werte ` +
      `${EXPECTED_HEALTH} HP/${EXPECTED_ARMOR} Rüstung ` +
      `(aktuell ${wave5?.enemies?.health ?? 'unbekannt'}/${wave5?.enemies?.armor ?? 'unbekannt'}).`
    );
  }

  wave5.enemies.health = TARGET_HEALTH;
  wave5.enemies.armor = TARGET_ARMOR;
  await makeRequest('POST', '/api/admin/firestore-write', {
    docPath: 'game_config/balancing',
    data: { waves },
  });

  const verify = await fetchData('/api/admin/firestore-read?mode=balancing');
  const storedWave5 = verify.data.waves[4]?.enemies;
  if (storedWave5?.health !== TARGET_HEALTH || storedWave5?.armor !== TARGET_ARMOR) {
    throw new Error(
      `Verifikation fehlgeschlagen: gespeichert ist ` +
      `${storedWave5?.health ?? 'unbekannt'}/${storedWave5?.armor ?? 'unbekannt'}.`
    );
  }

  console.log(
    `Welle 5: ${EXPECTED_HEALTH} HP/${EXPECTED_ARMOR} Rüstung -> ` +
    `${TARGET_HEALTH} HP/${TARGET_ARMOR} Rüstung.`
  );
}

tuneWave5().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
