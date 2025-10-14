
# Elementarer Nexus: Funktionsübersicht

Dieses Dokument bietet einen detaillierten Überblick über die Kernfunktionen, Spielmechaniken und technischen Komponenten des Tower-Defense-Spiels "Elementarer Nexus".

---

## 1. Spielkonzept & Kern-Gameplay

"Elementarer Nexus" ist ein strategisches Tower-Defense-Spiel, das allein oder kooperativ gespielt werden kann. Das Ziel ist es, den "Nexus" (das Ziel) gegen immer stärker werdende Wellen von Gegnern zu verteidigen.

### 1.1. Spielablauf
- **Wellen:** Das Spiel ist in Wellen unterteilt. Zwischen den Wellen gibt es eine Bauphase (`Intermission`).
- **Ressourcen & Leben:** Spieler starten mit einer bestimmten Menge an Ressourcen und Leben. Besiegte Gegner bringen neue Ressourcen. Gegner, die das Ziel erreichen, kosten Leben. Das Spiel endet, wenn die Leben auf 0 fallen.
- **Bauen & Upgraden:** In der Bauphase (und auch während der Wellen) können Spieler mit Ressourcen Türme bauen und bestehende Türme verbessern.
- **Pfadfindung:** Gegner folgen dem kürzesten Weg vom Start zum Ziel. Durch das Platzieren von Türmen wird der Weg dynamisch verlängert, was ein zentrales strategisches Element ist (Labyrinth-Bau oder "Mazing").

### 1.2. Das Element-System
Das Alleinstellungsmerkmal des Spiels ist das komplexe Element-System.
- **Basis-Türme:** Spieler starten mit einem neutralen Basisturm. Dieser kann zu einem "Scharfschützen" (hohe Reichweite) oder einer "Balliste" (Flächenschaden) ausgebaut werden.
- **Elemente freischalten:** Alle paar Wellen erhalten Spieler die Möglichkeit, ein neues Basiselement (z.B. Feuer, Wasser, Erde) freizuschalten.
- **Element-Türme:** Sobald ein Element freigeschaltet ist, können die Basis-Türme zu spezialisierten Element-Türmen (Tier 2) aufgewertet werden.
- **Kombinations-Türme (Tier 3):** Die mächtigsten Türme entstehen durch die Kombination von zwei verschiedenen Elementen (z.B. Feuer + Wasser = Dampf-Turm). Dies erfordert, dass der Spieler beide Elemente freigeschaltet hat.
- **Effekte:** Jeder Element-Turm hat einzigartige Effekte wie:
    - **Brennen (Feuer):** Schaden über Zeit.
    - **Verlangsamen (Wasser):** Reduziert die Gegnergeschwindigkeit.
    - **Betäuben (Erde):** Hält Gegner kurz an.
    - **Kettenblitz (Luft):** Springt auf mehrere Ziele über.
    - **Aura (Licht):** Verstärkt benachbarte Türme.

---

## 2. Spielmodi & Features

### 2.1. Einzelspieler
- Der klassische Modus, bei dem ein Spieler alleine gegen die Wellen antritt.
- **Speicherfunktion:** Der Spielfortschritt wird automatisch im Local Storage des Browsers gespeichert, wenn das Fenster geschlossen oder das Spiel pausiert wird.
- **Highscore:** Nach Abschluss einer Partie wird das Ergebnis (erreichte Welle) in einer globalen Firestore-Rangliste gespeichert (außer im Chaos-Modus).

### 2.2. Koop-Multiplayer (2 Spieler)
- Spieler können eine Lobby erstellen oder einem bestehenden Spiel beitreten.
- **Host-Client-Modell:** Der Ersteller des Spiels ist der "Host" und simuliert das gesamte Spielgeschehen. Der zweite Spieler ist der "Client" und empfängt die Zustands-Updates.
- **Geteilte Ressourcen & Leben:** Beide Spieler teilen sich denselben Pool an Leben und Ressourcen, was enge Absprachen erfordert.
- **Echtzeit-Kommunikation:** Die Synchronisation erfolgt über eine **WebRTC-Datenverbindung**, die eine extrem niedrige Latenz ermöglicht. Ein WebSocket-Server dient nur noch als "Signaling-Server", um die Verbindung zwischen den beiden Spielern auszuhandeln.

### 2.3. Chaos-Modus & Test-Modi
- **Chaos-Modus:** Eine Einzelspieler-Variante mit Cheats (unendlich Ressourcen, Wellen überspringen etc.) zum freien Experimentieren.
- **Koop-Testwerkstatt:** Eine dedizierte Seite (`/admin/coop-test`), um schnell eine 2-Spieler-Umgebung lokal zu simulieren, ohne einen zweiten Browser/Account zu benötigen.

---

## 3. Entwickler- & Analyse-Tools

Das Spiel enthält mehrere integrierte Werkzeuge für Balancing und Analyse.

### 3.1. Balancing-Dashboards
- **Turm-Dashboard (`/balancing`):** Eine interaktive Oberfläche, auf der die Werte aller Türme (Kosten, Schaden, Feuerrate etc.) live angepasst werden können. Ein Effizienz-Diagramm (Schaden pro Kostenpunkt) hilft dabei, über- oder unterdurchschnittliche Türme zu identifizieren. Änderungen können per Knopfdruck direkt in die Spieldaten-Dateien (`towers.ts`) gespeichert werden.
- **Wellen-Dashboard (`/balancing/waves`):** Ein ähnliches Tool zur Anpassung der Gegnerwellen. Hier können sowohl die globalen Formeln für die prozedurale Generierung als auch jede einzelne Welle manuell feinjustiert und gespeichert werden.

### 3.2. Analyse-Dashboard (`/admin/analytics`)
- Zeigt eine Liste aller abgeschlossenen Spiele an.
- Bietet eine Detailansicht für jedes Spiel mit Graphen zu:
    - Host-Performance (FPS)
    - Anzahl der Spielobjekte (Gegner, Türme)
    - Netzwerk-Statistiken (Pakete pro Sekunde, Datenvolumen).
- **Live-Datenstrom:** Ermöglicht die Beobachtung der rohen, unformatierten Datenpakete, die vom Host an die Clients gesendet werden, in Echtzeit.
- **WebRTC-Verbindungs-Protokoll:** Eine detaillierte Chronik aller Events während des Verbindungsaufbaus, extrem nützlich für das Debugging von P2P-Problemen.

### 3.3. Wissens-Enzyklopädie (`/explainer`)
- **Interaktive Karte:** Eine Visualisierung aller Spielelemente (Türme, Elemente, Effekte) als Graphen-Netzwerk. Hilft, Zusammenhänge und Upgrade-Pfade zu verstehen.
- **Turm-Enzyklopädie:** Eine detaillierte Liste aller Türme mit ihren Werten und einer Live-Vorschau ihres Angriffs.

---

## 4. Technische Architektur (High-Level)

- **Frontend:** Next.js 14+ (App Router), React, TypeScript.
- **UI:** shadcn/ui und Tailwind CSS für ein modernes, responsives Design.
- **State Management & Backend-Anbindung:**
    - **Firebase:** Dient als primäres Backend.
        - **Firestore:** Für das Speichern von Spiel-Lobbys, globalen Highscores und Analyse-Logs.
        - **Firebase Auth:** Für die Benutzer-Authentifizierung (via Google).
        - **Firebase Functions (Callable):** Für serverseitige, gesicherte Aktionen wie das Beitreten oder Archivieren eines Spiels.
- **Echtzeit-Kommunikation (Koop):**
    - **WebRTC:** Der primäre Kanal für den Austausch von Spielzustands-Deltas zwischen Host und Client. Bietet minimale Latenz.
    - **WebSocket-Server (`ws-relay`):** Dient ausschließlich als **Signaling-Server**, um die WebRTC-Verbindung zwischen den Peers auszuhandeln. Es werden keine Spieldaten über den WebSocket geleitet.
- **Rendering & Spiellogik:**
    - **Game Session (`game-session.tsx`):** Das "Gehirn" des Spiels. Hier läuft die Haupt-Simulationsschleife (`simulate`), die nur auf dem Host-Client ausgeführt wird. Sie berechnet Gegnerbewegungen, Turmangriffe und erzeugt die `Deltas`.
    - **Delta-Synchronisation:** Anstatt den gesamten Spielzustand zu senden, erzeugt der Host nur "Deltas" (kleine Pakete, die nur die Änderungen beschreiben, z.B. `ENEMY_MOVE`, `TOWER_ATTACK`). Diese werden über WebRTC an den Client gesendet.
    - **VFX-Pipeline:** Visuelle Effekte wie Projektile und Explosionen werden auf einem HTML `<canvas>` gerendert, um eine hohe Performance zu gewährleisten und den DOM nicht zu überlasten.
