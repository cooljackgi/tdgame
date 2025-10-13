
# Plan: Umstieg von WebSocket-Relay auf WebRTC

Dieses Dokument skizziert die technischen Schritte für das Upgrade der Echtzeit-Kommunikation von einem zentralen WebSocket-Relay auf eine Peer-to-Peer (P2P) Architektur mit WebRTC.

## 1. Ziele

- **Latenz reduzieren:** Die primäre Motivation ist die Reduzierung der Latenz für die Mehrheit der Spieler durch direkte Client-zu-Client-Verbindungen.
- **Serverlast und Kosten senken:** Spieldaten (die den Großteil des Traffics ausmachen) sollen direkt zwischen den Spielern ausgetauscht werden, um unseren zentralen Server zu entlasten.
- **Robustheit erhöhen:** Eine standardisierte WebRTC-Lösung ist oft robuster im Umgang mit verschiedenen Netzwerk-Szenarien.
- **Grundlage für Latenz-Messung schaffen:** WebRTC bietet eingebaute Mechanismen zur Überwachung der Verbindungsqualität.

## 2. Architektur-Entwurf

Wir ersetzen das "dumme" Relay-Modell durch ein "intelligentes" Aushandlungs-Modell.

### 2.1. Der Signaling-Server

Der bestehende `ws-relay`-Server wird zu einem **Signaling-Server**. Seine Rolle ändert sich fundamental:

- **Bisher:** Leitet jedes Spiel-Datenpaket an alle Clients im Raum weiter.
- **Zukünftig:** Dient nur noch dem **Aushandeln** der P2P-Verbindung. Er leitet *keine* Spieldaten mehr weiter, sondern nur noch die Nachrichten, die für den Verbindungsaufbau nötig sind:
    1.  **Offer (Angebot):** Spieler 1 sendet eine Verbindungsanfrage (SDP Offer) an den Signaling-Server.
    2.  **Answer (Antwort):** Der Server leitet das Angebot an Spieler 2 weiter. Spieler 2 erstellt eine Antwort (SDP Answer) und sendet sie zurück zum Server, der sie wiederum an Spieler 1 weiterleitet.
    3.  **ICE-Kandidaten:** Während dieses Prozesses finden beide Clients heraus, wie sie über das Internet erreichbar sind (ihre "ICE-Kandidaten"). Diese "Adressen" tauschen sie ebenfalls über den Signaling-Server aus.

Sobald die Verbindung steht, hat der Signaling-Server seine Hauptaufgabe für diese Sitzung erledigt.

### 2.2. Die Client-Verbindung (WebRTC)

Jeder Client (Browser) wird eine `RTCPeerConnection` Instanz erstellen.

- **STUN-Server (Die öffentliche Adresse):** Wir konfigurieren die Verbindung so, dass sie den öffentlichen und kostenlosen STUN-Server von Google nutzt: `stun:stun.l.google.com:19302`. Dieser Dienst hilft den Clients, ihre öffentliche IP-Adresse hinter einem NAT-Router (z.B. der heimischen Fritz!Box) zu ermitteln. Wir müssen hierfür keinen eigenen Server betreiben.
- **Data Channels:** Anstelle der WebSocket-`onmessage`-Events wird ein `RTCDataChannel` für den Austausch der Spiel-Deltas (Gegnerpositionen, Angriffe etc.) verwendet. Dieser Kanal ist Teil der direkten P2P-Verbindung.
- **Fallback (TURN):** In dieser ersten Phase wird **kein** TURN-Server implementiert. Das bedeutet, dass Spiele für Spieler hinter sehr restriktiven Firewalls (ca. 10-15% der Fälle) fehlschlagen können. Die Implementierung eines TURN-Servers (z.B. via OpenRelay oder einem eigenen Setup) ist ein wichtiger Folgeschritt zur Erhöhung der Robustheit.

## 3. Implementierungsschritte

### Schritt 1: Serverseitige Anpassungen (`ws-relay/server.js`)

1.  Die `on('message')`-Logik wird komplett umgeschrieben. Anstatt die Nachricht einfach an alle Peers zu broadcasten, wird sie nun gezielt an den/die anderen Spieler im Raum weitergeleitet. Es ist jetzt eine "Peer-to-Peer"-Signalisierung.
2.  Der Server muss nicht mehr wissen, wer der Host ist. Er leitet nur noch Nachrichten zwischen den Teilnehmern eines Raums weiter.

### Schritt 2: Client-seitige Anpassungen

1.  **Neuer Hook `useWebRTC.ts`:**
    - Dieser Hook ersetzt `use-websocket.ts`.
    - Er stellt eine WebSocket-Verbindung zum Signaling-Server her.
    - Er erstellt und verwaltet das `RTCPeerConnection`-Objekt (inklusive Konfiguration mit dem STUN-Server).
    - Er implementiert die Logik zum Erstellen und Austauschen von Offer, Answer und ICE-Kandidaten über den Signaling-Server.
    - Er öffnet einen `RTCDataChannel` namens `game_data`.
    - Er gibt den Zustand der Verbindung (`connecting`, `connected`, `failed`) sowie eine `send`-Funktion für den Data Channel zurück.

2.  **Anpassung von `game-session.tsx`:**
    - Der `useWebSocket`-Hook wird durch den neuen `useWebRTC`-Hook ersetzt.
    - Die Funktion `sendMessage` des Hooks wird nun verwendet, um die serialisierten Game-Deltas über den `RTCDataChannel` zu senden.
    - Die `onmessage`-Logik wird an den `onmessage`-Eventhandler des `RTCDataChannel` gehängt.

### Schritt 4: Testing & Verifizierung

- **Lokaler Test:** Zwei Browser-Tabs auf dem lokalen Rechner müssen eine P2P-Verbindung aufbauen und Daten austauschen können.
- **Live-Test:** Testen über verschiedene Netzwerke hinweg, um die Funktionalität des STUN-Prozesses zu validieren.
- **Monitoring:** Überprüfen der Server-Logs, um sicherzustellen, dass nur noch Signalisierungs-Nachrichten und keine Spieldaten mehr über den Server laufen.
