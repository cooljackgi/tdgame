// src/app/balancing/page.tsx
'use client';

import { useMemo, useState, ChangeEvent, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { Home, BarChart2, Zap, Save, Loader2, Heart, PlusCircle, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { towers as initialTowers } from '@/lib/game-data/towers';
import type { Tower, TowerEffect, PersistentCloudEffect } from '@/lib/game-data/types';
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
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { loadGameConfig } from '@/lib/game-config-loader';

const ALL_EFFECT_TYPES: TowerEffect['type'][] = [
    'slow', 'stun', 'burn', 'pushback', 'splash', 'multishot', 'chain', 
    'pull', 'vulnerability', 'aura', 'armor_shred', 'lifesteal', 'crit', 
    'persistent_cloud', 'poison'
];

const ALL_CLOUD_EFFECTS: PersistentCloudEffect[] = ['poison', 'slow', 'burn'];

const defaultEffectValues: Record<TowerEffect['type'], Omit<TowerEffect, 'type'>> = {
    slow: { potency: 0.3, duration: 2000, chance: 1 },
    stun: { potency: 1, duration: 500, chance: 0.15 },
    burn: { potency: 20, duration: 3000 },
    pushback: { distance: 0.5, chance: 1 },
    splash: { radius: 1.2, potency: 0.5 },
    multishot: { targets: 3 },
    chain: { bounces: 3, potency: 0.6 },
    pull: { radius: 1.5, potency: 0.1, duration: 1000 },
    vulnerability: { potency: 0.15, duration: 5000 },
    aura: { radius: 4, potency: 0.1 },
    armor_shred: { potency: 0.25, duration: 4000, chance: 1 },
    lifesteal: { potency: 0.1, chance: 0.2 },
    crit: { potency: 2, chance: 0.15 },
    persistent_cloud: { radius: 1.5, potency: 50, duration: 5000, cloudEffect: 'poison' },
    poison: { potency: 25, duration: 5000 },
};


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

const EffectEditor = ({ effect, towerId, effectIndex, onEffectChange, onEffectTypeChange, onRemoveEffect }: { effect: TowerEffect, towerId: string, effectIndex: number, onEffectChange: (towerId: string, effectIndex: number, field: keyof TowerEffect, value: any) => void, onEffectTypeChange: (towerId: string, effectIndex: number, newType: TowerEffect['type']) => void, onRemoveEffect: (towerId: string, effectIndex: number) => void }) => {
    
    const { type, ...params } = effect;

    const renderInputs = () => {
        switch (type) {
            case 'slow':
            case 'vulnerability':
                return (
                    <>
                        <EffectInput label="Stärke (%)" value={(params.potency ?? 0) * 100} onChange={(e) => onEffectChange(towerId, effectIndex, 'potency', parseFloat(e.target.value) / 100)} step={1} />
                        <EffectInput label="Dauer (s)" value={(params.duration ?? 0) / 1000} onChange={(e) => onEffectChange(towerId, effectIndex, 'duration', parseFloat(e.target.value) * 1000)} step={0.1} />
                    </>
                );
            case 'stun':
            case 'crit':
                return (
                    <>
                        <EffectInput label="Chance (%)" value={(params.chance ?? 0) * 100} onChange={(e) => onEffectChange(towerId, effectIndex, 'chance', parseFloat(e.target.value) / 100)} step={1} />
                        {type === 'crit' && <EffectInput label="Multiplikator" value={params.potency ?? 0} onChange={(e) => onEffectChange(towerId, effectIndex, 'potency', parseFloat(e.target.value))} step={0.1}/>}
                        {type === 'stun' && <EffectInput label="Dauer (s)" value={(params.duration ?? 0) / 1000} onChange={(e) => onEffectChange(towerId, effectIndex, 'duration', parseFloat(e.target.value) * 1000)} step={0.1} />}
                    </>
                );
            case 'burn':
                 return (
                    <>
                        <EffectInput label="Schaden/s" value={params.potency ?? 0} onChange={(e) => onEffectChange(towerId, effectIndex, 'potency', parseFloat(e.target.value))} step={1} />
                        <EffectInput label="Dauer (s)" value={(params.duration ?? 0) / 1000} onChange={(e) => onEffectChange(towerId, effectIndex, 'duration', parseFloat(e.target.value) * 1000)} step={0.1} />
                    </>
                 );
            case 'splash':
                 return (
                    <>
                        <EffectInput label="Radius" value={params.radius ?? 0} onChange={(e) => onEffectChange(towerId, effectIndex, 'radius', parseFloat(e.target.value))} step={0.1} />
                        <EffectInput label="Stärke (%)" value={(params.potency ?? 0) * 100} onChange={(e) => onEffectChange(towerId, effectIndex, 'potency', parseFloat(e.target.value) / 100)} step={1} />
                    </>
                 );
            case 'persistent_cloud':
                return (
                    <>
                        <div className="grid grid-cols-2 items-center gap-2">
                             <Label className="text-xs text-muted-foreground">Wolken-Effekt</Label>
                             <Select value={params.cloudEffect} onValueChange={(newEffect: PersistentCloudEffect) => onEffectChange(towerId, effectIndex, 'cloudEffect', newEffect)}>
                                <SelectTrigger className="h-7 text-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {ALL_CLOUD_EFFECTS.map(t => (
                                        <SelectItem key={t} value={t} className="text-xs capitalize">{t}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <EffectInput label="Wolken-Radius" value={params.radius ?? 0} onChange={(e) => onEffectChange(towerId, effectIndex, 'radius', parseFloat(e.target.value))} step={0.1} />
                        <EffectInput label="Wolken-Dauer (s)" value={(params.duration ?? 0) / 1000} onChange={(e) => onEffectChange(towerId, effectIndex, 'duration', parseFloat(e.target.value) * 1000)} step={0.1} />
                        <EffectInput label="Wolken-Stärke" value={params.potency ?? 0} onChange={(e) => onEffectChange(towerId, effectIndex, 'potency', parseFloat(e.target.value))} step={1} />
                    </>
                );
            case 'chain':
                return <EffectInput label="Sprünge" value={params.bounces ?? 0} onChange={(e) => onEffectChange(towerId, effectIndex, 'bounces', parseInt(e.target.value))} type="number" step={1} />;
            case 'multishot':
                return <EffectInput label="Ziele" value={params.targets ?? 0} onChange={(e) => onEffectChange(towerId, effectIndex, 'targets', parseInt(e.target.value))} type="number" step={1} />;
            case 'armor_shred':
                return (
                     <>
                        <EffectInput label="Reduk. (%)" value={(params.potency ?? 0) * 100} onChange={(e) => onEffectChange(towerId, effectIndex, 'potency', parseFloat(e.target.value) / 100)} step={1} />
                        <EffectInput label="Dauer (s)" value={(params.duration ?? 0) / 1000} onChange={(e) => onEffectChange(towerId, effectIndex, 'duration', parseFloat(e.target.value) * 1000)} step={0.1} />
                    </>
                );
            case 'aura':
                 return (
                    <>
                        <EffectInput label="Radius" value={params.radius ?? 0} onChange={(e) => onEffectChange(towerId, effectIndex, 'radius', parseFloat(e.target.value))} step={0.1} />
                        <EffectInput label="Stärke (%)" value={(params.potency ?? 0) * 100} onChange={(e) => onEffectChange(towerId, effectIndex, 'potency', parseFloat(e.target.value) / 100)} step={1} />
                    </>
                 );
            default:
                return <div className="text-xs text-muted-foreground">{type}</div>;
        }
    }
    
    return (
      <div className="space-y-2 p-2 border rounded-md bg-muted/20">
        <div className="flex items-center gap-2">
            <Select value={type} onValueChange={(newType: TowerEffect['type']) => onEffectTypeChange(towerId, effectIndex, newType)}>
                <SelectTrigger className="h-7 text-xs flex-grow">
                    <SelectValue placeholder="Effekt-Typ wählen" />
                </SelectTrigger>
                <SelectContent>
                    {ALL_EFFECT_TYPES.map(t => (
                        <SelectItem key={t} value={t} className="text-xs capitalize">{t.replace('_', ' ')}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onRemoveEffect(towerId, effectIndex)}>
              <XCircle className="h-4 w-4 text-destructive" />
            </Button>
        </div>
        <div className="pl-1 border-l-2 border-muted/50 ml-2 mt-2 space-y-2">
            {renderInputs()}
        </div>
    </div>
    );
};


export default function BalancingPage() {
  const [towers, setTowers] = useState<Tower[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    async function fetchTowers() {
      setIsLoading(true);
      try {
        const config = await loadGameConfig();
        setTowers(config.towers);
      } catch (e) {
        console.error("Failed to load tower data:", e);
        toast({
          title: "Fehler beim Laden",
          description: "Die Turm-Daten konnten nicht geladen werden. Lokale Standardwerte werden verwendet.",
          variant: "destructive",
        });
        setTowers(initialTowers); // Fallback to local data
      } finally {
        setIsLoading(false);
      }
    }
    fetchTowers();
  }, [toast]);

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
  
  const handleEffectChange = useCallback((towerId: string, effectIndex: number, field: keyof TowerEffect, value: any) => {
    setTowers(currentTowers =>
      currentTowers.map(tower => {
        if (tower.id === towerId && tower.effects && tower.effects[effectIndex]) {
          const newEffects = [...tower.effects];
          const newEffect = { ...newEffects[effectIndex] };
          
          let finalValue = value;
          if (typeof value === 'string' && field !== 'cloudEffect') {
             const numericValue = parseFloat(value);
             if (isNaN(numericValue)) return tower;
             finalValue = numericValue;
          }
          (newEffect as any)[field] = finalValue;
          newEffects[effectIndex] = newEffect;
          
          return { ...tower, effects: newEffects };
        }
        return tower;
      })
    );
  }, []);

  const handleEffectTypeChange = useCallback((towerId: string, effectIndex: number, newType: TowerEffect['type']) => {
    setTowers(currentTowers =>
        currentTowers.map(tower => {
            if (tower.id === towerId && tower.effects && tower.effects[effectIndex]) {
                const newEffects = [...tower.effects];
                newEffects[effectIndex] = {
                    type: newType,
                    ...defaultEffectValues[newType],
                };
                return { ...tower, effects: newEffects };
            }
            return tower;
        })
    );
  }, []);

  const handleAddEffect = useCallback((towerId: string) => {
    setTowers(currentTowers => currentTowers.map(tower => {
        if (tower.id === towerId) {
            const newEffects = [...(tower.effects || [])];
            newEffects.push({ type: 'slow', ...defaultEffectValues['slow'] });
            return { ...tower, effects: newEffects };
        }
        return tower;
    }));
  }, []);

  const handleRemoveEffect = useCallback((towerId: string, effectIndex: number) => {
      setTowers(currentTowers => currentTowers.map(tower => {
          if (tower.id === towerId && tower.effects) {
              const newEffects = tower.effects.filter((_, idx) => idx !== effectIndex);
              return { ...tower, effects: newEffects };
          }
          return tower;
      }));
  }, []);
  
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
  
  if (isLoading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-4">
        <Loader2 className="mr-2 h-8 w-8 animate-spin" />
        <p>Lade Turm-Daten aus Firestore...</p>
      </main>
    );
  }

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
                  <TableHead className="min-w-[250px]">Effekt-Werte</TableHead>
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
                          disabled={tower.damage === 0 && !tower.effects?.some(e => e.type === 'aura')}
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
                           disabled={tower.damage === 0 && !tower.effects?.some(e => e.type === 'aura')}
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
                      <div className="space-y-2">
                        {tower.effects?.map((effect, index) => (
                           <EffectEditor 
                              key={index}
                              towerId={tower.id}
                              effectIndex={index}
                              effect={effect}
                              onEffectChange={handleEffectChange} 
                              onEffectTypeChange={handleEffectTypeChange} 
                              onRemoveEffect={handleRemoveEffect}
                           />
                        ))}
                        <Button variant="outline" size="sm" className="w-full h-8" onClick={() => handleAddEffect(tower.id)}>
                           <PlusCircle className="h-4 w-4 mr-2"/> Effekt hinzufügen
                        </Button>
                      </div>
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
