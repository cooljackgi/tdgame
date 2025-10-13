
'use client';
import { useMemo } from 'react';
import type { PlacedTower } from '@/lib/game-data/types';
import { GRID_ROWS, GRID_COLS } from '@/lib/game-data/constants';
import TowerComponent from './Tower';
import { getPathForLayout } from '@/lib/pathfinding';
import { cn } from '@/lib/utils';

type ScoreboardMiniMapProps = {
  towersByCell: Record<string, PlacedTower>;
};

const CELL_SIZE_PX = 12; // Increased for better visuals
const START_NODE = { row: 1, col: 1 };
const END_NODE = { row: GRID_ROWS, col: GRID_COLS };

function gridToPx(row: number, col: number) {
    const x = (col - 1) * CELL_SIZE_PX;
    const y = (row - 1) * CELL_SIZE_PX;
    return { x, y };
}

export default function ScoreboardMiniMap({ towersByCell }: ScoreboardMiniMapProps) {
  const towers = useMemo(() => Object.values(towersByCell || {}), [towersByCell]);
  
  const pathD = useMemo(() => {
    if (towers.length === 0) return '';
    const path = getPathForLayout(towers.map(t => t.position));
    if (!path) return '';

    const startPos = gridToPx(START_NODE.row, START_NODE.col);
    let pathString = `M ${startPos.x + CELL_SIZE_PX / 2} ${startPos.y + CELL_SIZE_PX / 2}`;
    path.forEach(node => {
      const pos = gridToPx(node.row, node.col);
      pathString += ` L ${pos.x + CELL_SIZE_PX / 2} ${pos.y + CELL_SIZE_PX / 2}`;
    });
    return pathString;
  }, [towers]);


  return (
    <div
      className="relative bg-muted/20 border border-border rounded-lg overflow-hidden shadow-inner"
      style={{
        width: GRID_COLS * CELL_SIZE_PX,
        height: GRID_ROWS * CELL_SIZE_PX,
      }}
    >
        {/* Path visualization */}
        <svg width="100%" height="100%" className="absolute inset-0">
             <path
                d={pathD}
                fill="none"
                stroke="hsl(var(--primary) / 0.3)"
                strokeWidth="2"
                strokeLinejoin='round'
            />
        </svg>
      {towers.map(tower => {
         const specId = tower.specId || tower.id;
         const variant = 
             specId.includes('-1a') || specId.includes('-2a') ? "sniper" :
             specId.includes('-1b') || specId.includes('-2b') ? "ballista" :
             "basic";

        return (
          <div
            key={tower.id}
            className="absolute"
            style={{
              left: (tower.position.col - 1) * CELL_SIZE_PX,
              top: (tower.position.row - 1) * CELL_SIZE_PX,
              width: CELL_SIZE_PX,
              height: CELL_SIZE_PX,
            }}
            title={`${tower.name} (Tier ${tower.tier})`}
          >
             <TowerComponent
                element={tower.elements[0]}
                variant={variant}
                isUpgraded={!tower.isBase}
                size={CELL_SIZE_PX * 1.5} // Slightly larger for better detail
              />
          </div>
        );
      })}
    </div>
  );
}
