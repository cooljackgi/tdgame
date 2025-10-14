// src/components/game/TowerContextMenu.tsx
import * as React from 'react';
import { DollarSign, ArrowUpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PlacedTower, Tower, Element as GameElement } from '@/lib/game-data/types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import TowerComponent from './Tower';
import { Separator } from '../ui/separator';

type TowerContextMenuProps = {
  tower: PlacedTower;
  onUpgrade: (upgradeId: string) => void;
  onSell: () => void;
  onClose: () => void;
  allTowers: Tower[];
  localPlayer: { id: string, resources: number, unlockedElements: GameElement[] } | undefined;
};

const hasAllElements = (unlockedElements: Set<GameElement>, requiredElements: GameElement[]) => {
    return requiredElements.every(element => unlockedElements.has(element));
};

const TowerContextMenu: React.FC<TowerContextMenuProps> = ({
  tower,
  onUpgrade,
  onSell,
  onClose,
  allTowers,
  localPlayer,
}) => {
  const unlockedElementsSet = React.useMemo(() => new Set(localPlayer?.unlockedElements || []), [localPlayer]);
  
  const availableUpgrades = React.useMemo(() => {
    if (!tower.upgradesTo) return [];
    
    const towerMap = new Map(allTowers.map(t => [t.id, t]));
    const uniqueUpgradeIds = new Set(tower.upgradesTo);
    
    return Array.from(uniqueUpgradeIds)
      .map(id => towerMap.get(id))
      .filter((upg): upg is Tower => 
        !!upg && hasAllElements(unlockedElementsSet, upg.elements)
      );
  }, [tower, allTowers, unlockedElementsSet]);

  const handleAction = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    action();
  };

  return (
    <TooltipProvider>
      <div 
        className="flex items-center gap-2 bg-card/80 backdrop-blur-md p-2 rounded-lg border border-primary shadow-lg animate-in fade-in zoom-in-95"
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      >
        {/* Sell Button */}
        {tower.ownerId === localPlayer?.id && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="destructive"
                size="icon"
                onClick={(e) => handleAction(e, onSell)}
                className="w-12 h-12 flex-col gap-1 text-xs"
              >
                <DollarSign className="h-5 w-5" />
                <span>{Math.round(tower.cost * 0.75)}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Verkaufen</TooltipContent>
          </Tooltip>
        )}

        {availableUpgrades.length > 0 && tower.ownerId === localPlayer?.id && <Separator orientation="vertical" className="h-10 mx-1" />}

        {/* Upgrade Buttons */}
        {tower.ownerId === localPlayer?.id && availableUpgrades.map(upgrade => {
          const upgradeCost = upgrade.cost - Math.floor(tower.cost * 0.75);
          const canAfford = (localPlayer?.resources ?? 0) >= upgradeCost;
          const specId = upgrade.specId || upgrade.id;
          const variant = 
              specId.includes('-1a') || specId.includes('-2a') ? "sniper" :
              specId.includes('-1b') || specId.includes('-2b') ? "ballista" :
              "basic";

          return (
            <Tooltip key={upgrade.id}>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={(e) => handleAction(e, () => onUpgrade(upgrade.id))}
                  disabled={!canAfford}
                  className="w-12 h-12 flex-col gap-1 relative border-2 border-primary/50"
                >
                  <TowerComponent element={upgrade.elements[0]} size={24} variant={variant} isUpgraded={!upgrade.isBase} />
                  <span className="text-xs font-bold text-yellow-400">{upgradeCost}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-bold">{upgrade.name}</p>
                <p className="text-xs text-muted-foreground">{upgrade.description}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
};

export default TowerContextMenu;
