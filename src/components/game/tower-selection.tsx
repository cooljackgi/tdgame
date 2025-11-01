

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { elementBackgroundColors } from "@/lib/game-data/constants";
import type { Tower, PlacedTower, Element } from '@/lib/game-data/types';
import type { Player } from '@/lib/game-data/types';
import { Button } from "@/components/ui/button";
import { Coins, Zap, ArrowLeft, Hammer, DollarSign, Bomb, Gauge, ChevronsUp, Target, Dna, Bot, Timer } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "../ui/tooltip";
import TowerComponent from "@/components/game/Tower";


type TowerSelectionProps = {
  allTowers: Tower[];
  onSelectTower: (tower: Tower | null) => void;
  onEnterPortalMode: () => void;
  focusedTower: PlacedTower | null;
  selectedTowerToBuild: Tower | null;
  onUpgradeTower: (upgradeId: string) => void;
  onSellTower: () => void;
  onBack: () => void;
  localPlayer: Player;
  isMobile?: boolean;
  buffedTowerIds: Set<string>;
  currentWave: number;
}

const TowerCardIcon = React.memo(function TowerCardIcon({ tower }: { tower: Tower }) {
  const variant = 
      tower.id.endsWith('-1a') || tower.id.endsWith('-2a') ? "sniper" :
      tower.id.endsWith('-1b') || tower.id.endsWith('-2b') ? "ballista" :
      "basic";

  return (
    <TowerComponent
      element={tower.elements[0] ?? "neutral"}
      variant={variant}
      isUpgraded={!tower.isBase}
      size={32}
    />
  );
});

const hasAllElements = (unlockedElements: Set<Element>, requiredElements: Element[]) => {
    return requiredElements.every(element => unlockedElements.has(element));
};

const TowerCard = React.memo(({ tower, onSelect, disabled, isSelected }: { tower: Tower, onSelect: (tower: Tower) => void, disabled: boolean, isSelected: boolean }) => {
  const bgColorClass = elementBackgroundColors[tower.elements[0]] || 'bg-transparent hover:bg-accent/20';
  const attackSpeedPerSecond = tower.attackSpeed > 0 ? (1000 / tower.attackSpeed).toFixed(2) : '0';
  
  return (
    <li className="w-full">
      <button
        onClick={() => onSelect(tower)}
        disabled={disabled}
        className={cn(
          "flex flex-col items-start gap-2 w-full p-3 rounded-lg border-2 border-transparent transition-all text-left",
          isSelected ? "bg-primary/20 border-primary/50" : bgColorClass,
          "disabled:opacity-50 disabled:cursor-not-allowed"
        )}
      >
        <div className="flex items-start gap-3 w-full">
            <div className="flex-shrink-0 pt-1">
            <Tooltip>
                <TooltipTrigger asChild>
                <div className="h-8 w-8 flex items-center justify-center">
                    <TowerCardIcon tower={tower} />
                </div>
                </TooltipTrigger>
                <TooltipContent>
                <p className="capitalize">{tower.elements.join(' & ')} Element</p>
                </TooltipContent>
            </Tooltip>
            </div>
            <div className="flex-grow min-w-0">
            <h4 className="font-semibold">{tower.name}</h4>
            <p className="text-xs text-muted-foreground">{tower.description}</p>
            </div>
        </div>
        <Separator className="w-full bg-border/50 my-1"/>
        <div className="w-full flex items-center justify-start gap-4 pl-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5 text-yellow-400 font-medium"><Coins className="h-3.5 w-3.5"/> {tower.cost}</span>
            {tower.damage > 0 && <span className="flex items-center gap-1"><Bomb className="h-3 w-3 text-red-400/80"/> {tower.damage}</span>}
            {tower.attackSpeed > 0 && <span className="flex items-center gap-1"><ChevronsUp className="h-3 w-3 text-sky-400/80"/> {attackSpeedPerSecond}/s</span>}
            {tower.range > 0 && <span className="flex items-center gap-1"><Target className="h-3 w-3 text-green-400/80"/> {tower.range}</span>}
        </div>
      </button>
    </li>
  );
});

const StatDisplay = ({ icon: Icon, value, buff, label }: { icon: React.FC<any>, value: number | string, buff?: number, label: string }) => (
    <div className="flex items-center gap-1.5">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <div className="flex items-baseline gap-1">
            <span className="font-bold">{value}</span>
            {buff ? <span className="text-sm font-bold text-green-400">(+{buff.toFixed(1)})</span> : null}
            <span className="text-xs text-muted-foreground">{label}</span>
        </div>
    </div>
);


const TowerSelection = React.memo(function TowerSelection({ allTowers, onSelectTower, onEnterPortalMode, focusedTower, selectedTowerToBuild, onUpgradeTower, onSellTower, onBack, localPlayer, isMobile = false, buffedTowerIds, currentWave }: TowerSelectionProps) {
  
  const unlockedElementsSet = React.useMemo(() => new Set(localPlayer.unlockedElements), [localPlayer.unlockedElements]);
  
  const availableTowers = React.useMemo(() => {
    return allTowers.filter(t => t.isBase && hasAllElements(unlockedElementsSet, t.elements));
  }, [allTowers, unlockedElementsSet]);
  
  const availableUpgrades = React.useMemo(() => {
    if (!focusedTower?.upgradesTo) return [];
  
    const towerMap = new Map(allTowers.map(t => [t.id, t]));
    
    const uniqueUpgradeIds = new Set(focusedTower.upgradesTo);
  
    return Array.from(uniqueUpgradeIds)
      .map(id => towerMap.get(id))
      .filter((tower): tower is Tower => 
        !!tower && hasAllElements(unlockedElementsSet, tower.elements)
      );
  
  }, [focusedTower, allTowers, unlockedElementsSet]);

  const focusedTowerStats = React.useMemo(() => {
    if (!focusedTower) return null;

    const isBuffed = buffedTowerIds.has(focusedTower.id);
    const auraEffect = focusedTower.effects?.find(e => e.type === 'aura');
    const buffPotency = auraEffect?.potency ?? 0.15; // Standard 15% if not specified

    const baseDamage = focusedTower.damage;
    const baseAttackSpeed = focusedTower.attackSpeed;
    const baseDps = baseAttackSpeed > 0 ? baseDamage * (1000 / baseAttackSpeed) : 0;

    if (!isBuffed) {
      return { damage: baseDamage, attackSpeed: baseAttackSpeed, dps: baseDps, damageBuff: 0, dpsBuff: 0 };
    }

    const buffedDamage = baseDamage * (1 + buffPotency);
    const damageBuff = buffedDamage - baseDamage;
    const buffedDps = buffedDamage * (1000 / baseAttackSpeed);
    const dpsBuff = buffedDps - baseDps;

    return {
      damage: baseDamage,
      attackSpeed: baseAttackSpeed,
      dps: baseDps,
      damageBuff: damageBuff,
      dpsBuff: dpsBuff
    };
  }, [focusedTower, buffedTowerIds]);

  const portalCooldown = localPlayer.portalCooldownUntilWave || 0;
  const isPortalOnCooldown = portalCooldown > currentWave;
  const portalCost = 250;
  const canAffordPortal = localPlayer.resources >= portalCost;
  
  const portalButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="w-full"> {/* Wrapper for Tooltip with disabled button */}
          <button
              onClick={onEnterPortalMode}
              disabled={isPortalOnCooldown || !canAffordPortal}
              className="flex items-start gap-3 group w-full p-3 rounded-lg border-2 border-transparent transition-all text-left bg-purple-900/40 hover:bg-purple-900/60 disabled:opacity-50 disabled:cursor-not-allowed"
          >
              <div className="flex-shrink-0 pt-1 h-8 w-8 flex items-center justify-center">
                  <Bot className="h-6 w-6 text-cyan-300" />
              </div>
              <div className="flex-grow min-w-0">
                  <h4 className="font-semibold">Portal bauen</h4>
                  <p className="text-xs text-muted-foreground">Erschaffe eine Abkürzung. Hält bis zum Ende der Welle.</p>
              </div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-yellow-400">
                  <Coins className="h-3.5 w-3.5" />
                  <span>{portalCost}</span>
              </div>
          </button>
        </div>
      </TooltipTrigger>
      {isPortalOnCooldown && (
        <TooltipContent>
          <p className="flex items-center gap-2"><Timer className="h-4 w-4"/>Abklingzeit: Noch {portalCooldown - currentWave} Welle(n)</p>
        </TooltipContent>
      )}
    </Tooltip>
  );


  const content = (
      <>
      {focusedTower && focusedTowerStats ? (
         <div className="space-y-3">
            <div className="flex items-center justify-between p-2 bg-card rounded-lg">
                <div className="flex flex-col">
                    <span className="font-bold text-lg">{focusedTower.name}</span>
                    <span className="text-xs text-muted-foreground">Besitzer: {focusedTower.ownerId} | Verkauf: {Math.round(focusedTower.cost * 0.75)}</span>
                </div>
                 {focusedTower.ownerId === localPlayer.id && (
                    <Button variant="destructive" onClick={onSellTower}>
                        <DollarSign className="h-4 w-4 mr-2" />
                        Verkaufen
                    </Button>
                 )}
            </div>

            {/* Current Stats Display */}
            <div className="grid grid-cols-1 gap-2 px-2 text-sm">
                <StatDisplay icon={Dna} value={focusedTowerStats.dps.toFixed(1)} buff={focusedTowerStats.dpsBuff} label="DPS"/>
                <StatDisplay icon={Bomb} value={focusedTowerStats.damage} buff={focusedTowerStats.damageBuff} label="Schaden"/>
                <StatDisplay icon={ChevronsUp} value={`${(1000 / focusedTowerStats.attackSpeed).toFixed(2)}/s`} label="Rate"/>
                <StatDisplay icon={Target} value={focusedTower.range} label="Reichw."/>
            </div>
            
            <Separator />
          <p className="text-sm text-muted-foreground px-2">Upgrades:</p>
          <ul className="space-y-2">
            {availableUpgrades.length > 0 ? availableUpgrades.map((tower) => {
              const upgradeCost = tower.cost - Math.floor(focusedTower.cost * 0.75);
              return (
                <TowerCard 
                  key={tower.id}
                  tower={{...tower, cost: upgradeCost}}
                  onSelect={() => onUpgradeTower(tower.id)} 
                  disabled={localPlayer.resources < upgradeCost}
                  isSelected={false}
                />
              )
            }) : <p className="text-sm text-muted-foreground p-2">Keine weiteren Upgrades für diesen Turm verfügbar oder Element fehlt.</p>}
          </ul>
        </div>
      ) : (
        <ul className="space-y-2">
          <li className="w-full">
            {portalButton}
          </li>
          <Separator />
          {availableTowers.length > 0 ? availableTowers.map((tower) => (
              <TowerCard 
                key={tower.id}
                tower={tower} 
                onSelect={() => onSelectTower(tower)} 
                disabled={!localPlayer || localPlayer.resources < tower.cost}
                isSelected={selectedTowerToBuild?.id === tower.id}
              />
          )) : (
            <p className="text-sm text-muted-foreground p-2">
              Keine baubaren Türme. Schalte mehr Elemente frei!
            </p>
          )}
        </ul>
      )}
      </>
  );

  const getTitle = () => {
    if (focusedTower) return `Upgrade ${focusedTower.name}`;
    return `Turm-Menü (${localPlayer?.name || '...'})`;
  };

  if (isMobile) {
    return (
      <TooltipProvider>
        <ScrollArea className="h-full">
          {content}
        </ScrollArea>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          {focusedTower ? (
            <Button variant="ghost" size="icon" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : (
            <Hammer className="h-5 w-5 text-primary" />
          )}
          <CardTitle className="truncate">
            {getTitle()}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[calc(100vh-280px)] pr-4">
            {content}
          </ScrollArea>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
});

export default TowerSelection;
