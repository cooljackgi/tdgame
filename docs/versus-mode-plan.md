# Implementierungsplan: Versus-Modus

Dieses Dokument hält die vereinbarte Strategie fest, um den Versus-Modus sicher und ohne Beeinträchtigung des bestehenden Coop-Modus zu implementieren. Wir werden bei jedem Schritt sicherstellen, dass die Coop-Funktionalität unangetastet bleibt.

---

## Die Grundstrategie: Klare Trennung durch `gameMode`

Der Kern des Plans ist die Einführung einer `gameMode: 'coop' | 'versus'` Eigenschaft in den Spieldaten. Diese dient als Weiche, um die Logik für jeden Modus sauber zu trennen, statt sie zu vermischen.

### ✅ Schritt 1: Datenstrukturen anpassen (Abgeschlossen)

-   **Ziel:** Die zentralen Datenstrukturen so erweitern, dass sie *beide* Spielmodi abbilden können.
-   **Umsetzung:**
    -   Der Typ `GameSessionState` in `src/lib/game-data/types.ts` wird angepasst.
    -   **Coop-Modus:** Behält seinen einzelnen, geteilten Zustand (`gameState`, `towersByCell`, `enemies`, `workers`, etc.).
    -   **Versus-Modus:** Erhält eine neue, verschachtelte Struktur: `playerStates: { player1: PlayerGameState, player2: PlayerGameState }`. Jedes `PlayerGameState` Objekt enthält ein komplett eigenständiges Spielfeld (eigene Gegner, Türme, Arbeiter, Leben etc.).
    -   Der `coop-game-loader.tsx` wird angepasst, um beim Laden eines Spiels den `gameMode` zu prüfen und entweder den einen (Coop) oder die zwei getrennten (Versus) Zustände zu initialisieren.

### ⬜ Schritt 2: Spiellogik (Game Loop) erweitern

-   **Ziel:** Die Host-seitige Simulationslogik so erweitern, dass sie beide Modi verarbeiten kann.
-   **Umsetzung:**
    -   Die Haupt-Spielschleife (`gameLoop` im `coop-game-loader.tsx`) erhält eine `if (gameMode === 'versus')` Abfrage.
    -   **Coop-Pfad:** Der Code für den Coop-Modus bleibt unverändert und simuliert weiterhin das eine, geteilte Spielfeld.
    -   **Versus-Pfad:** Innerhalb dieses neuen `if`-Blocks wird die Schleife **zwei unabhängige Simulationen** pro Tick ausführen (eine für `player1State`, eine für `player2State`). Die Logik für das Senden von Gegnern und die Einkommenserhöhung wird hier gekapselt.
    -   Die `deltas` (Zustands-Updates) werden für jedes Spielfeld getrennt erzeugt und nur an den jeweiligen Client gesendet.

### ⬜ Schritt 3: Benutzeroberfläche (UI) anpassungsfähig machen

-   **Ziel:** Die UI (Layouts und Menüs) muss beide Modi korrekt darstellen können.
-   **Umsetzung:**
    -   Die Layout-Komponenten (`desktop-layout.tsx` und `mobile-layout.tsx`) erhalten eine Logik, um basierend auf dem `gameMode` zu rendern.
    -   **Coop-Ansicht:** Zeigt wie bisher das geteilte Spielfeld an.
    -   **Versus-Ansicht:** Zeigt immer das Spielfeld des **lokalen** Spielers und die Statistiken des Gegners an.
    -   Das `TowerSelection`-Menü (`tower-selection.tsx`) wird um **Tabs ("Bauen" / "Angriff")** erweitert. Diese Tabs sind **nur im Versus-Modus** sichtbar. Im Coop-Modus bleibt das bekannte, einzelne Bau-Menü bestehen.
