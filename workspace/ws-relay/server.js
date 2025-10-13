
// Minimaler WS-Relay für Räume nach ?gameId=...
import http from "http";
import { WebSocketServer } from "ws";
import url from "url";

const PORT = process.env.PORT || 8080;

// HTTP-Server (Cloud Run will darauf terminieren)
const server = http.createServer((req, res) => {
  // Für einfache Healthchecks / Liveness
  if (req.url === "/") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("webrtc-signaling-server ok\n");
    return;
  }
  res.writeHead(404);
  res.end();
});

// WS-Server, der das HTTP-Upgrade nutzt
const wss = new WebSocketServer({ noServer: true });

// Räume nach gameId. Jeder Raum hat jetzt Spieler und Monitore.
const rooms = new Map(); // Map<string, { players: Set<WebSocket>, monitors: Set<WebSocket> }>

function initializeRoom(gameId) {
    if (!rooms.has(gameId)) {
        rooms.set(gameId, {
            players: new Set(),
            monitors: new Set()
        });
    }
    return rooms.get(gameId);
}

function joinRoom(ws, gameId, isMonitor) {
  const room = initializeRoom(gameId);

  ws.__roomId = gameId;
  ws.__isMonitor = isMonitor;

  if (isMonitor) {
    room.monitors.add(ws);
  } else {
    // Verhindern, dass mehr als 2 Spieler einem Raum beitreten
    const playerCount = [...room.players].filter(p => !p.__isMonitor).length;
    if (playerCount >= 2) {
        console.warn("[CONN CLOSE] room full", { gameId, playerCount });
        ws.close(1008, "Room is full");
        return;
    }
    room.players.add(ws);
  }

  const playerCount = [...room.players].filter(p => !p.__isMonitor).length;
  console.log("[JOIN]", { gameId, isMonitor, total: room.players.size + room.monitors.size, players: playerCount, monitors: room.monitors.size });
}

function leaveRoom(ws) {
  const gameId = ws.__roomId;
  if (!gameId) return;
  
  const room = rooms.get(gameId);
  if (room) {
    if (ws.__isMonitor) {
        room.monitors.delete(ws);
    } else {
        room.players.delete(ws);
    }

    if (room.players.size === 0 && room.monitors.size === 0) {
        rooms.delete(gameId);
        console.log(`[ROOM DELETE] Room ${gameId} deleted.`);
    }
  }
}

// Heartbeat (damit tote Verbindungen aufgeräumt werden)
function heartbeat() { this.isAlive = true; }

wss.on("connection", (ws, request) => {
  ws.isAlive = true;
  ws.on("pong", heartbeat);

  const { query } = url.parse(request.url, true);
  const gameId = query?.gameId;
  const isMonitor = query?.monitor === '1';
  
  // Diese Prüfung ist jetzt redundant, da sie im Upgrade-Handler stattfindet,
  // aber als doppelter Boden schadet sie nicht.
  if (!gameId || typeof gameId !== "string") {
    console.warn("[CONN CLOSE] missing gameId");
    ws.close(1008, "Missing gameId");
    return;
  }

  joinRoom(ws, gameId, isMonitor);
  if (!ws.__roomId || ws.readyState === ws.CLOSING || ws.readyState === ws.CLOSED) {
    return; // Wenn der Raum voll war und die Verbindung geschlossen wurde
  }

  ws.on("message", (data, isBinary) => {
    // Monitore können nur zuhören, nicht senden.
    if (ws.__isMonitor) return;

    const room = rooms.get(gameId);
    if (!room) return;

    // Nachricht an den anderen Spieler weiterleiten
    for (const peer of room.players) {
      if (peer !== ws && peer.readyState === 1) { // WebSocket.OPEN === 1
        peer.send(data, { binary: isBinary });
      }
    }
    // Kopie der Nachricht an alle Monitore senden
    for (const monitor of room.monitors) {
        if (monitor.readyState === 1) {
            monitor.send(data, { binary: isBinary });
        }
    }
  });

  ws.on("close", (code, reason) => {
    const r = reason instanceof Buffer ? reason.toString() : String(reason || "");
    console.log("[CLOSE]", { gameId, isMonitor: ws.__isMonitor, code, reason: r });
    leaveRoom(ws);
  });
  
  ws.on("error", (err) => {
    console.error("[ERROR]", { gameId, isMonitor: ws.__isMonitor, err: String(err) });
    leaveRoom(ws);
  });
});

// Cloud Run Upgrade-Handling
server.on("upgrade", (request, socket, head) => {
  const { pathname } = url.parse(request.url);
  console.log(`[UPGRADE] Attempt for path: ${pathname}`);

  if (pathname !== "/ws") {
    console.warn(`[UPGRADE DENY] Incorrect path: ${pathname}. Destroying socket.`);
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

// Ping-Intervall zum Aufräumen
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log(`[HEARTBEAT] Terminating dead connection for room ${ws.__roomId}`);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on("close", () => clearInterval(interval));

server.listen(PORT, () => {
  console.log(`webrtc-signaling-server listening on :${PORT}`);
});
