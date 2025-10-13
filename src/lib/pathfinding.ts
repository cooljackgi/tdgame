
import { GRID_COLS, GRID_ROWS } from "@/lib/game-data/constants";

export type Node = {
  row: number;
  col: number;
};

const START_NODE = { row: 1, col: 1 };
const END_NODE = { row: GRID_ROWS, col: GRID_COLS };

// Find the shortest path using Breadth-First Search (BFS) for a square grid
export function findPath(start: Node, end: Node, blocked: Node[], gridRows: number, gridCols: number): Node[] | null {
  const queue: Node[][] = [[start]];
  const visited = new Set<string>([`${start.row},${start.col}`]);

  const isBlocked = (row: number, col: number) => {
    return blocked.some(p => p.row === row && p.col === col);
  };
  
  const getNeighbors = (node: Node): Node[] => {
    const { row, col } = node;
    const neighbors: Node[] = [];
    
    // 4-directional movement for a square grid
    const directions = [
      { r: -1, c: 0 }, // Up
      { r: 1, c: 0 },  // Down
      { r: 0, c: -1 }, // Left
      { r: 0, c: 1 },  // Right
    ];
    
    for (const dir of directions) {
      const newRow = row + dir.r;
      const newCol = col + dir.c;
      if (newRow >= 1 && newRow <= gridRows && newCol >= 1 && newCol <= gridCols) {
        neighbors.push({ row: newRow, col: newCol });
      }
    }
    return neighbors;
  };

  while (queue.length > 0) {
    const path = queue.shift()!;
    const lastNode = path[path.length - 1];

    if (lastNode.row === end.row && lastNode.col === end.col) {
      return path.slice(1);
    }

    const neighbors = getNeighbors(lastNode);

    for (const neighbor of neighbors) {
      const key = `${neighbor.row},${neighbor.col}`;
      if (!visited.has(key) && !isBlocked(neighbor.row, neighbor.col)) {
        visited.add(key);
        const newPath = [...path, neighbor];
        queue.push(newPath);
      }
    }
  }

  return null; // No path found
}


// Helper function specifically for the minimap
export function getPathForLayout(layout: Node[]): Node[] | null {
    return findPath(START_NODE, END_NODE, layout, GRID_ROWS, GRID_COLS);
}
