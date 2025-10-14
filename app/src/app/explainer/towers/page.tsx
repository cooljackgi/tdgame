
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { towers } from '@/lib/game-data/towers';
import { elementIcons, elementColors } from '@/lib/game-data/constants';
import type { Tower, Element } from '@/lib/game-data/types';
import { Coins, Zap, Shield, Gauge, ArrowRight, Dna } from 'lucide-react';
import { cn } from '@/lib/utils';
import TowerComponent from '@/components/game/Tower';
import TowerDemo from '@/components/explainer/TowerDemo';

function getElementTowers(baseElement: Element) {
  if (baseElement === 'neutral') {
    return towers.filter(t => t.elements.length === 1 && t.elements[0] === 'neutral');
  }
  return towers.filter(t => t.elements.includes(baseElement) && !t.elements.includes('neutral'));
}


const TowerStat = ({ icon: Icon, value, label, className }: { icon: React.FC<any>, value: string | number, label: string, className?: string }) => (
    <div className={cn("flex items-center gap-2", className)}>
        <Icon className="h-5 w-5 text-muted-foreground" />
        <div className="flex flex-col">
            <span className="font-bold">{value}</span>
            <span className="text-xs text-muted-foreground">{label}</span>
        </div>
    </div>
);


export default function TowersPage() {

  const elementOrder: Element[] = ['neutral', 'fire', 'water', 'earth', 'air', 'light', 'dark', 'nature'];

  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-4xl font-bold tracking-tighter mb-2">Turm-Enzyklopädie</h1>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Lerne die Details zu jedem Turm, seinen Werten und seinen Upgrade-Pfaden.
        </p>
      </div>

      {elementOrder.map(element => {
        const ElementIcon = elementIcons[element];
        const towersForElement = getElementTowers(element);
        if (towersForElement.length === 0) return null;

        return (
          <div key={element} className="space-y-6">
            <div className="flex items-center gap-3">
              <ElementIcon className={cn("h-8 w-8", elementColors[element])} />
              <h2 className="text-3xl font-bold capitalize">{element} Türme</h2>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {towersForElement.sort((a,b) => a.tier - b.tier).map(tower => (
                <Card key={tower.id} className="flex flex-col">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <TowerComponent 
                                element={tower.elements[0]} 
                                variant={tower.id.includes('sniper') ? "sniper" : tower.id.includes('ballista') ? "ballista" : "basic"}
                                isUpgraded={!tower.isBase}
                                size={40}
                            />
                            <CardTitle className="text-xl">{tower.name}</CardTitle>
                        </div>
                       <Badge variant="outline">Tier {tower.tier}</Badge>
                    </div>
                    <CardDescription>{tower.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-grow flex flex-col justify-between gap-6">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                        <TowerStat icon={Coins} value={tower.cost} label="Kosten"/>
                        <TowerStat icon={Shield} value={tower.maxHealth} label="Leben"/>
                        {tower.damage > 0 && <TowerStat icon={Zap} value={tower.damage} label="Schaden" className="text-red-400"/>}
                        {tower.dps > 0 && <TowerStat icon={Dna} value={tower.dps.toFixed(1)} label="DPS" className="text-red-400"/>}
                        <TowerStat icon={Gauge} value={tower.range} label="Reichweite"/>
                        {tower.attackSpeed > 0 && <TowerStat icon={Gauge} value={`${(1000/tower.attackSpeed).toFixed(2)}/s`} label="Angriffsrate"/>}
                    </div>

                    <div className="bg-muted/50 rounded-lg h-28 flex items-center justify-center overflow-hidden relative">
                        <TowerDemo tower={tower} />
                    </div>

                    {tower.upgradesTo && tower.upgradesTo.length > 0 && (
                        <div>
                            <h4 className="text-sm font-semibold mb-2">Upgrades zu:</h4>
                            <div className="flex flex-col gap-2">
                                {tower.upgradesTo.map(upgId => {
                                    const upgTower = towers.find(t => t.id === upgId);
                                    if (!upgTower) return null;
                                    return (
                                        <div key={upgId} className="text-xs flex items-center gap-2 p-2 rounded-md bg-muted/50">
                                            <ArrowRight className="h-4 w-4 text-primary"/>
                                            <TowerComponent 
                                                element={upgTower.elements[0]} 
                                                size={20}
                                                variant={upgTower.id.includes('sniper') ? "sniper" : upgTower.id.includes('ballista') ? "ballista" : "basic"}
                                                isUpgraded={!upgTower.isBase}
                                            />
                                            <span className="font-medium">{upgTower.name}</span>
                                            <div className="flex gap-1 ml-auto">
                                                {upgTower.elements.map(el => <Badge key={el} variant="outline" className="text-[10px] p-1">{el}</Badge>)}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
