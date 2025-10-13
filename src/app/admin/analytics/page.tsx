// src/app/admin/analytics/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, AreaChart, Home } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

interface GameLog {
  id: string;
  gameId: string;
  createdAt: Date;
  status: string;
  logLength: number;
}

export default function AnalyticsPage() {
  const [logs, setLogs] = useState<GameLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const logsQuery = query(collection(db, 'games'), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(logsQuery);
        
        const fetchedLogs: GameLog[] = querySnapshot.docs.map(doc => {
          const data = doc.data();
          const createdAt = (data.createdAt as Timestamp)?.toDate() || new Date();
          return {
            id: doc.id,
            gameId: data.gameName || doc.id,
            createdAt: createdAt,
            status: data.gameStatus || 'unbekannt',
            logLength: data.gameLog?.length || 0,
          };
        });
        
        setLogs(fetchedLogs);
      } catch (err: any) {
        console.error("Error fetching game logs:", err);
        setError("Fehler beim Laden der Spieldaten. Prüfe die Konsolenausgabe.");
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Analyse-Dashboard</h1>
          <p className="text-muted-foreground">Übersicht aller gespielten Koop-Spiele.</p>
        </div>
        <Link href="/">
          <Button variant="outline">
            <Home className="mr-2 h-4 w-4" />
            Zurück zum Menü
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AreaChart className="text-primary" />
            Gespielte Spiele
          </CardTitle>
          <CardDescription>
            Wähle ein Spiel aus, um die detaillierte Netzwerkanalyse anzusehen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="mr-2 h-6 w-6 animate-spin" />
              <p>Lade Spieldaten aus Firestore...</p>
            </div>
          ) : error ? (
            <p className="text-destructive text-center py-10">{error}</p>
          ) : logs.length === 0 ? (
            <p className="text-muted-foreground text-center py-10">
              Noch keine Spiele gefunden. Schließe ein Koop-Spiel ab, um Daten zu generieren.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Spiel-Name</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Log-Einträge</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow 
                    key={log.id} 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/admin/analytics/${log.id}`)}
                  >
                    <TableCell className="font-mono text-xs">{log.gameId}</TableCell>
                    <TableCell>{log.createdAt.toLocaleString('de-DE')}</TableCell>
                    <TableCell>{log.status}</TableCell>
                    <TableCell className="text-right">{log.logLength}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
