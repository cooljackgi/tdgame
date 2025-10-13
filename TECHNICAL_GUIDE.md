# Technische Ableitung: Elementarer Nexus

Dieses Dokument beschreibt die technische Architektur des Tower-Defense-Spiels "Elementarer Nexus" und skizziert Optimierungen für einen produktionsreifen Betrieb.

#### 1. Kerntechnologien

*   **Frontend-Framework:** **Next.js** mit **React** (App Router) und **TypeScript**.
*   **UI-Komponenten:** **shadcn/ui**, eine Sammlung wiederverwendbarer Komponenten, die auf **Tailwind CSS** aufbauen.
*   **State-Management & Backend:** **Firebase**
    *   **Firestore:** Dient als Echtzeit-Datenbank für den Spielzustand.
    *   **Firebase Authentication:** Verwaltet die Benutzeranmeldung.
    *   **Firebase Functions (Callable):** Für serverseitige, validierte Aktionen (`joinGame`, `buildTower` etc.).
*   **Echtzeit-Effekte (VFX):** Ein **WebSocket-Server** (via `ws-relay`) wird genutzt, um hochfrequente visuelle Effekte zu senden und Firestore zu entlasten.
*   **Rendering:**
    *   **React-Komponenten:** Für die Haupt-UI (Menüs, HUD).
    *   **HTML `<canvas>`:** Für alle visuellen Effekte im Spiel (Projektile, Explosionen) zur Maximierung der Performance.

#### 2. Architektur & Datenfluss

**2.1. Die `GameSession`-Komponente (Das Gehirn)**

*   **Zustandsverwaltung:** Hält den lokalen Spielzustand (`players`, `towers`, `enemies`, `gameState`).
*   **Haupt-Game-Loop (`gameTick`):**
    *   **Fixed Timestep (Zielarchitektur):** Um eine von der Framerate unabhängige, deterministische Spielphysik zu gewährleisten, sollte der Loop mit einem festen Zeitintervall (z.B. `dt = 50ms`) laufen. Bei langsameren Geräten werden mehrere Ticks nachgeholt, um den Zustand aufzuholen. Die UI interpoliert zwischen den Zuständen für eine flüssige Darstellung.
    *   **(Aktuell) `requestAnimationFrame`:** Der Loop wird derzeit pro Frame ausgeführt, was zu variabler Tick-Rate führen kann.
    *   **Host-Autorität:** Der `gameTick` läuft **nur beim Host** (Spieler 1) oder im Einzelspieler-Modus.
    *   **Aufgaben des `gameTick`:**
        1.  Gegner bewegen.
        2.  Turm-Angriffe berechnen (Reichweite, Abklingzeit).
        3.  Schaden anwenden.
        4.  Visuelle Effekte (VFX) generieren und für den Versand vorbereiten.
        5.  Spielzustands-Änderungen (Deltas) für die Synchronisation sammeln.
*   **Deterministische Seeds:** Jede Welle sollte aus einem Seed generiert werden (`waveSeed` im Game-Dokument), um Zufallsereignisse (z.B. Loot-Drops) reproduzierbar zu machen. Dies erleichtert Replays, Debugging und eine potenzielle Host-Migration.

**2.2. Zustands-Synchronisation (Host-Client-Modell)**

*   **Authoritativer Host:** Spieler 1 ist der "Host" und seine Spielsimulation ist die alleinige Wahrheit.
*   **Delta-Synchronisation (Zielarchitektur):**
    *   **Warum:** Das Senden des kompletten Spielzustands bei jeder Änderung ist teuer, langsam und stößt schnell an das 1-MiB-Limit von Firestore-Dokumenten.
    *   **Wie:** Der Host sendet nur **Deltas** (Änderungen) an Firestore. Beispiel: `changedEntities: { enemies: { upsert: [...], removed: [id1, id2] } }`. Clients abonnieren diese Deltas und wenden sie auf ihren lokalen Zustand an. Die Synchronisationsrate sollte konfigurierbar sein (**`SYNC_HZ`**, ca. 8-12 Hz).
*   **Dokumentgröße kontrollieren:** Um das 1-MiB-Limit zu umgehen, sollten große Sammlungen wie Gegner aufgeteilt werden, z.B. in Sub-Collections (`/games/{id}/enemies/shard-1`).
*   **Schreib-Drosselung & Idempotenz:** Alle Schreibvorgänge des Hosts werden in einer Queue gesammelt und mit fester Frequenz an Firestore gesendet, um "Write Stream Exhausted"-Fehler zu vermeiden. Jede Aktion benötigt eine idempotente ID (`idem-{uuid}`), um doppelte Ausführung bei Retries zu verhindern.
*   **Host-Failover (Optional):** Falls der Host die Verbindung verliert, kann Spieler 2 übernehmen. Mechanismus: Der Host schreibt regelmäßig einen `lastHostBeat`-Timestamp. Wenn dieser zu alt ist, kann Spieler 2 via Transaktion zum neuen Host werden.

**2.3. VFX-Pipeline (Performance-Optimierung)**

Die VFX-Pipeline ist komplett von der Spiellogik-Synchronisation getrennt, um Firestore zu entlasten.

1.  **Generierung & Batching (Host):** Der `gameTick` des Hosts generiert VFX-Objekte. Diese werden in einem Batch-Array (`wsBatch`) gesammelt.
2.  **Versand via WebSocket:** Ein `setInterval` (ca. alle 33ms / 30 Hz) sendet das gesammelte Batch gebündelt an den WebSocket-Server. Um die Datenmenge zu reduzieren, kann eine Kompression (z.B. schemalose Nummernlisten, per-message deflate) eingesetzt werden.
3.  **Broadcast (WebSocket-Server):** Der Server leitet die Nachrichten an alle Clients im selben Raum weiter.
    *   **Sicherheit:** Der WS-Server sollte Verbindungen nur nach Validierung eines Firebase ID-Tokens erlauben und die Raum-Zugehörigkeit prüfen, um Missbrauch zu verhindern. Ein Heartbeat (Ping/Pong) hilft, tote Verbindungen zu erkennen.
4.  **Darstellung auf Canvas (Alle Clients):**
    *   **Object-Pooling:** Um den Druck auf den Garbage Collector zu minimieren, werden VFX-Objekte nicht ständig neu erstellt, sondern aus einem Pool wiederverwendet.
    *   **Render-Loop:** Ein `requestAnimationFrame`-Loop in der `GameBoard`-Komponente zeichnet alle aktiven VFX auf die Canvas. Die Lebensdauer der Effekte wird im Loop pro Frame dekrementiert (TTL - Time-to-Live), anstatt tausende `setTimeout`-Aufrufe zu nutzen.
    *   **Hard Budgets & Adaptive Qualität:** Es gibt feste Obergrenzen für gleichzeitig sichtbare Effekte (z.B. 250 Projektile). Fällt die Framerate unter einen Schwellenwert (z.B. 55 FPS), können diese Budgets dynamisch halbiert werden, um die Performance zu stabilisieren.

#### 3. Sicherheit & Validierung

*   **Strenge Firestore Security Rules:** Regeln stellen sicher, dass ein Spieler nur seine eigenen Ressourcen verändern kann, Turmplatzierungen keine Wege blockieren und kritische Spielfelder (wie `hostUid`) nicht von Unbefugten geändert werden können.
*   **Serverseitige Validierung:** Kritische Aktionen (Turm bauen/verkaufen/upgraden) werden über `Callable Cloud Functions` abgewickelt, die eine zusätzliche Validierungsschicht bieten. Der Client kann die UI optimistisch aktualisieren, verlässt sich aber auf das serverseitige Ergebnis.

#### 4. Observability & Testing

*   **Strukturierte Logs & Metriken:** Der Host sollte Metriken wie Tick-Dauer, Firestore-Schreib-Raten und Dokumentgrößen protokollieren, um Performance-Probleme zu diagnostizieren.
*   **Headless Simulation:** Die Kern-Spiellogik (`gameTick`) sollte so extrahiert werden, dass sie ohne UI (in Node.js) für Unit- und Regressionstests (z.B. mit Jest) ausgeführt werden kann.
*   **Feature Toggles:** Kritische Parameter (Sync-Frequenz, VFX-Budgets) sollten über Firebase Remote Config steuerbar sein, um im Live-Betrieb schnell reagieren zu können.

#### 5. Wichtige Dateien im Überblick

*   `src/components/game/game-session.tsx`: Das zentrale Gehirn (Spiellogik, State-Management, Host-Autorität).
*   `src/components/game/game-board.tsx`: Stellt das Spielfeld und die Canvas für die VFX-Darstellung bereit.
*   `src/lib/game-data.ts`: Statische Spieldaten (Türme, Wellen, Gegner).
*   `src/lib/pathfinding.ts`: BFS-Algorithmus zur Wegfindung.
*   `src/app/game/[gameId]/page.tsx`: Einstiegspunkt für eine Spielsitzung.
*   `src/hooks/use-websocket.ts`: Custom Hook für die WebSocket-Verbindung.
*   `functions/src/index.ts`: Serverseitige Cloud Functions.
*   `firestore.rules`: Sicherheitsregeln für die Datenbank.
