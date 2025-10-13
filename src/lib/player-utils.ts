
import type { Player } from "@/lib/game-data/types";

type AnyPlayers = Record<string, any> | any[] | null | undefined;

export function normalizePlayers(raw: AnyPlayers): Player[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    // If it's an array, just ensure the objects have the right shape
    return raw.map(p => ({
        id: p.id,
        name: p.name || (p.id === 'player1' ? 'Spieler 1' : 'Wartet...'),
        avatarUrl: p.avatarUrl || null,
        resources: p.resources || 0,
        unlockedElements: p.unlockedElements || ['neutral'],
    })) as Player[];
  }

  // If it's an object { player1: ..., player2: ... }
  const obj = raw as Record<string, any>;
  const out: Player[] = [];

  const p1 = obj.player1;
  if (p1) {
    out.push({
      id: "player1",
      name: p1.name ?? "Spieler 1",
      avatarUrl: p1.avatarUrl ?? null,
      resources: p1.resources ?? 0,
      unlockedElements: p1.unlockedElements ?? ["neutral"],
    });
  }

  const p2 = obj.player2;
  if (p2) {
    out.push({
      id: "player2",
      name: p2.name ?? "Wartet...",
      avatarUrl: p2.avatarUrl ?? null,
      resources: p2.resources ?? 0,
      unlockedElements: p2.unlockedElements ?? ["neutral"],
    });
  }

  return out;
}
