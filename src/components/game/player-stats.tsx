
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Coins, Heart, User, RadioTower, Eye } from "lucide-react";
import { cn } from '@/lib/utils';
import type { Player } from '@/lib/game-data';
import { Progress } from '../ui/progress';

type PlayerStatsProps = {
  player: Player;
  lives: number;
  maxLives: number;
  isCompact?: boolean;
  isLocalPlayer?: boolean;
  isCoop?: boolean;
};

const PlayerStats = React.memo(function PlayerStats({ player, lives, maxLives, isCompact = false, isLocalPlayer = false, isCoop = false }: PlayerStatsProps) {
  const playerName = player.name || `Spieler ${player.id.includes('1') ? 1 : 2}...`;
  const playerColor = player.id === 'player1' ? 'text-blue-400' : 'text-red-400';
  const playerBorder = player.id === 'player1' ? 'border-blue-500/50' : 'border-red-500/50';
  const isSpectator = player.id === 'spectator';

  if (isCompact) {
    return (
      <div 
        className={cn(
          "flex flex-col gap-1 text-sm p-2 rounded-lg border-2",
          isLocalPlayer && !isSpectator ? "border-primary bg-primary/10" : "border-transparent",
          isCoop && !isLocalPlayer && !isSpectator && playerBorder
        )}
      >
        <div className="flex items-center gap-2">
          {isSpectator ? <Eye className="h-4 w-4 text-muted-foreground" /> : (player.avatarUrl && <img src={player.avatarUrl} alt={player.name} className="h-5 w-5 rounded-full" />)}
          <span className="font-semibold truncate">{playerName}</span>
        </div>
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-yellow-400">
                <Coins className="h-4 w-4" />
                <span className="font-medium">Ress.</span>
            </div>
            <span className="font-bold">{isSpectator ? '---' : player.resources}</span>
        </div>
         <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-red-500">
                <Heart className="h-4 w-4" />
                <span className="font-medium">Leben</span>
            </div>
            <span className="font-bold">{lives}</span>
        </div>
      </div>
    )
  }
  
  return (
    <Card 
      className={cn(
        "transition-all", 
        isLocalPlayer && !isSpectator ? "border-accent shadow-lg" : "hover:bg-muted/50",
        isCoop && !isSpectator && playerBorder
      )}
    >
      <CardHeader className="p-4">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            {isSpectator ? <Eye className="h-5 w-5 text-muted-foreground" /> : (player.avatarUrl && <img src={player.avatarUrl} alt={player.name} className="h-6 w-6 rounded-full" />)}
            <span className="truncate">{playerName}</span>
          </div>
          {isLocalPlayer && !isSpectator && <RadioTower className="h-5 w-5 text-accent animate-pulse" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        <div className="flex items-center justify-between text-base">
          <div className="flex items-center gap-1.5 text-yellow-400">
            <Coins className="h-4 w-4" />
            <span className="font-medium">Ressourcen</span>
          </div>
          <span className="font-bold">{isSpectator ? '---' : player.resources}</span>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-base">
            <div className="flex items-center gap-1.5 text-red-500">
                <Heart className="h-4 w-4" />
                <span className="font-medium">Leben</span>
            </div>
            <span className="font-bold">{lives} / {maxLives}</span>
          </div>
          <Progress value={(lives / maxLives) * 100} className="h-2" />
        </div>
      </CardContent>
    </Card>
  );
});

export default PlayerStats;
