// src/app/explainer/enemies/page.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import EnemyComponent from '@/components/game/Enemy';
import type { EnemyType } from '@/lib/game-data/types';
import { Rabbit, Shield, Heart, HeartPulse, Crown } from 'lucide-react';

const enemyData: { type: EnemyType, title: string, description: string, icon: React.FC<any> }[] = [
    {
        type: 'standard',
        title: 'Standard-Gegner',
        description: 'Das Rückgrat der feindlichen Armee. Keine besonderen Stärken oder Schwächen. Eine Bedrohung nur in großer Zahl.',
        icon: Heart,
    },
    {
        type: 'schnell',
        title: 'Schneller Gegner',
        description: 'Bewegt sich deutlich schneller als andere Einheiten, hat dafür aber weniger Lebenspunkte. Schwer zu treffen ohne Verlangsamung.',
        icon: Rabbit,
    },
    {
        type: 'gepanzert',
        title: 'Gepanzerter Gegner',
        description: 'Besitzt hohe Rüstung und viele Lebenspunkte, bewegt sich aber langsam. Erfordert Türme mit hohem Schaden oder Rüstungsreduktion.',
        icon: Shield,
    },
    {
        type: 'heilend',
        title: 'Heilender Gegner',
        description: 'Eine unterstützende Einheit, die nahe Gegner langsam heilt. Sollte immer ein primäres Ziel sein, um Wellen nicht unnötig schwer zu machen.',
        icon: HeartPulse,
    },
    {
        type: 'boss',
        title: 'Boss-Gegner',
        description: 'Extrem widerstandsfähig und stark. Ein wahrer Test für deine Verteidigung. Taucht alle 10 Wellen auf und erfordert fokussiertes Feuer.',
        icon: Crown,
    }
];


export default function EnemiesPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold tracking-tighter mb-2">Gegner-Bestiarium</h1>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Kenne deinen Feind. Hier findest du eine Übersicht aller Gegnertypen und ihrer Eigenschaften.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {enemyData.map((enemy) => (
          <Card key={enemy.type} className="flex flex-col">
            <CardHeader>
                <div className="flex items-center gap-4">
                    <div className="w-16 h-16 flex-shrink-0">
                        <EnemyComponent
                            type={enemy.type}
                            health={100}
                            maxHealth={100}
                            effects={[]}
                        />
                    </div>
                    <div>
                        <CardTitle className="flex items-center gap-2">
                          <enemy.icon className="h-5 w-5 text-primary" />
                          {enemy.title}
                        </CardTitle>
                        <CardDescription className="mt-1">{enemy.type}</CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="flex-grow">
              <p className="text-sm text-muted-foreground">{enemy.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
