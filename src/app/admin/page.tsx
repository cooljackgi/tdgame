'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  Database,
  Gamepad2,
  Loader2,
  Radio,
  RefreshCw,
  ShieldCheck,
  Swords,
  Trophy,
  Waves,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { latestBalanceBrowserReport } from '@/lib/balance-browser-report';

interface AdminOverview {
  status: 'healthy' | 'degraded' | 'error';
  checkedAt: string;
  latencyMs: number;
  projectId: string;
  environment: string;
  metrics: { games: number; scores: number; towers: number; waves: number };
  checks: Record<string, { ok: boolean; latencyMs?: number; towers?: number; waves?: number; status?: number }>;
  recentGames: Array<{ id: string; name: string; status: string; wave: number; createdAt: string | null }>;
}

const statusLabels: Record<string, string> = {
  firestore: 'Firestore',
  balancing: 'Balancing-Daten',
  signaling: 'WebRTC-Signaling',
  functions: 'Cloud Functions',
  adminSecret: 'Admin-Schutz',
};

export default function AdminCenterPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/overview', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Systemstatus konnte nicht geladen werden.');
      setOverview(data);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Systemstatus konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="outline" className="border-primary/30 text-primary">ADMIN CENTER</Badge>
            {overview && (
              <Badge variant={overview.status === 'healthy' ? 'default' : 'destructive'}>
                {overview.status === 'healthy' ? 'Alle Systeme bereit' : 'Prüfung erforderlich'}
              </Badge>
            )}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Technik & Betrieb</h1>
          <p className="mt-1 text-muted-foreground">Live-Diagnose für Backend, Spieldaten und Balancing.</p>
        </div>
        <Button onClick={() => void refresh()} variant="outline" disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Neu prüfen
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-3 pt-6 text-destructive">
            <AlertTriangle className="h-5 w-5" />{error}
          </CardContent>
        </Card>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Spiele', value: overview?.metrics.games, icon: Gamepad2, href: '/admin/analytics' },
          { label: 'Highscores', value: overview?.metrics.scores, icon: Trophy, href: '/scoreboard' },
          { label: 'Türme', value: overview?.metrics.towers, icon: Swords, href: '/balancing' },
          { label: 'Wellen', value: overview?.metrics.waves, icon: Waves, href: '/balancing/waves' },
        ].map(({ label, value, icon: Icon, href }) => (
          <Link href={href} key={label}>
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardContent className="flex items-center justify-between p-5">
                <div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-3xl font-bold">{loading ? '–' : value ?? 0}</p></div>
                <span className="rounded-xl bg-primary/10 p-3"><Icon className="h-6 w-6 text-primary" /></span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5 text-primary" />Systemstatus</CardTitle>
            <CardDescription>Direkte Prüfungen der produktiven Dienste.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {overview ? Object.entries(overview.checks).map(([name, check]) => (
              <div key={name} className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-3">
                  {name === 'firestore' ? <Database className="h-4 w-4" /> : name === 'signaling' ? <Radio className="h-4 w-4" /> : name === 'adminSecret' ? <ShieldCheck className="h-4 w-4" /> : <BarChart3 className="h-4 w-4" />}
                  <span>{statusLabels[name] || name}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  {typeof check.latencyMs === 'number' && <span className="text-muted-foreground">{check.latencyMs} ms</span>}
                  {check.ok ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <AlertTriangle className="h-5 w-5 text-destructive" />}
                </div>
              </div>
            )) : (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            )}
            {overview && (
              <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                Geprüft {new Date(overview.checkedAt).toLocaleString('de-DE')} · {overview.projectId}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div><CardTitle>Letzte Spiele</CardTitle><CardDescription>Die zuletzt angelegten Sessions in Firestore.</CardDescription></div>
            <Button asChild variant="outline" size="sm"><Link href="/admin/analytics">Alle anzeigen</Link></Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Spiel</TableHead><TableHead>Status</TableHead><TableHead>Welle</TableHead><TableHead className="text-right">Zeit</TableHead></TableRow></TableHeader>
              <TableBody>
                {overview?.recentGames.map((game) => (
                  <TableRow key={game.id}>
                    <TableCell><Link className="font-medium hover:text-primary" href={`/admin/analytics/${game.id}`}>{game.name}</Link><div className="max-w-48 truncate font-mono text-[10px] text-muted-foreground">{game.id}</div></TableCell>
                    <TableCell><Badge variant="secondary">{game.status}</Badge></TableCell>
                    <TableCell>{game.wave}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{game.createdAt ? new Date(game.createdAt).toLocaleString('de-DE') : '–'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!loading && overview?.recentGames.length === 0 && <p className="py-10 text-center text-muted-foreground">Noch keine Spiele vorhanden.</p>}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><Gamepad2 className="h-5 w-5 text-primary" />Browser-Abnahme Einzelspieler</CardTitle>
            <CardDescription>{latestBalanceBrowserReport.layout} · {latestBalanceBrowserReport.difficulty} · Startkosten {latestBalanceBrowserReport.startCost}</CardDescription>
          </div>
          <Badge>Browser-Abnahme bestanden</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">{latestBalanceBrowserReport.finding}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Erreichte Welle</p><p className="text-2xl font-semibold">{latestBalanceBrowserReport.reachedWave}</p></div>
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Kills</p><p className="text-2xl font-semibold">{latestBalanceBrowserReport.totalKills}</p></div>
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Leaks</p><p className="text-2xl font-semibold">{latestBalanceBrowserReport.totalLeaks}</p></div>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Welle</TableHead><TableHead>Kills</TableHead><TableHead>Leaks</TableHead><TableHead className="text-right">Dauer</TableHead></TableRow></TableHeader>
            <TableBody>{latestBalanceBrowserReport.waves.map((wave) => (
              <TableRow key={wave.wave}><TableCell>{wave.wave}</TableCell><TableCell>{wave.kills}</TableCell><TableCell>{wave.leaks}</TableCell><TableCell className="text-right">{wave.durationSec.toFixed(1)} s</TableCell></TableRow>
            ))}</TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">Geprüft {new Date(latestBalanceBrowserReport.checkedAt).toLocaleString('de-DE')} · Build {latestBalanceBrowserReport.build}</p>
        </CardContent>
      </Card>
    </main>
  );
}
