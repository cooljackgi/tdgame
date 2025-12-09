
'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Coins, Heart, Rabbit, Send, Shield, Skull } from "lucide-react";
import type { Player, EnemyType } from "@/lib/game-data/types";
import { ScrollArea } from '../ui/scroll-area';

type VersusEnemyToSend = {
  type: EnemyType;
  cost: number;
  incomeBonus: number;
  health: number; // Base health for display
  icon: React.FC<any>;
};

const enemiesToSend: VersusEnemyToSend[] = [
  { type: 'standard', cost: 50, incomeBonus: 1, health: 120, icon: Heart },
  { type: 'schnell', cost: 75, incomeBonus: 2, health: 90, icon: Rabbit },
  { type: 'gepanzert', cost: 125, incomeBonus: 3, health: 250, icon: Shield },
  { type: 'boss', cost: 500, incomeBonus: 10, health: 1500, icon: Skull },
];

const PlayerVersusControls = ({
  localPlayer,
  onSendEnemy,
  isMobile = false,
}: {
  localPlayer: Player;
  onSendEnemy: (payload: { type: EnemyType; cost: number; incomeBonus: number }) => void;
  isMobile?: boolean;
}) => {
  const content = (
    <div className="space-y-3">
      {enemiesToSend.map((enemy) => {
        const canAfford = localPlayer.resources >= enemy.cost;
        return (
          <div key={enemy.type} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
            <div className="flex items-center gap-3">
              <enemy.icon className="h-6 w-6" />
              <div>
                <p className="font-semibold capitalize">{enemy.type}</p>
                <p className="text-xs text-muted-foreground">
                  +{enemy.incomeBonus} Eink.
                </p>
              </div>
            </div>
            <Button onClick={() => onSendEnemy(enemy)} disabled={!canAfford} size="sm">
              <div className="flex items-center gap-2">
                <Send className="h-4 w-4" />
                <div className="flex items-center gap-1">
                  <span>{enemy.cost}</span>
                  <Coins className="h-3 w-3 text-yellow-300" />
                </div>
              </div>
            </Button>
          </div>
        );
      })}
    </div>
  );

  if (isMobile) {
    return (
        <ScrollArea className="h-full">
           {content}
        </ScrollArea>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gegner senden</CardTitle>
        <CardDescription>
          Erhöhe dein Einkommen, indem du deinem Gegner Einheiten schickst.
        </CardDescription>
      </CardHeader>
      <CardContent>
         <ScrollArea className="h-[calc(100vh-320px)] pr-2">
            {content}
         </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default PlayerVersusControls;
