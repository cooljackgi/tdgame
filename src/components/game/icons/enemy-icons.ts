// This file contains the raw SVG path data for lucide icons used for enemies.
// This allows them to be drawn efficiently on a 2D canvas.

import type { EnemyType } from '@/lib/game-data/types';

export const enemyIconPaths: Record<EnemyType, string> = {
  standard: "m8 2 1.88 1.88M14.12 3.88 16 2M9 7.13v-1a3.003 3.003 0 1 1 6 0v1M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6ZM12 20v-4M4 13h2M18 13h2M4 17h2M18 17h2",
  schnell: "M13 17H3l5-5-5-5h10l5 5-5 5z",
  gepanzert: "M12 22v-4M14 13.5V13a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v.5M14 13.5V13a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v.5a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2zM18 18.5a6 6 0 0 0-12 0",
  heilend: "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",
  boss: "m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"
};

// Simple cross/tombstone icon for death animation
export const enemyTombstonePath = "M10 2v6m-4-2h8";
