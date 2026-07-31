
# Firebase Studio

This is a NextJS starter in Firebase Studio.

To get started, take a look at src/app/page.tsx.

## Balancing-Werkzeuge

Die Werkzeuge unter `scripts/` lesen und ändern die Balancing-Daten der
laufenden App. Der Admin-Schlüssel wird nicht im Repository gespeichert,
sondern muss über `FIRESTORE_READ_API_KEY` bereitgestellt werden.

Mit einer für das Firebase-Projekt berechtigten CLI-Sitzung:

```powershell
$env:FIRESTORE_READ_API_KEY = firebase apphosting:secrets:access FIRESTORE_READ_API_KEY --project studio-8208926735-5ea4c
npm run balance:verify
npm run balance:analyze
npm run balance:economy
```

`balance:verify` und die Analysebefehle lesen nur Daten. Die Skripte
`update-balance.js`, `nerf-ballistas.js`, `fix-economy.js` und
`fix-lategame.js` schreiben dagegen direkt in die Produktionsdatenbank.
