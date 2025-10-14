

import React from 'react';
import type { Tower } from '@/lib/game-data/types';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Bug, Sparkles, TestTube2, ChevronsRight, Heart, Coins, Microscope, Wifi, WifiOff, FileJson, ArrowDownUp, ArrowUp, ArrowDown, Bot } from 'lucide-react';
import { Button } from '../ui/button';
import { formatBytes } from '@/lib/utils';
import type { Player } from './game-session';

type DebugMenuProps = {
  towers: Tower[];
  setTowers: React.Dispatch<React.SetStateAction<Tower[]>>;
  cheat_unlockAll: () => void;
  setPlayers: React.Dispatch<React.SetStateAction<Player[]>>;
  onLoadTestLayout: () => void;
  onLoadAllTowersLayout: () => void;
  isCheating?: boolean;
  cheat_addResources?: () => void;
  cheat_skipWaves?: () => void;
  cheat_heal?: () => void;
  cheat_nudgeEnemy: () => void;
  isCoop?: boolean;
  isWsConnected?: boolean;
  hostPacketsPerSecond?: number;
  hostBytesSentPerSecond?: number;
  clientPacketsPerSecond?: number;
  clientBytesReceivedPerSecond?: number;
  averagePacketSize?: number;
};

const DebugMenu = React.memo(function DebugMenu({
  towers,
  setTowers,
  cheat_unlockAll,
  setPlayers,
  onLoadTestLayout,
  onLoadAllTowersLayout,
  isCheating = false,
  cheat_addResources,
  cheat_skipWaves,
  cheat_heal,
  cheat_nudgeEnemy,
  isCoop = false,
  isWsConnected,
  hostPacketsPerSecond,
  hostBytesSentPerSecond,
  clientPacketsPerSecond,
  clientBytesReceivedPerSecond,
  averagePacketSize,
}: DebugMenuProps) {

  const handleTowerChange = (
    towerId: string,
    field: keyof Tower,
    value: string | number
  ) => {
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

  const title = isCoop ? "Netzwerk-Diagnose & Debug" : isCheating ? 'Chaos-Kontrolle' : 'Debug-Menü';
  const Icon = isCoop ? Bug : Sparkles;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          <span>{title}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        
        {(isCheating || !isCoop) && (
          <>
            <div className="grid grid-cols-1 gap-2 mb-4">
              <Button onClick={cheat_addResources} variant="outline" disabled={!isCheating}>
                <Coins className="mr-2 h-4 w-4 text-yellow-400" />
                +10,000 Ressourcen
              </Button>
              <Button onClick={cheat_skipWaves} variant="outline" disabled={!isCheating}>
                <ChevronsRight className="mr-2 h-4 w-4 text-blue-400" />
                +5 Wellen überspringen
              </Button>
              <Button onClick={cheat_heal} variant="outline" disabled={!isCheating}>
                <Heart className="mr-2 h-4 w-4 text-red-400" />
                Leben wiederherstellen
              </Button>
              <Button onClick={cheat_unlockAll} variant="outline">
                  <Sparkles className="mr-2 h-4 w-4" />
                  Alles Freischalten
              </Button>
              <Button onClick={cheat_nudgeEnemy} variant="outline">
                <Bot className="mr-2 h-4 w-4" />
                Gegner anstupsen
              </Button>
              <Button onClick={onLoadTestLayout} variant="outline">
                  <TestTube2 className="mr-2 h-4 w-4" />
                  Test-Layout laden
              </Button>
              <Button onClick={onLoadAllTowersLayout} variant="outline">
                  <Microscope className="mr-2 h-4 w-4" />
                  Alle Türme Layout
              </Button>
            </div>
            <Separator className='mb-4' />
          </>
        )}
        
        {isCoop && (
          <>
            <p className="text-sm text-muted-foreground mb-2">Netzwerk-Diagnose:</p>
            <div className="p-3 rounded-lg bg-muted/30 space-y-2 text-xs mb-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-medium">
                        {isWsConnected ? <Wifi className="h-4 w-4 text-green-500"/> : <WifiOff className="h-4 w-4 text-red-500"/>}
                        <span>Datenkanal (WebRTC)</span>
                    </div>
                    <span className={isWsConnected ? "text-green-500 font-bold" : "text-red-500 font-bold"}>
                        {isWsConnected ? "Verbunden" : "Getrennt"}
                    </span>
                </div>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <ArrowUp className="h-4 w-4"/>
                        <span>Host Rate (tx)</span>
                    </div>
                    <span>{hostPacketsPerSecond ?? 'N/A'} Pakete/s</span>
                </div>
                 <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <ArrowDown className="h-4 w-4"/>
                        <span>Client Rate (rx)</span>
                    </div>
                    <span>{clientPacketsPerSecond ?? 'N/A'} Pakete/s</span>
                </div>
                 <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <ArrowUp className="h-4 w-4"/>
                        <span>Host Daten (tx)</span>
                    </div>
                    <span>{formatBytes(hostBytesSentPerSecond ?? 0)}/s</span>
                </div>
                 <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <ArrowDown className="h-4 w-4"/>
                        <span>Client Daten (rx)</span>
                    </div>
                    <span>{formatBytes(clientBytesReceivedPerSecond ?? 0)}/s</span>
                </div>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <FileJson className="h-4 w-4"/>
                        <span>Ø Paketgröße</span>
                    </div>
                    <span>{formatBytes(averagePacketSize ?? 0)}</span>
                </div>
            </div>
            <Separator className='mb-4' />
          </>
        )}

        <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="tower-params">
                <AccordionTrigger>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Microscope className="h-4 w-4"/>
                        <span>Turm-Parameter anpassen</span>
                    </div>
                </AccordionTrigger>
                <AccordionContent>
                    <Accordion type="single" collapsible className="w-full mt-2">
                        {towers.map(tower => (
                            <AccordionItem value={tower.id} key={tower.id}>
                            <AccordionTrigger>{tower.name}</AccordionTrigger>
                            <AccordionContent className="space-y-4">
                                <div className="space-y-2">
                                <div className="flex justify-between">
                                    <Label htmlFor={`cost-${tower.id}`}>Kosten</Label>
                                    <span className="text-sm font-medium">{tower.cost}</span>
                                </div>
                                <Input
                                    id={`cost-${tower.id}`}
                                    type="number"
                                    value={tower.cost}
                                    onChange={e => handleTowerChange(tower.id, 'cost', e.target.value)}
                                    className="h-8"
                                />
                                </div>
                                
                                {tower.damage > 0 && (
                                <>
                                    <Separator />
                                    <div className="space-y-2">
                                    <div className="flex justify-between">
                                        <Label htmlFor={`damage-${tower.id}`}>Schaden</Label>
                                        <span className="text-sm font-medium">{tower.damage}</span>
                                    </div>
                                    <Slider
                                        id={`damage-${tower.id}`}
                                        min={0}
                                        max={200}
                                        step={1}
                                        value={[tower.damage]}
                                        onValueChange={([val]) => handleTowerChange(tower.id, 'damage', val)}
                                    />
                                    </div>

                                    <div className="space-y-2">
                                    <div className="flex justify-between">
                                        <Label htmlFor={`range-${tower.id}`}>Reichweite</Label>
                                        <span className="text-sm font-medium">{tower.range}</span>
                                    </div>
                                    <Slider
                                        id={`range-${tower.id}`}
                                        min={1}
                                        max={10}
                                        step={0.5}
                                        value={[tower.range]}
                                        onValueChange={([val]) => handleTowerChange(tower.id, 'range', val)}
                                    />
                                    </div>
                                    
                                    <div className="space-y-2">
                                    <div className="flex justify-between">
                                        <Label htmlFor={`attackSpeed-${tower.id}`}>Angriffsgeschw. (ms)</Label>
                                        <span className="text-sm font-medium">{tower.attackSpeed}</span>
                                    </div>
                                    <Slider
                                        id={`attackSpeed-${tower.id}`}
                                        min={100}
                                        max={3000}
                                        step={50}
                                        value={[tower.attackSpeed]}
                                        onValueChange={([val]) => handleTowerChange(tower.id, 'attackSpeed', val)}
                                    />
                                    </div>
                                </>
                                )}
                            </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
});

export default DebugMenu;
