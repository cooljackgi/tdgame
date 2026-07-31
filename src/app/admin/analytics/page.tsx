'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AreaChart, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface GameLog {
  id: string;
  gameId: string;
  createdAt: string;
  status: string;
  logLength: number;
  currentWave: number;
}

function deriveAnalyticsStatus(gameStatus: unknown, logCount: number, currentWave: number): string {
  const normalizedStatus = typeof gameStatus === 'string' ? gameStatus.toLowerCase() : 'unbekannt';
  if (normalizedStatus === 'gameover' || normalizedStatus === 'finished') return 'beendet';
  if (['playing', 'paused', 'archived'].includes(normalizedStatus)) return normalizedStatus;
  if (currentWave > 0 || logCount > 0) return 'gespielt';
  return normalizedStatus;
}

export default function AnalyticsPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<GameLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/firestore-read?mode=games&limit=100', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Spieldaten konnten nicht geladen werden.');
      setLogs(result.games.map((game: any) => ({
        id: game.id,
        gameId: game.gameId,
        createdAt: game.createdAt,
        status: deriveAnalyticsStatus(game.gameStatus, game.logCount, game.currentWave),
        logLength: game.logCount,
        currentWave: game.currentWave,
      })));
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Spieldaten konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchLogs(); }, [fetchLogs]);

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Spiel-Analyse</h1>
          <p className="text-muted-foreground">Serverseitig geladene Sessions und Diagnose-Logs.</p>
        </div>
        <Button variant="outline" onClick={() => void fetchLogs()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Aktualisieren
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><AreaChart className="text-primary" />Gespielte Spiele</CardTitle>
          <CardDescription>Wähle ein Spiel für Performance- und Netzwerkanalyse.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="mr-2 h-6 w-6 animate-spin" />Lade Spieldaten...</div>
          ) : error ? (
            <p className="py-10 text-center text-destructive">{error}</p>
          ) : logs.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">Noch keine Spiele gefunden.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Spiel</TableHead><TableHead>Datum</TableHead><TableHead>Status</TableHead><TableHead>Welle</TableHead><TableHead className="text-right">Logs</TableHead></TableRow></TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id} className="cursor-pointer hover:bg-muted/50" onClick={() => router.push(`/admin/analytics/${log.id}`)}>
                    <TableCell><div className="font-medium">{log.gameId}</div><div className="font-mono text-[10px] text-muted-foreground">{log.id}</div></TableCell>
                    <TableCell>{new Date(log.createdAt).toLocaleString('de-DE')}</TableCell>
                    <TableCell><Badge variant="secondary">{log.status}</Badge></TableCell>
                    <TableCell>{log.currentWave}</TableCell>
                    <TableCell className="text-right">{log.logLength}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Button asChild variant="ghost"><Link href="/admin">Zurück zum Systemstatus</Link></Button>
    </main>
  );
}
