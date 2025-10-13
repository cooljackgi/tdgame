
import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { FastForward, Hourglass } from "lucide-react";
import { cn } from '@/lib/utils';

type WaveStartTimerProps = {
  countdown: number;
  totalTime: number;
  onStartWave: () => void;
  canStartWave: boolean; // Neu: Um zu steuern, wer den Button drücken kann
};

const WaveStartTimer = React.memo(function WaveStartTimer({ countdown, totalTime, onStartWave, canStartWave }: WaveStartTimerProps) {
  const progressPercentage = (countdown / totalTime) * 100;

  return (
    <Card className="bg-transparent border-primary/50">
      <CardContent className="p-0">
        <Button 
            onClick={onStartWave} 
            variant="secondary" 
            className="w-full h-auto py-2 relative overflow-hidden group disabled:opacity-80"
            disabled={!canStartWave}
        >
            {/* Background fill that depletes */}
            <div 
                className="absolute top-0 left-0 bottom-0 bg-primary/80 transition-all duration-1000 linear"
                style={{ width: `${progressPercentage}%` }}
            />
            {/* Static background to ensure contrast */}
            <div className="absolute inset-0 bg-secondary/80 mix-blend-lighten opacity-30" />

            {/* Content */}
           <div className="relative flex items-center justify-center gap-3">
              {canStartWave ? (
                <FastForward className="h-6 w-6 text-primary-foreground transition-transform group-hover:scale-110" />
              ) : (
                <Hourglass className="h-5 w-5 text-primary-foreground/70" />
              )}
              <div>
                <p className={cn("text-lg font-bold text-primary-foreground", !canStartWave && "text-primary-foreground/70")}>
                    {canStartWave ? "Nächste Welle" : "Warte auf Host"}
                </p>
                <p className="text-xs font-medium text-primary-foreground/80">Startet in {countdown}s</p>
              </div>
            </div>
        </Button>
      </CardContent>
    </Card>
  );
});

export default WaveStartTimer;
