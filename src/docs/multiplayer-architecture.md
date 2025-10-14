
# Multiplayer-Architektur: Ziel & Umsetzung

Dieses Dokument beschreibt die ideale technische Architektur für das Koop-Multiplayer-System von "Elementarer Nexus" und vergleicht sie mit dem aktuellen Umsetzungsstand.

## 1. Klare Rollenverteilung: Aufgaben & Technologien

| Aufgabe | Beste Lösung | Begründung |
| :--- | :--- | :--- |
| **Gameplay** (Deltas, Treffer, Wellen, Positionen) | WebRTC DataChannel | Peer-to-Peer, minimale Latenz, keine Serverkosten für Spieldaten-Traffic. |
| **Signaling** (Offer/Answer/ICE) | WebSocket-Server | Schnell, effizient und unter eigener Kontrolle für den Verbindungsaufbau. |
| **Lobby / Matchmaking** / Spieler-Status / Raumliste | Firestore (oder WS-Server) | Persistente, sichere Datenhaltung für "langsame" Daten wie Spielräume. |
| **Spieler-Profile**, Statistiken, Scores, Achievements | Firestore | Dauerhafte Speicherung, Offline-Support, einfache Abfrage. |
| **Replay / History / Analytics** | Firestore oder dedizierte Backend-DB | Serverseitige Persistenz für Analyse und historische Daten. |
| **Cheat-Detection**, Moderation, Reports | Firestore (oder eigenes Admin-Backend) | Sicherer, zentraler Speicher für administrative Aufgaben. |
| **Live-Gameplay-Sync** (z.B. Bewegungen) | ❌ **niemals** Firestore! | Zu langsam, zu teuer und nicht für hochfrequente Updates ausgelegt. |

---

## 2. Umsetzungsbeispiele & Aktueller Stand

### Lobby-System (Firestore)

**Ideal-Struktur:**
```json
/lobbies/{gameId}
  ├─ hostId: "uid123"
  ├─ players: ["uid123", "uid456"]
  ├─ status: "waiting" | "playing" | "finished"
  ├─ createdAt: ...
```
- **Logik:** Nur beim Match-Start / -Beitritt geschrieben oder gelesen. Danach läuft alles über WebRTC.
- **Status:** ✅ **Umgesetzt.** Die `games`-Collection in Firestore dient als Lobby-System. Die Struktur ist sehr ähnlich (`player1Id`, `members`, `gameStatus`) und wird nur für den Initialzustand verwendet.

### Persistente Spieler-Daten (Firestore)

**Ideal-Struktur:**
```json
/users/{uid}
  ├─ gamesPlayed: 12
  ├─ totalKills: 417
  ├─ bestWave: 23
  ├─ lastOnline: ...
```
- **Logik:** Wird nach Abschluss eines Spiels aktualisiert.
- **Status:** ✅ **Teilweise umgesetzt.** Eine `scores`-Collection für Highscores existiert. Eine dedizierte `users`-Collection für kumulative Spielerstatistiken ist ein logischer nächster Schritt, aber noch nicht implementiert.

### Fazit
Die aktuelle Architektur des Spiels folgt den Best Practices, indem sie eine klare Trennung zwischen hochfrequenten Echtzeit-Daten (WebRTC) und persistenten, langsamen Zustandsdaten (Firestore) vornimmt. Dies schafft eine skalierbare und kosteneffiziente Grundlage.
