
// src/app/explainer/synergies/page.tsx
"use client";

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dna, Zap, Plus, ArrowRight, Minus } from 'lucide-react';
import { towers } from '@/lib/game-data/towers';
import { elementIcons, elementColors, ALL_PICKABLE_ELEMENTS } from '@/lib/game-data/constants';
import type { Element } from '@/lib/game-data/types';
import { cn } from '@/lib/utils';
import TowerComponent from '@/components/game/Tower';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function SynergiesPage() {
  const [selectedElements, setSelectedElements] = useState<Element[]>([]);

  const comboTowers = useMemo(() => towers.filter(t => t.elements.length > 1 && !t.id.includes('neutral')), []);

  const handleElementSelect = (element: Element) => {
    setSelectedElements(prev => {
      if (prev.includes(element)) {
        return prev.filter(e => e !== element);
      }
      if (prev.length < 2) {
        return [...prev, element];
      }
      return prev; // Max 2 elements
    });
  };
  
  const resultTower = useMemo(() => {
    if (selectedElements.length !== 2) return null;
    const sortedSelected = [...selectedElements].sort();
    
    return comboTowers.find(tower => {
      const sortedTowerElements = [...tower.elements].sort();
      return sortedTowerElements.length === 2 && sortedTowerElements.every((val, index) => val === sortedSelected[index]);
    });
  }, [selectedElements, comboTowers]);


  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold tracking-tighter mb-2">Synergie-Werkstatt</h1>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Mische die Elemente und entdecke mächtige Kombinationstürme. Wähle zwei Elemente aus, um das Ergebnis zu sehen.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Dna className="text-primary" />
            Wähle deine Elemente
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-center gap-4">
            {ALL_PICKABLE_ELEMENTS.map(element => {
                const Icon = elementIcons[element];
                const isSelected = selectedElements.includes(element);
                return (
                    <Button 
                        key={element} 
                        variant={isSelected ? "default" : "outline"} 
                        className={cn("h-20 w-20 flex-col gap-1 border-2", isSelected && "border-primary shadow-lg")}
                        onClick={() => handleElementSelect(element)}
                    >
                        <Icon className={cn("h-7 w-7", !isSelected && elementColors[element])}/>
                        <span className="capitalize text-xs">{element}</span>
                    </Button>
                )
            })}
        </CardContent>
      </Card>
      
      <div className="min-h-[200px]">
        {resultTower ? (
           <Card className="border-primary/50 bg-primary/10 animate-fade-in">
             <CardHeader>
               <CardTitle className="flex flex-wrap items-center justify-center gap-4 text-center">
                    <div className="flex items-center gap-2">
                       <span className={cn("font-bold capitalize", elementColors[selectedElements[0]])}>{selectedElements[0]}</span>
                       <Plus className="h-5 w-5 text-muted-foreground" />
                       <span className={cn("font-bold capitalize", elementColors[selectedElements[1]])}>{selectedElements[1]}</span>
                    </div>
                    <ArrowRight className="h-6 w-6 text-primary hidden md:block" />
                    <span className="text-2xl md:text-3xl text-primary font-bold">{resultTower.name}</span>
               </CardTitle>
             </CardHeader>
             <CardContent className="flex flex-col md:flex-row items-center justify-center gap-8 text-center md:text-left">
                <TowerComponent
                    element={resultTower.elements[0]}
                    variant={resultTower.id.includes('sniper') ? 'sniper' : resultTower.id.includes('ballista') ? 'ballista' : 'basic'}
                    isUpgraded={!resultTower.isBase}
                    size={80}
                 />
                 <div>
                    <p className="text-lg text-muted-foreground max-w-md">{resultTower.description}</p>
                    <div className="flex gap-2 mt-2 justify-center md:justify-start">
                        {resultTower.elements.map(el => (
                          <Badge key={el} variant="outline" className="capitalize">{el}</Badge>
                        ))}
                   </div>
                 </div>
             </CardContent>
           </Card>
        ) : (
          <div className="text-center py-10">
            <p className="text-muted-foreground">
              {selectedElements.length < 2 
                ? 'Wähle ein weiteres Element, um eine Kombination zu entdecken.' 
                : 'Für diese Kombination gibt es (noch) keinen speziellen Turm.'
              }
            </p>
          </div>
        )}
      </div>

    </div>
  );
}
