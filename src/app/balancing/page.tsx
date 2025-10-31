
// src/app/balancing/page.tsx
'use client';

import { useMemo, useState, ChangeEvent } from 'react';
import Link from 'next/link';
import { Home, BarChart2, Zap, Save, Loader2, Heart } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { towers as initialTowers } from '@/lib/game-data/towers';
import type { Tower, TowerEffect } from '@/lib/game-data/types';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { saveBalancingData } from '@/ai/flows/save-balancing-flow';
import { useToast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';

const EffectInput = ({ label, value, onChange, type = 'number', step = 0.1, min = 0 }: { label: string, value: number, onChange: (e: ChangeEvent<HTMLInputElement>) => void, type?: string, step?: number, min?: number }) => (
    <div className="grid grid-cols-2 items-center gap-2">
        <Label htmlFor={label} className="text-xs text-muted-foreground truncate">{label}</Label>
        <Input
            id={label}
            type={type}
            value={value}
            onChange={onChange}
            className="h-7"
            step={step}
            min={min}
        />
    </div>
);

const EffectEditor = ({ tower, onEffectChange }: { tower: Tower, onEffectChange: (id: string, field: keyof TowerEffect, value: string | number) => void }) => {
    if (!tower.effect) return <div className="text-xs text-muted-foreground">Kein Effekt</div>;

    const { type, ...params } = tower.effect;

    const renderInputs = () => {
        switch (type) {
            case 'slow':
            case 'vulnerability':
                return (
                    <>
                        <EffectInput label="Stärke (%)" value={(params.potency ?? 0) * 100} onChange={(e) => onEffectChange(tower.id, 'potency', parseFloat(e.target.value) / 100)} step={1} />
                        <EffectInput label="Dauer (s)" value={(params.duration ?? 0) / 1000} onChange={(e) => onEffectChange(tower.id, 'duration', parseFloat(e.target.value) * 1000)} step={0.1} />
                    </>
                );
            case 'stun':
            case 'crit':
                return (
                    <>
                        <EffectInput label="Chance (%)" value={(params.chance ?? 0) * 100} onChange={(e) => onEffectChange(tower.id, 'chance', parseFloat(e.target.value) / 100)} step={1} />
                        {type === 'crit' && <EffectInput label="Multiplikator" value={params.potency ?? 0} onChange={(e) => onEffectChange(tower.id, 'potency', parseFloat(e.target.value))} step={0.1}/>}
                        {type === 'stun' && <EffectInput label="Dauer (s)" value={(params.duration ?? 0) / 1000} onChange={(e) => onEffectChange(tower.id, 'duration', parseFloat(e.target.value) * 1000)} step={0.1} />}
                    </>
                );
            case 'burn':
                 return (
                    <>
                        <EffectInput label="Schaden/s" value={params.potency ?? 0} onChange={(e) => onEffectChange(tower.id, 'potency', parseFloat(e.target.value))} step={1} />
                        <EffectInput label="Dauer (s)" value={(params.duration ?? 0) / 1000} onChange={(e) => onEffectChange(tower.id, 'duration', parseFloat(e.target.value) * 1000)} step={0.1} />
                    </>
                 );
            case 'splash':
            case 'persistent_cloud':
                 return (
                    <>
                        <EffectInput label="Radius" value={params.radius ?? 0} onChange={(e) => onEffectChange(tower.id, 'radius', parseFloat(e.target.value))} step={0.1} />
                        <EffectInput label="Stärke (%)" value={(params.potency ?? 0) * 100} onChange={(e) => onEffectChange(tower.id, 'potency', parseFloat(e.target.value) / 100)} step={1} />
                    </>
                 );
            case 'chain':
                return <EffectInput label="Sprünge" value={params.bounces ?? 0} onChange={(e) => onEffectChange(tower.id, 'bounces', parseInt(e.target.value))} type="number" step={1} />;
            case 'multishot':
                return <EffectInput label="Ziele" value={params.targets ?? 0} onChange={(e) => onEffectChange(tower.id, 'targets', parseInt(e.target.value))} type="number" step={1} />;
            case 'armor_shred':
                return (
                     <>
                        <EffectInput label="Reduk. (%)" value={(params.potency ?? 0) * 100} onChange={(e) => onEffectChange(tower.id, 'potency', parseFloat(e.target.value) / 100)} step={1} />
                        <EffectInput label="Dauer (s)" value={(params.duration ?? 0) / 1000} onChange={(e) => onEffectChange(tower.id, 'duration', parseFloat(e.target.value) * 1000)} step={0.1} />
                    </>
                );
            case 'aura':
                 return (
                    <>
                        <EffectInput label="Radius" value={params.radius ?? 0} onChange={(e) => onEffectChange(tower.id, 'radius', parseFloat(e.target.value))} step={0.1} />
                        <EffectInput label="Stärke (%)" value={(params.potency ?? 0) * 100} onChange={(e) => onEffectChange(tower.id, 'potency', parseFloat(e.target.value) / 100)} step={1} />
                    </>
                 );
            default:
                return <div className="text-xs text-muted-foreground">{type}</div>;
        }
    }
    
    return <div className="space-y-2">{renderInputs()}</div>;
};


export default function BalancingPage() {
  const [towers, setTowers] = useState<Tower[]>(() => 
    initialTowers.map(tower => ({...tower}))
  );
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const towerStats = useMemo(() => {
    return towers
      .map(tower => {
        const dps = tower.damage > 0 ? (tower.damage * (1000 / tower.attackSpeed)) : 0;
        const dpsPerCost = dps > 0 && tower.cost > 0 ? dps / tower.cost : 0;
        return {
          ...tower,
          dps,
          dpsPerCost,
        };
      })
      .sort((a, b) => a.tier - b.tier || a.cost - b.cost);
  }, [towers]);

  const { averageDpsPerCost, UPPER_THRESHOLD, LOWER_THRESHOLD } = useMemo(() => {
    const dpsTowers = towerStats.filter(t => t.dpsPerCost > 0);
    if (dpsTowers.length === 0) return { averageDpsPerCost: 0, UPPER_THRESHOLD: 0, LOWER_THRESHOLD: 0 };
    const avg = dpsTowers.reduce((sum, t) => sum + t.dpsPerCost, 0) / dpsTowers.length;
    return {
      averageDpsPerCost: avg,
      UPPER_THRESHOLD: avg * 1.3,
      LOWER_THRESHOLD: avg * 0.7,
    };
  }, [towerStats]);

  const handleTowerChange = (towerId: string, field: keyof Tower, value: string | number) => {
    setTowers(currentTowers =>
      currentTowers.map(tower => {
        if (tower.id === towerId) {
          const numericValue = typeof value === 'string' ? parseFloat(value) : value;
          if (isNaN(numericValue)) return tower;
          
          return { ...tower, [field]: numericValue };
        }
        return tower;
      })
    );
  };
  
  const handleEffectChange = (towerId: string, field: keyof TowerEffect, value: string | number) => {
    setTowers(currentTowers =>
      currentTowers.map(tower => {
        if (tower.id === towerId && tower.effect) {
          const numericValue = typeof value === 'string' ? parseFloat(value) : value;
          if (isNaN(numericValue)) return tower;

          const newEffect = { ...tower.effect, [field]: numericValue };
          return { ...tower, effect: newEffect };
        }
        return tower;
      })
    );
  };
  
  const handleSaveChanges = async () => {
    setIsSaving(true);
    try {
        const result = await saveBalancingData(towers);
        if (result.success) {
            toast({
                title: "Speichern erfolgreich!",
                description: "Die Turm-Daten wurden aktualisiert. Laden Sie die Seite neu, um die Änderungen im Spiel zu sehen.",
            });
        } else {
            throw new Error(result.error);
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

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Interaktives Balancing-Dashboard</h1>
          <p className="text-muted-foreground">Passe Werte live an und beobachte die Auswirkungen auf die Effizienz.</p>
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
          <CardTitle className="flex items-center gap-2">
            <BarChart2 className="text-primary" />
            DPS pro Kostenpunkt (Effizienz)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Dieses Diagramm zeigt die Schadenseffizienz. Rot = potenziell übermächtig, Blau = zu schwach.
          </p>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={towerStats} margin={{ top: 5, right: 20, left: -10, bottom: 90 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis 
                dataKey="name" 
                angle={-45} 
                textAnchor="end" 
                height={1} 
                interval={0} 
                tick={{ fontSize: 10 }}
              />
              <YAxis tickFormatter={(val) => val.toFixed(3)} tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  borderColor: 'hsl(var(--border))',
                  fontSize: '12px'
                }}
                labelStyle={{ fontWeight: 'bold' }}
                formatter={(value: number) => value.toFixed(4)}
              />
              <Bar dataKey="dpsPerCost" name="DPS / Kosten">
                {towerStats.map((entry, index) => {
                  const dpc = entry.dpsPerCost;
                  let color = "hsl(var(--primary))";
                  if (entry.damage > 0) {
                     if (dpc > UPPER_THRESHOLD) color = "hsl(var(--destructive))";
                     else if (dpc < LOWER_THRESHOLD) color = "hsl(217 91% 60%)";
                  } else {
                     color = "hsl(var(--muted-foreground))";
                  }
                  return <Cell key={`cell-${index}`} fill={color} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="text-primary" />
            Vollständige Turm-Statistiken
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">Turm</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead className="w-[120px]">Kosten</TableHead>
                  <TableHead className="w-[120px]">Schaden</TableHead>
                  <TableHead className="w-[120px]">Leben</TableHead>
                  <TableHead className="w-[140px]">Angr./s (ms)</TableHead>
                  <TableHead className="w-[120px]">Reichw.</TableHead>
                  <TableHead className="min-w-[180px]">Effekt-Werte</TableHead>
                  <TableHead className="text-right">DPS</TableHead>
                  <TableHead className="text-right">DPS/Kosten</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {towerStats.map((tower) => {
                  const dpc = tower.dpsPerCost;
                  let dpcColor = "";
                  if (tower.damage > 0) {
                    if (dpc > UPPER_THRESHOLD) dpcColor = "text-red-400";
                    else if (dpc < LOWER_THRESHOLD) dpcColor = "text-blue-400";
                  }

                  return (
                  <TableRow key={tower.id}>
                    <TableCell className="font-medium flex items-center gap-2">
                       <div className="flex gap-1">
                        {tower.elements.map(el => <Badge key={el} variant="outline" className="text-xs">{el}</Badge>)}
                      </div>
                      <span>{tower.name}</span>
                    </TableCell>
                    <TableCell>{tower.tier}</TableCell>
                    <TableCell>
                      <Input 
                          type="number"
                          value={tower.cost}
                          onChange={(e) => handleTowerChange(tower.id, 'cost', e.target.value)}
                          className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                       <Input 
                          type="number"
                          value={tower.damage}
                          onChange={(e) => handleTowerChange(tower.id, 'damage', e.target.value)}
                          className="h-8"
                          disabled={tower.damage === 0 && tower.effect?.type !== 'aura'}
                      />
                    </TableCell>
                    <TableCell>
                       <Input 
                          type="number"
                          value={tower.maxHealth}
                          onChange={(e) => handleTowerChange(tower.id, 'maxHealth', e.target.value)}
                          className="h-8"
                      />
                    </TableCell>
                     <TableCell>
                       <Input 
                          type="number"
                          value={tower.attackSpeed}
                          onChange={(e) => handleTowerChange(tower.id, 'attackSpeed', e.target.value)}
                          className="h-8"
                          disabled={tower.damage === 0 && tower.effect?.type !== 'aura'}
                      />
                    </TableCell>
                    <TableCell>
                       <Input 
                          type="number"
                          value={tower.range}
                          onChange={(e) => handleTowerChange(tower.id, 'range', e.target.value)}
                          className="h-8"
                          step={0.1}
                      />
                    </TableCell>
                    <TableCell>
                        <EffectEditor tower={tower} onEffectChange={handleEffectChange} />
                    </TableCell>
                    <TableCell className="text-right font-semibold">{tower.dps.toFixed(2)}</TableCell>
                    <TableCell className={cn("text-right font-bold", dpcColor)}>{dpc.toFixed(4)}</TableCell>
                  </TableRow>
                )})}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

