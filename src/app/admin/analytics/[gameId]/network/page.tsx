
// src/app/admin/analytics/[gameId]/network/page.tsx
'use client';

import { useEffect, useState, use } from 'react';
import { collection, onSnapshot, orderBy, query, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, ArrowLeft, GitCommitHorizontal, Workflow, Users, CheckCircle2, XCircle, Zap, Info, Clock, BarChart } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface LogEntry {
  id: string;
  timestamp: Date;
  role: 'host' | 'client';
  event: string;
  details: any;
}

const eventStyles: Record<string, { icon: React.FC<any>, color: string, description: string }> = {
    SIGNALING_OPEN: { icon: CheckCircle2, color: 'text-green-400', description: 'Signaling-Kanal (WebSocket) erfolgreich geöffnet.' },
    SIGNALING_ERROR: { icon: XCircle, color: 'text-red-400', description: 'Ein Fehler ist im Signaling-Kanal aufgetreten.' },
    SIGNALING_CLOSE: { icon: XCircle, color: 'text-yellow-400', description: 'Signaling-Kanal wurde geschlossen.' },
    SIGNALING_RECONNECT_SCHEDULED: { icon: Clock, color: 'text-amber-400', description: 'Versuche, die Signaling-Verbindung wiederherzustellen.' },
    PC_CONNECTION_STATE_CHANGE: { icon: Workflow, color: 'text-blue-400', description: 'Der Status der Peer-to-Peer-Verbindung hat sich geändert.' },
    DC_OPEN: { icon: CheckCircle2, color: 'text-green-400', description: 'Der direkte Datenkanal (P2P) ist jetzt offen.' },
    DC_CLOSE: { icon: XCircle, color: 'text-yellow-400', description: 'Der direkte Datenkanal (P2P) wurde geschlossen.'},
    ICE_SELECTED: { icon: GitCommitHorizontal, color: 'text-purple-400', description: 'Ein Kandidaten-Paar wurde ausgewählt, um die P2P-Verbindung herzustellen.' },
    NET_TICK: { icon: BarChart, color: 'text-gray-400', description: 'Periodische Netzwerk-Statistiken.' },
    DEFAULT: { icon: Info, color: 'text-muted-foreground', description: 'Allgemeines Verbindungs-Event.' }
};

const getEventStyle = (eventName: string) => {
    for (const key in eventStyles) {
        if (eventName.includes(key)) {
            return eventStyles[key];
        }
    }
    if(eventName.includes('SIGNALING')) return eventStyles.SIGNALING_OPEN;
    if(eventName.includes('ERROR')) return eventStyles.SIGNALING_ERROR;
    if(eventName.includes('CLOSE')) return eventStyles.SIGNALING_CLOSE;
    if(eventName.includes('STATE_CHANGE')) return eventStyles.PC_CONNECTION_STATE_CHANGE;
    if(eventName.includes('OPEN')) return eventStyles.DC_OPEN;
    return eventStyles.DEFAULT;
}

export default function GameNetworkLogPage({ params }: { params: { gameId: string } }) {
  const { gameId } = use(params);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId) return;

    setLoading(true);
    const logsQuery = query(collection(db, `games/${gameId}/webrtc_logs`), orderBy('timestamp', 'asc'));
    
    const unsubscribe = onSnapshot(logsQuery, (querySnapshot) => {
      const fetchedLogs: LogEntry[] = querySnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          timestamp: (data.timestamp as Timestamp)?.toDate() || new Date(),
          role: data.role,
          event: data.event,
          details: data.details,
        };
      });
      setLogs(fetchedLogs);
      setLoading(false);
    }, (err: any) => {
      console.error("Error fetching network logs:", err);
      setError("Fehler beim Laden der Netzwerk-Logs.");
      setLoading(false);
    });

    return () => unsubscribe();
  }, [gameId]);
  
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="mr-2 h-8 w-8 animate-spin" />
        <p>Lade Netzwerk-Logs...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <XCircle className="h-12 w-12 text-destructive" />
        <p className="text-destructive text-center">{error}</p>
        <Link href={`/admin/analytics/${gameId}`}>
          <Button variant="outline"><ArrowLeft className="mr-2 h-4 w-4" /> Zurück zum Spiel</Button>
        </Link>
      </div>
    );
  }
  
  return (
    <main className="mx-auto max-w-4xl px-4 py-6 space-y-6">
      <Link href={`/admin/analytics/${gameId}`} className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 mb-4">
        <ArrowLeft className="h-4 w-4" />
        Zurück zur Spiel-Analyse
      </Link>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="text-primary" />
            WebRTC Verbindungs-Protokoll
          </CardTitle>
          <CardDescription>
            Chronologische Aufzeichnung der Peer-to-Peer Verbindungs-Events für Spiel <span className="font-mono text-xs">{gameId}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TooltipProvider>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Zeitstempel</TableHead>
                  <TableHead className="w-[100px]">Rolle</TableHead>
                  <TableHead>Event</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const {icon: Icon, color, description} = getEventStyle(log.event);
                  return (
                  <TableRow key={log.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {log.timestamp.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 })}
                    </TableCell>
                    <TableCell>
                      <Badge variant={log.role === 'host' ? 'default' : 'secondary'} className="capitalize">
                        {log.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="flex items-center gap-3">
                       <Tooltip>
                          <TooltipTrigger>
                            <Icon className={cn("h-5 w-5", color)} />
                          </TooltipTrigger>
                          <TooltipContent side="right">
                             <div className="p-1 max-w-sm">
                               <p className="font-bold mb-1">{description}</p>
                               {log.details ? (
                                 <pre className="text-xs bg-muted p-2 rounded-md overflow-auto">{JSON.stringify(log.details, null, 2)}</pre>
                               ) : <p className="text-xs text-muted-foreground">Keine Details</p>}
                             </div>
                          </TooltipContent>
                        </Tooltip>
                      <span className="font-mono text-xs">{log.event}</span>
                    </TableCell>
                  </TableRow>
                )})}
              </TableBody>
            </Table>
          </TooltipProvider>
          {logs.length === 0 && <p className="text-center text-muted-foreground py-10">Keine Verbindungs-Logs für dieses Spiel gefunden.</p>}
        </CardContent>
      </Card>
    </main>
  );
}
