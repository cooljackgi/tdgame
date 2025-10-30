// src/lib/game-logic.ts
import type {
  Enemy, Attack, Element, AuraBuffs, DoTEffect, DamageApplicationResult
} from '@/lib/game-data/types';

export type DamagePipelineOpts = {
  minDamage?: number;             // z.B. 1
  allowNegativeArmor?: boolean;   // falls true, negative Rüstung erhöht Schaden
};

type AttackContext = {
  baseDamage: number;             // Turmbasis + Auren/Upgrades
  critChance: number;             // 0..1
  critMult: number;               // z.B. 2.0
  vulnerabilityPct: number;       // z.B. 0.25 = +25%
  armorPenFlat: number;           // flache Rüstungsreduktion
  dots: DoTEffect[];              // zu applizierende DoTs (brennen/gift), leer wenn keine
  element?: Element;
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
export function tickDots(target: Enemy): number {
  if (!target.activeDots?.length) return 0;
  let total = 0;
  target.activeDots = target.activeDots.filter(dot => {
    const tickDmg = Math.max(1, Math.floor(dot.flatPerTick ?? 0));
    target.health -= tickDmg;
    total += tickDmg;
    dot.remainingMs -= dot.tickMs;
    return dot.remainingMs > 0;
  });
  return total;
}
