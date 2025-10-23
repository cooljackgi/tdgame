
'use client';

import { useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { Home, Waves, Save, Loader2, BarChart2, RefreshCw, Timer } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { waves as initialWaves, waveFormulaCoefficients, generateProceduralWave } from '@/lib/game-data/enemies';
import type { Wave, WaveEnemyData, EnemyType } from '@/lib/game-data/types';
import { useToast } from '@/hooks/use-toast';
import { saveWaveData } from '@/ai/flows/save-waves-flow';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';


type FormulaCoefficients = typeof waveFormulaCoefficients;
const ENEMY_TYPES: EnemyType[] = ['standard', 'schnell', 'gepanzert', 'heilend', 'boss'];

export default function WavesBalancingPage() {
  const [formulas, setFormulas] = useState<FormulaCoefficients>(waveFormulaCoefficients);
  const [waves, setWaves] = useState<Wave[]>(() => JSON.parse(JSON.stringify(initialWaves.slice(0, 50))));
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const handleFormulaChange = (key: keyof FormulaCoefficients, value: string) => {
      const numericValue = parseFloat(value);
      if (isNaN(numericValue)) return;
      setFormulas(prev => ({...prev, [key]: numericValue}));
  };

  const handleWaveChange = (waveNumber: number, field: keyof WaveEnemyData, value: string | number) => {
    setWaves(currentWaves => 
      currentWaves.map(wave => {
        if (wave.waveNumber === waveNumber) {
          const newEnemies = { ...wave.enemies };
          if (field === 'type') {
            newEnemies.type = value as EnemyType;
          } else {
            const numericValue = typeof value === 'string' ? parseFloat(value) : value;
             if (!isNaN(numericValue)) {
                (newEnemies as any)[field] = numericValue;
             }
          }
          return { ...wave, enemies: newEnemies };
        }
        return wave;
      })
    );
  };
  
  const handleApplyFormulasToAll = () => {
    setWaves(currentWaves => 
      currentWaves.map(w => generateProceduralWave(w.waveNumber, formulas))
    );
    toast({ title: 'Formeln angewendet', description: 'Alle Wellen wurden basierend auf den aktuellen Formeln neu generiert.' });
  };

  const handleSaveChanges = async () => {
    setIsSaving(true);
    try {
        const result = await saveWaveData(waves);
        if (result.success) {
            toast({
                title: "Speichern erfolgreich!",
                description: "Die Wellen-Daten wurden aktualisiert. Das Spiel muss neu gestartet werden, um die Änderungen zu sehen.",
            });
        } else {
            throw new Error(result.error || 'Unbekannter Fehler');
        }
    } catch (e: any) {
        toast({
            title: "Fehler beim Speichern",
            description: e.message || "Die Daten konnten nicht gespeichert werden.",
            variant: "destructive",
        });
    } finally {
        setIsSaving(false);
    }
  };
  
  const chartData = useMemo(() => {
    return waves.map(wave => ({
      name: `W${wave.waveNumber}`,
      hp: wave.enemies.health,
      count: wave.enemies.count,
    }));
  }, [waves]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Dashboard für Wellen-Balancing</h1>
          <p className="text-muted-foreground">Passe globale Formeln oder einzelne Wellen an, um die Schwierigkeitskurve zu formen.</p>
        </div>
        <div className="flex gap-2">
           <Button onClick={handleSaveChanges} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {isSaving ? 'Speichern...' : 'Änderungen Speichern'}
          </Button>
          <Link href="/">
            <Button variant="outline">
              <Home className="mr-2 h-4 w-4" />
              Zurück zum Menü
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BarChart2 className="text-primary" />Vorschau: Gegner-HP & Anzahl pro Welle</CardTitle>
        </CardHeader>
        <CardContent>
            <ResponsiveContainer width="100%" height={300}>
                 <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={1}/>
                    <YAxis yAxisId="left" orientation="left" stroke="hsl(var(--primary))" tick={{ fontSize: 12 }} />
                    <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--accent))" tick={{ fontSize: 12 }} />
                    <Tooltip
                        contentStyle={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
                    />
                    <Legend />
                    <Bar yAxisId="left" dataKey="hp" name="HP" fill="hsl(var(--primary))" />
                    <Bar yAxisId="right" dataKey="count" name="Anzahl" fill="hsl(var(--accent))" />
                </BarChart>
            </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="flex items-center gap-2"><Waves className="text-primary" />Formel-Parameter</CardTitle>
                <CardDescription>
                    Passe die globalen Formeln an und wende sie auf alle Wellen an.
                </CardDescription>
              </div>
              <Button onClick={handleApplyFormulasToAll} variant="secondary">
                <RefreshCw className="mr-2 h-4 w-4" />
                Formeln auf alle Wellen anwenden
              </Button>
            </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="p-4 border rounded-lg space-y-4 bg-muted/20">
                <h3 className="font-semibold text-lg">Lebenspunkte (HP)</h3>
                <div className="space-y-2">
                    <Label htmlFor="hp_base">Basis-HP</Label>
                    <Input id="hp_base" type="number" value={formulas.hp_base} onChange={e => handleFormulaChange('hp_base', e.target.value)} />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="hp_exponent">HP-Exponent</Label>
                    <Input id="hp_exponent" type="number" step="0.01" value={formulas.hp_exponent} onChange={e => handleFormulaChange('hp_exponent', e.target.value)} />
                </div>
            </div>
             <div className="p-4 border rounded-lg space-y-4 bg-muted/20">
                <h3 className="font-semibold text-lg">Geschwindigkeit</h3>
                <div className="space-y-2">
                    <Label htmlFor="speed_base">Basis-Geschw.</Label>
                    <Input id="speed_base" type="number" step="0.1" value={formulas.speed_base} onChange={e => handleFormulaChange('speed_base', e.target.value)} />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="speed_exponent">Geschw.-Exponent</Label>
                    <Input id="speed_exponent" type="number" step="0.001" value={formulas.speed_exponent} onChange={e => handleFormulaChange('speed_exponent', e.target.value)} />
                </div>
            </div>
             <div className="p-4 border rounded-lg space-y-4 bg-muted/20">
                <h3 className="font-semibold text-lg">Anzahl</h3>
                <div className="space-y-2">
                    <Label htmlFor="count_base">Basis-Anzahl</Label>
                    <Input id="count_base" type="number" value={formulas.count_base} onChange={e => handleFormulaChange('count_base', e.target.value)} />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="count_increment">Anzahl-Wachstum</Label>
                    <Input id="count_increment" type="number" value={formulas.count_increment} onChange={e => handleFormulaChange('count_increment', e.target.value)} />
                </div>
            </div>
             <div className="p-4 border rounded-lg space-y-4 bg-muted/20">
                <h3 className="font-semibold text-lg">Belohnung (Bounty)</h3>
                <div className="space-y-2">
                    <Label htmlFor="bounty_base">Basis-Belohnung</Label>
                    <Input id="bounty_base" type="number" value={formulas.bounty_base} onChange={e => handleFormulaChange('bounty_base', e.target.value)} />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="bounty_exponent">Belohnungs-Exponent</Label>
                    <Input id="bounty_exponent" type="number" step="0.001" value={formulas.bounty_exponent} onChange={e => handleFormulaChange('bounty_exponent', e.target.value)} />
                </div>
            </div>
            <div className="p-4 border rounded-lg space-y-4 bg-muted/20">
                <h3 className="font-semibold text-lg flex items-center gap-2"><Timer /> Spawn-Verzögerung</h3>
                <div className="space-y-2">
                    <Label htmlFor="spawn_delay_base">Basis-Verzögerung (ms)</Label>
                    <Input id="spawn_delay_base" type="number" value={formulas.spawn_delay_base} onChange={e => handleFormulaChange('spawn_delay_base', e.target.value)} />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="spawn_delay_min">Min. Verzögerung (ms)</Label>
                    <Input id="spawn_delay_min" type="number" step="10" value={formulas.spawn_delay_min} onChange={e => handleFormulaChange('spawn_delay_min', e.target.value)} />
                </div>
            </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>Individuelle Wellen anpassen</CardTitle>
          <CardDescription>Hier kannst du jede Welle einzeln feinjustieren. Änderungen hier überschreiben die Formel-Generierung für die jeweilige Welle.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[600px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>Welle</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead className="w-[100px]">Anzahl</TableHead>
                  <TableHead className="w-[100px]">HP</TableHead>
                  <TableHead className="w-[100px]">Rüstung</TableHead>
                  <TableHead className="w-[100px]">Geschw.</TableHead>
                  <TableHead className="w-[100px]">Belohnung</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {waves.map(wave => (
                  <TableRow key={wave.waveNumber}>
                    <TableCell className="font-medium">{wave.waveNumber}</TableCell>
                    <TableCell>
                      <Select 
                        value={wave.enemies.type} 
                        onValueChange={(val: EnemyType) => handleWaveChange(wave.waveNumber, 'type', val)}
                      >
                        <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ENEMY_TYPES.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input type="number" value={wave.enemies.count} onChange={e => handleWaveChange(wave.waveNumber, 'count', e.target.value)} className="h-8" /></TableCell>
                    <TableCell><Input type="number" value={wave.enemies.health} onChange={e => handleWaveChange(wave.waveNumber, 'health', e.target.value)} className="h-8" /></TableCell>
                    <TableCell><Input type="number" value={wave.enemies.armor} onChange={e => handleWaveChange(wave.waveNumber, 'armor', e.target.value)} className="h-8" /></TableCell>
                    <TableCell><Input type="number" step="0.1" value={wave.enemies.speed} onChange={e => handleWaveChange(wave.waveNumber, 'speed', e.target.value)} className="h-8" /></TableCell>
                    <TableCell><Input type="number" value={wave.enemies.bounty} onChange={e => handleWaveChange(wave.waveNumber, 'bounty', e.target.value)} className="h-8" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
