
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Telescope, Users, Heart, Coins, Shield, Rabbit, Waves } from "lucide-react";
import type { Wave } from '@/lib/game-data/types';
import { enemyIconPaths } from '@/components/game/icons/enemy-icons';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

type WavePreviewProps = {
  currentWave: number;
  waves: Wave[];
  isCompact?: boolean;
};

const Stat = ({ icon: Icon, value, label, className }: { icon: React.FC<any>, value: string | number, label: string, className?: string }) => (
    <div className={cn("flex items-center justify-between text-xs", className)}>
        <div className="flex items-center gap-1.5 text-muted-foreground">
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
        </div>
        <span className="font-bold">{value}</span>
    </div>
);


const WavePreview = React.memo(function WavePreview({ currentWave, waves, isCompact = false }: WavePreviewProps) {
  const previewWaves = waves.slice(currentWave + 1, currentWave + 4);

  if (previewWaves.length === 0) {
    return null;
  }
  
  const renderWave = (wave: Wave) => {
    const enemyIconPath = enemyIconPaths[wave.enemies.type];
    return (
        <div className="space-y-2">
             <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Waves className="h-4 w-4 text-primary"/>
                    <span className="font-semibold text-sm">Welle {wave.waveNumber}</span>
                </div>
                <div className="flex items-center gap-2 font-medium text-foreground">
                    <span>{wave.enemies.count}x</span>
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="currentColor"
                      stroke="black"
                      strokeWidth="0.5"
                    >
                      <path d={enemyIconPath} />
                    </svg>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 pl-1">
                <Stat icon={Heart} value={wave.enemies.health} label="HP" className="text-red-400" />
                <Stat icon={Shield} value={wave.enemies.armor} label="Rüstung" className="text-slate-400" />
                <Stat icon={Rabbit} value={wave.enemies.speed} label="Tempo" className="text-sky-400" />
                <Stat icon={Coins} value={wave.enemies.bounty} label="Belohnung" className="text-yellow-400" />
            </div>
        </div>
    )
  }

  if (isCompact) {
    return (
      <div className="flex flex-col gap-4 text-sm">
        {previewWaves.map((wave, index) => {
           if (!wave) return null;
           return <div key={wave.waveNumber}>{renderWave(wave)}</div>
        })}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Telescope className="h-5 w-5 text-primary" />
          <span>Nächste Wellen</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {previewWaves.map((wave, index) => {
          if (!wave) return null;
          return (
            <React.Fragment key={wave.waveNumber}>
              {renderWave(wave)}
              {index < previewWaves.length - 1 && <Separator className="my-3" />}
            </React.Fragment>
          );
        })}
      </CardContent>
    </Card>
  );
});

export default WavePreview;
