import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Swords } from "lucide-react";

type WaveTrackerProps = {
  currentWave: number;
  totalWaves: number;
  isCompact?: boolean;
};

const WaveTracker = React.memo(function WaveTracker({ currentWave, totalWaves, isCompact = false }: WaveTrackerProps) {
  const waveNumber = currentWave + 1;
  const progress = (waveNumber / totalWaves) * 100;
  const displayWaveNumber = Math.min(waveNumber, totalWaves);

  if (isCompact) {
    return (
       <div className="flex flex-col gap-1 text-sm">
         <div className="flex items-center gap-2">
            <Swords className="h-4 w-4 text-primary" />
            <span className="font-semibold">Wellenfortschritt</span>
        </div>
        <div className="flex items-center justify-between">
            <span className="font-medium">Welle {displayWaveNumber} / {totalWaves}</span>
        </div>
       </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Swords className="h-5 w-5 text-primary" />
          <span>Wellenfortschritt</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex justify-between items-baseline mb-1">
            <span className="text-lg font-bold">Welle {displayWaveNumber} <span className="text-sm font-normal text-muted-foreground">/ {totalWaves}</span></span>
          </div>
          <Progress value={progress} className="h-3" />
        </div>
      </CardContent>
    </Card>
  );
});

export default WaveTracker;
