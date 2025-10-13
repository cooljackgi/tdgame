
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Element, Wave } from "@/lib/game-data/types";
import { waves } from "@/lib/game-data/enemies";
import { elementIcons, elementColors, elementBackgroundColors, ALL_PICKABLE_ELEMENTS } from "@/lib/game-data/constants";
import { cn } from "@/lib/utils";
import React, { useMemo } from "react";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

type ElementPickDialogProps = {
  isOpen: boolean;
  unlockedElements: Set<Element>;
  onElementPick: (element: Element) => void;
  playerName: string;
  currentWave: number;
};

const elementStrengths: Record<Element, string> = {
    fire: "Gut gegen viele schwache Gegner (Flächenschaden/Brand).",
    water: "Sehr effektiv gegen schnelle Gegner (Verlangsamung).",
    earth: "Stark gegen gepanzerte Gegner und Bosse (Betäubung).",
    air: "Gut für Massenkontrolle (Zurückstoßen).",
    light: "Exzellent gegen gepanzerte Gegner (ignoriert Rüstung).",
    dark: "Sehr stark gegen Ziele mit viel Leben (prozentualer Schaden).",
    nature: "Effektiv gegen Horden von Gegnern (Mehrfachschuss).",
    neutral: "Allrounder ohne Spezialisierung."
};

const getRecommendation = (nextWaves: Wave[]): Element | null => {
    if (nextWaves.length === 0) return null;

    const counters = {
        schnell: 0,
        gepanzert: 0,
        boss: 0,
        heilend: 0,
        standard: 0
    };

    for (const wave of nextWaves) {
        counters[wave.enemies.type] = (counters[wave.enemies.type] || 0) + wave.enemies.count;
    }

    if (counters.gepanzert > 10 || counters.boss > 0) return 'earth';
    if (counters.schnell > 15) return 'water';
    if (counters.standard > 20 || counters.heilend > 5) return 'fire';
    
    return 'water'; // Default good choice
}


export function ElementPickDialog({ isOpen, unlockedElements, onElementPick, playerName, currentWave }: ElementPickDialogProps) {
  const choices = ALL_PICKABLE_ELEMENTS.filter(e => !unlockedElements.has(e));
  
  const recommendedElement = useMemo(() => {
    const nextFiveWaves = waves.slice(currentWave, currentWave + 5);
    return getRecommendation(nextFiveWaves);
  }, [currentWave]);


  if (choices.length === 0) {
    return null;
  }

  return (
    <Dialog open={isOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{playerName}, wähle dein nächstes Element</DialogTitle>
          <DialogDescription>
            Deine Wahl schaltet neue Türme und Upgrade-Pfade frei. Wähle weise!
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-center items-center flex-wrap gap-4 py-4">
          {choices.map(element => {
            const Icon = elementIcons[element];
            const isRecommended = element === recommendedElement;

            return (
              <Tooltip key={element}>
                  <TooltipTrigger asChild>
                    <div className="relative">
                        <Button
                            onClick={() => onElementPick(element)}
                            variant="outline"
                            className={cn(
                                "flex flex-col items-center justify-center h-24 w-24 rounded-lg border-2 transition-all hover:border-primary",
                                elementBackgroundColors[element],
                                isRecommended && "border-primary shadow-lg shadow-primary/30 animate-glow-pulse"
                            )}
                        >
                            <Icon className={cn("h-8 w-8 mb-2", elementColors[element])} />
                            <span className="capitalize font-semibold">{element}</span>
                        </Button>
                        {isRecommended && (
                            <Badge variant="default" className="absolute -top-2 -right-3">Empfehlung</Badge>
                        )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                      <p>{elementStrengths[element] || "Keine Beschreibung verfügbar."}</p>
                  </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
