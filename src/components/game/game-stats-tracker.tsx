
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Send, Skull, ShieldOff, Swords } from "lucide-react";

type GameStatsTrackerProps = {
  spawnedThisWave: number;
  totalEnemiesInWave: number;
  totalKilled: number;
  totalLeaked: number;
  isCompact?: boolean;
};

const GameStatsTracker = React.memo(function GameStatsTracker({ 
  spawnedThisWave, 
  totalEnemiesInWave,
  totalKilled, 
  totalLeaked, 
  isCompact = false 
}: GameStatsTrackerProps) {
  
  if (isCompact) {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" />
          <span className="font-semibold">Gesendet: {spawnedThisWave} / {totalEnemiesInWave}</span>
        </div>
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-green-500">
                <Skull className="h-4 w-4" />
                <span className="font-medium">Getötet</span>
            </div>
            <span className="font-bold">{totalKilled}</span>
        </div>
         <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-red-500">
                <ShieldOff className="h-4 w-4" />
                <span className="font-medium">Durch</span>
            </div>
            <span className="font-bold">{totalLeaked}</span>
        </div>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Swords className="h-5 w-5 text-primary" />
          <span>Statistiken</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Send className="h-4 w-4" />
            <span className="font-semibold">Gesendet (Welle)</span>
          </div>
          <span className="font-bold">{spawnedThisWave} / {totalEnemiesInWave}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-green-500">
            <Skull className="h-4 w-4" />
            <span className="font-semibold">Getötet (Gesamt)</span>
          </div>
          <span className="font-bold">{totalKilled}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-500">
            <ShieldOff className="h-4 w-4" />
            <span className="font-semibold">Durchgekommen (Gesamt)</span>
          </div>
          <span className="font-bold">{totalLeaked}</span>
        </div>
      </CardContent>
    </Card>
  );
});

export default GameStatsTracker;
