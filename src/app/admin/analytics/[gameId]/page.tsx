
// src/app/admin/analytics/[gameId]/page.tsx
'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useParams } from 'next/navigation';
import { doc, Timestamp, collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, ArrowLeft, Network, Users, Gamepad2, AlertCircle, Zap, Terminal, Wifi, WifiOff, Download } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import AnalyticsChart from '@/components/admin/AnalyticsChart';
import { normalizePlayers } from '@/lib/player-utils';
import type { Player } from '@/lib/game-data/types';
import { useWebRTC, type NetMsg } from '@/hooks/use-webrtc';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn, formatBytes } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface GameData {
  id: string;
  gameName: string;
  createdAt: Date;
  status: string;
  gameLog?: any[];
  players: Player[];
  difficulty: string;
  currentWave: number;
}

const LiveMonitor = ({ gameId }: { gameId: string }) => {
    const { lastMessage, isConnected, packetsPerSecond, bytesPerSecond } = useWebRTC(gameId, false, auth.currentUser, true);
    const [messages, setMessages] = useState<NetMsg[]>([]);
    const allMessagesRef = useRef<NetMsg[]>([]);
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();

    useEffect(() => {
        toast({
            title: isConnected ? "Live-Monitor Verbunden" : "Live-Monitor Getrennt",
            description: isConnected ? "Empfange Echtzeit-Daten..." : "Versuche Verbindung zum Relay aufzubauen...",
            variant: isConnected ? "default" : "destructive",
            duration: 2000,
        });
    }, [isConnected, toast]);

    useEffect(() => {
        if (lastMessage) {
            setMessages(prev => [...prev, lastMessage].slice(-100)); // Keep last 100 messages for display
            allMessagesRef.current.push(lastMessage); // Store all messages for export
        }
    }, [lastMessage]);

    useEffect(() => {
        // Auto-scroll to bottom
        if (scrollAreaRef.current) {
            scrollAreaRef.current.scrollTo({ top: scrollAreaRef.current.scrollHeight, behavior: 'smooth' });
        }
    }, [messages]);

    const handleExport = () => {
        const dataStr = JSON.stringify(allMessagesRef.current, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `game-stream-${gameId}-${new Date().toISOString()}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast({ title: "Daten exportiert", description: `${allMessagesRef.current.length} Nachrichten wurden in die JSON-Datei geschrieben.`});
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                        <Terminal className="text-primary"/> Live-Datenstrom
                    </CardTitle>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {isConnected ? <Wifi className="h-4 w-4 text-green-400"/> : <WifiOff className="h-4 w-4 text-red-400"/>}
                            {packetsPerSecond} P/s, {formatBytes(bytesPerSecond)}/s
                        </div>
                        <Button onClick={handleExport} variant="outline" size="sm" disabled={allMessagesRef.current.length === 0}>
                            <Download className="mr-2 h-4 w-4" />
                            Exportieren
                        </Button>
                    </div>
                </div>
                <CardDescription>
                   Ungefilterte Nachrichten, die vom Host an die Clients gesendet werden.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-64 w-full rounded-md border bg-muted/30 p-2 font-mono text-xs" ref={scrollAreaRef}>
                   {messages.map((msg, index) => {
                       const payloadString = JSON.stringify(msg.payload);
                       const isSnapshot = payloadString.includes('GAME_STATE_SNAPSHOT');
                       const isBig = payloadString.length > 200;
                       return (
                        <p key={index} className={cn("whitespace-pre-wrap break-all", isBig && !isSnapshot && "text-amber-300", isSnapshot && "text-blue-300")}>
                           <span className="text-primary font-semibold">{msg.type}: </span> 
                           {isBig ? `[${isSnapshot ? 'SNAPSHOT' : 'GROSSES PAKET'}, ${payloadString.length} Bytes]` : payloadString}
                        </p>
                       )
                   })}
                   {messages.length === 0 && <p className="text-muted-foreground italic">Warte auf Nachrichten vom Spiel-Host...</p>}
                </ScrollArea>
            </CardContent>
        </Card>
    );
};


export default function GameAnalyticsDetailPage() {
  const params = useParams();
  const gameId = params.gameId as string;
  const [gameData, setGameData] = useState<GameData | null>(null);
  const [gameLog, setGameLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const combinedLog = useMemo(() => {
    return [...(gameLog ?? [])].sort((a,b) => (a.timestamp?.toMillis() || a.clientTs || 0) - (b.timestamp?.toMillis() || b.clientTs || 0))
  }, [gameLog]);

  useEffect(() => {
    if (!gameId) return;

    let unsubscribeGame: () => void;
    let unsubscribeLogs: () => void;

    const fetchGameData = async () => {
      try {
        const gameDocRef = doc(db, 'games', gameId);
        unsubscribeGame = onSnapshot(gameDocRef, (docSnap) => {
          if (!docSnap.exists()) {
            setError("Spiel nicht gefunden.");
            setLoading(false);
            return;
          }

          const data = docSnap.data();
          setGameData({
            id: docSnap.id,
            gameName: data.gameName || docSnap.id,
            createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
            status: data.gameStatus || 'unbekannt',
            players: normalizePlayers(data.players),
            difficulty: data.difficulty || 'Unbekannt',
            currentWave: data.currentWave || 0,
          });
          setLoading(false);
        });

        const logCollectionRef = collection(db, `games/${gameId}/game_logs`);
        const logQuery = query(logCollectionRef, orderBy('timestamp', 'asc'));
        unsubscribeLogs = onSnapshot(logQuery, (snapshot) => {
          const logs = snapshot.docs.map(doc => doc.data());
          setGameLog(logs);
        });

      } catch (err: any) {
        console.error("Error fetching game data:", err);
        setError("Fehler beim Laden der Spieldetails.");
        setLoading(false);
      }
    };

    fetchGameData();
    
    return () => {
        if (unsubscribeGame) unsubscribeGame();
        if (unsubscribeLogs) unsubscribeLogs();
    }
  }, [gameId]);
  
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="mr-2 h-8 w-8 animate-spin" />
        <p>Lade Spieldetails...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-destructive text-center">{error}</p>
        <Link href="/admin/analytics">
          <Button variant="outline"><ArrowLeft className="mr-2 h-4 w-4" /> Zurück zur Übersicht</Button>
        </Link>
      </div>
    );
  }
  
  if (!gameData) return null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/analytics" className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 mb-2">
            <ArrowLeft className="h-4 w-4" />
            Zurück zur Übersicht
          </Link>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">{gameData.gameName}</h1>
          <p className="font-mono text-xs text-muted-foreground mt-1">{gameData.id}</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm w-full md:w-auto">
            <div className="p-3 rounded-lg bg-card border text-center">
                <div className="text-muted-foreground">Status</div>
                <div className="font-bold text-lg">{gameData.status}</div>
            </div>
            <div className="p-3 rounded-lg bg-card border text-center">
                <div className="text-muted-foreground">Schwierigkeit</div>
                <div className="font-bold text-lg">{gameData.difficulty}</div>
            </div>
            <div className="p-3 rounded-lg bg-card border text-center">
                <div className="text-muted-foreground">Welle</div>
                <div className="font-bold text-lg">{gameData.currentWave}</div>
            </div>
             <div className="p-3 rounded-lg bg-card border text-center">
                <div className="text-muted-foreground">Datum</div>
                <div className="font-bold">{gameData.createdAt.toLocaleDateString('de-DE')}</div>
            </div>
        </div>
      </div>
      
       <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Users /> Spieler</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {gameData.players.map(p => p && (
                <div key={p.id} className="flex items-center gap-4 p-3 bg-muted/30 rounded-lg">
                    <img src={p.avatarUrl || '/avatar-placeholder.png'} alt={p.name} className="h-12 w-12 rounded-full" />
                    <div>
                        <div className="font-bold">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.id === 'player1' ? 'Host' : 'Client'}</div>
                    </div>
                </div>
            ))}
          </CardContent>
        </Card>
      
      {gameData.status === 'playing' && <LiveMonitor gameId={gameId} />}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Network className="text-primary" />
              Gespeicherte Log-Daten
            </CardTitle>
            <Link href={`/admin/analytics/${gameId}/network`}>
                <Button variant="outline">
                    <Zap className="mr-2 h-4 w-4"/>
                    Detailliertes Verbindungs-Protokoll
                </Button>
            </Link>
          </div>
           <CardDescription>
            Analyse der Host-FPS und der Paket-Statistiken über die Zeit. Die Zeitachse beginnt mit dem Start des Loggings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {combinedLog && combinedLog.length > 0 ? (
            <AnalyticsChart data={combinedLog} />
          ) : (
            <p className="text-muted-foreground text-center py-10">
              Für dieses Spiel wurden keine Log-Daten gefunden.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
