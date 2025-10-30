// src/lib/game-logic.ts
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { User } from 'firebase/auth';
import type {
  PlacedTower, Difficulty, Enemy, Attack, DamageNumber, SplashRing, TowerEffect, Element, LifeGainVfx, SplashRingVfxType, PoisonCloud,
  AuraBuffs, DoTEffect, DamageApplicationResult
} from './game-data/types';
import { audioManager } from './audio/audio-manager';


/**
 * Handles the logic for when a game ends, such as saving the score.
 */
export async function onGameEnd(
    gameId: string,
    user: User | null,
    difficulty: Difficulty,
    wave: number,
    won: boolean,
    finalTowers: Record<string, PlacedTower>
) {
    if (!user || difficulty === 'Chaos') return; 
    
    try {
        await addDoc(collection(db, "scores"), {
            playerName: user.displayName || 'Anonymer Spieler',
            playerUid: user.uid,
            difficulty: difficulty,
            wave: wave,
            won: won,
            finalTowers: finalTowers,
            date: serverTimestamp(),
            gameId: gameId, 
        });
    } catch (e) {
        console.error("Failed to save score to Firestore:", e);
    }
}


export type DamagePipelineOpts = {
  minDamage?: number;             // z.B. 1
  allowNegativeArmor?: boolean;   // falls true, negative Rüstung erhöht Schaden
};

export function processAttack(
  attackerId: string,
  target: Enemy,
  atk: Attack,
  auras: AuraBuffs | null,
  opts: DamagePipelineOpts = { minDamage: 1, allowNegativeArmor: false }
): DamageApplicationResult {

  // --- Schritt 1: Roher Grundschaden (Base + Auren) ---
  let damage = atk.baseDamage;
  if (auras?.damageFlat) damage += auras.damageFlat;
  if (auras?.damageMult) damage *= (1 + auras.damageMult);

  // --- Schritt 2: Krit-Check ---
  const rolled = Math.random();
  const isCrit = rolled < (atk.critChance ?? 0);
  if (isCrit) {
    damage *= (atk.critMult ?? 2.0);
  }

  // --- Schritt 3: Verwundbarkeit vor Rüstung ---
  const vulnPct = target.debuffs?.vulnerabilityPct ?? 0;
  const totalVulnPct = (atk.vulnerabilityPct ?? 0) + vulnPct;
  if (totalVulnPct !== 0) {
    damage *= (1 + totalVulnPct);
  }

  // --- Schritt 4: Vereinfachte Rüstung (linear) ---
  const baseArmor = target.armor ?? 0;
  const flatPen = (atk.armorPenFlat ?? 0) + (target.debuffs?.armorReductionFlat ?? 0);
  let effectiveArmor = baseArmor - flatPen;

  if (!opts.allowNegativeArmor) {
    if (effectiveArmor < 0) effectiveArmor = 0;
  }
  let postArmorDamage = damage - effectiveArmor;
  if (opts.minDamage !== undefined) {
    postArmorDamage = Math.max(opts.minDamage, Math.floor(postArmorDamage));
  } else {
    postArmorDamage = Math.floor(postArmorDamage);
  }

  // --- Schritt 5: DoTs anwenden (Snapshotted) ---
  // DoTs werden jetzt „angeklebt“, die Ticks laufen im Main-Loop.
  // Wichtig: Snapshot der Schadenshöhe bei Anwendung, unabhängig von späteren Buffs/Nerfs.
  const appliedDots = (atk.dots ?? []).map(dot => snapshotDot(dot, { damage, isCrit, totalVulnPct }));

  // Ziel sofort Schaden zufügen, DoTs registrieren
  target.health -= postArmorDamage;
  for (const d of appliedDots) {
    target.activeDots = target.activeDots ?? [];
    target.activeDots.push(d);
  }

  return {
    immediateDamage: postArmorDamage,
    crit: isCrit,
    vulnerabilityAppliedPct: totalVulnPct,
    effectiveArmor,
    dotsApplied: appliedDots,
    killed: target.health <= 0
  };
}

function snapshotDot(dot: DoTEffect, snapshot: { damage: number; isCrit: boolean; totalVulnPct: number }): DoTEffect {
  // Beispiel: Dot skaliert prozentual vom gesnapshotteten Schaden oder hat Flat-Wert
  const basePerTick = dot.flatPerTick ?? (dot.scalePctOfHit ?? 0) * snapshot.damage;
  return {
    ...dot,
    // Snapshotwert fest einfrieren:
    flatPerTick: Math.max(1, Math.floor(basePerTick)),
    // Optional: Krits verstärken auch DoTs leicht (Game-Design-Entscheidung):
    critScaled: snapshot.isCrit ? true : false,
    // Merker, dass dieser DoT bereits gesnapshottet wurde
    snapshotted: true
  };
}

// --- Main-Loop Tick für DoTs (separat, unverändert zum Angriffs-Tempo) ---
export function tickDots(target: Enemy, deltaMs: number): { totalDamage: number, killed: boolean } {
  if (!target.activeDots?.length) return { totalDamage: 0, killed: false };
  
  let totalDamage = 0;
  let wasKilled = false;

  target.activeDots = target.activeDots.filter(dot => {
    dot.remainingMs -= deltaMs;
    if (dot.remainingMs < 0) return false; // Effect expired
    
    // Check if a tick is due
    // This is a simple implementation, a more robust one might accumulate time
    if (dot.remainingMs % dot.tickMs < deltaMs) {
      const tickDmg = Math.max(1, Math.floor(dot.flatPerTick ?? 0));
      target.health -= tickDmg;
      totalDamage += tickDmg;
      
      if (target.health <= 0) {
        wasKilled = true;
      }
    }
    return true;
  });

  return { totalDamage, killed: wasKilled };
}
