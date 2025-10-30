// src/lib/game-logic.ts
import type {
  Enemy, Attack, Element, AuraBuffs, DoTEffect, DamageApplicationResult, PlacedTower, ProcessAttackResult, SplashRing, DamageNumber, LifeGainVfx, PoisonCloud, GravityWell
} from '@/lib/game-data/types';
import { audioManager } from '@/lib/audio/audio-manager';
import { elementProjectileColors } from '@/lib/game-data/constants';


/**
 * Wendet den Schaden eines Angriffs auf ein einzelnes Ziel an.
 * Berechnet den Schaden basierend auf Rüstung, Verwundbarkeit und kritischen Treffern.
 */
function applyDamage(amount: number, enemy: Enemy, attack: Attack): { damageDealt: number, killed: boolean } {
    const armorPen = attack.armorPenFlat ?? 0;
    const effectiveArmor = Math.max(0, enemy.armor - armorPen);
    const damageDealt = Math.max(1, Math.floor(amount - effectiveArmor));

    enemy.health -= damageDealt;

    return {
        damageDealt,
        killed: enemy.health <= 0,
    };
}


export function processAttack(
  tower: PlacedTower,
  target: Enemy,
  allEnemies: Enemy[], // Wird für Flächenschaden etc. benötigt
  now: number,
  isBuffed: boolean,
): ProcessAttackResult {

    const output: ProcessAttackResult = {
        updatedEnemies: [...allEnemies],
        newAttacks: [],
        damageNumbers: [],
        splashRings: [],
        lifeGainVfx: [],
        newPoisonClouds: [],
        newGravityWells: [],
        resourcesGained: 0,
        livesGained: 0,
        killed: 0,
    };
    
    let currentTarget = output.updatedEnemies.find(e => e.id === target.id);
    if (!currentTarget || currentTarget.deathTimestamp) {
        return output; // Ziel ist bereits tot oder nicht mehr vorhanden
    }

    const { effect } = tower;
    const isCrit = (tower.effect?.type === 'crit' && Math.random() < tower.effect.chance!);
    const critMultiplier = isCrit ? (tower.effect?.potency ?? 2) : 1;
    
    let damageAmount = tower.damage * (isBuffed ? 1.15 : 1) * critMultiplier;
    
    const vulnerability = currentTarget.effects.find(e => e.type === 'vulnerability');
    if (vulnerability) {
        damageAmount *= (1 + vulnerability.potency);
    }
    
    const primaryAttack: Attack = {
        id: crypto.randomUUID(),
        towerId: tower.id,
        targetId: currentTarget.id,
        targetPosition: { ...currentTarget.position },
        elements: tower.elements,
        projectile: tower.id.includes('sniper') ? 'arrow' : 'beam',
        baseDamage: damageAmount,
        armorPenFlat: 0, 
    };
    output.newAttacks.push(primaryAttack);
    
    // --- ARMOR SHRED ---
    if (effect?.type === 'armor_shred' && Math.random() < (effect.chance ?? 1)) {
        primaryAttack.armorPenFlat = tower.damage * (effect.potency ?? 0);
    }

    const { damageDealt, killed } = applyDamage(damageAmount, currentTarget, primaryAttack);
    
    output.damageNumbers.push({
        id: crypto.randomUUID(),
        amount: damageDealt,
        targetId: currentTarget.id,
        color: isCrit ? '#ffeb3b' : '#ffffff',
        isCrit,
    });
    
    if (killed) {
        currentTarget.deathTimestamp = now;
        output.resourcesGained += currentTarget.bounty;
        output.killed++;
        if (tower.effect?.type === 'lifesteal' && Math.random() < (tower.effect.chance ?? 1)) {
            output.livesGained += (tower.effect.potency ?? 0);
            output.lifeGainVfx.push({ id: crypto.randomUUID(), amount: 1 });
        }
    } else {
        // Apply non-lethal status effects
        if (effect?.type === 'slow' && Math.random() < (effect.chance ?? 1)) {
            currentTarget.effects.push({ type: 'slow', expires: now + (effect.duration ?? 2000), potency: (effect.potency ?? 0.5) });
        }
        if (effect?.type === 'stun' && Math.random() < (effect.chance ?? 1)) {
            currentTarget.effects.push({ type: 'stun', expires: now + (effect.duration ?? 500), potency: 1 });
        }
        if (effect?.type === 'burn' && Math.random() < (effect.chance ?? 1)) {
            currentTarget.effects.push({ type: 'burn', expires: now + (effect.duration ?? 3000), potency: (effect.potency ?? 0) * damageAmount, lastTick: now });
        }
        if (effect?.type === 'vulnerability' && Math.random() < (effect.chance ?? 1)) {
            currentTarget.effects.push({ type: 'vulnerability', expires: now + (effect.duration ?? 5000), potency: (effect.potency ?? 0.1) });
        }
    }

    // --- SECONDARY EFFECTS ---

    if (effect?.type === 'splash') {
        output.splashRings.push({
            id: crypto.randomUUID(),
            x: currentTarget.position.col,
            y: currentTarget.position.row,
            r: effect.radius!,
            color: elementProjectileColors[tower.elements[0] || 'neutral'],
            element: tower.elements[0],
            vfxType: effect.vfxType
        });
        
        output.updatedEnemies.forEach(enemy => {
            if (enemy.id !== currentTarget!.id && !enemy.deathTimestamp) {
                const distSq = (enemy.position.col - currentTarget!.position.col)**2 + (enemy.position.row - currentTarget!.position.row)**2;
                if (distSq <= effect.radius!**2) {
                    const splashDmg = damageAmount * (effect.potency ?? 0.5);
                    const { damageDealt: splashDamageDealt, killed: splashKilled } = applyDamage(splashDmg, enemy, { ...primaryAttack, baseDamage: splashDmg });
                    output.damageNumbers.push({ id: crypto.randomUUID(), amount: splashDamageDealt, targetId: enemy.id, color: '#ffc107', isCrit: false });
                    if(splashKilled) {
                        enemy.deathTimestamp = now;
                        output.resourcesGained += enemy.bounty;
                        output.killed++;
                    }
                }
            }
        });
    }

    if (effect?.type === 'chain' && effect.bounces) {
        let lastTarget = currentTarget;
        for (let i = 0; i < effect.bounces; i++) {
            let nextTarget: Enemy | null = null;
            let minDistanceSq = Infinity;

            output.updatedEnemies.forEach(enemy => {
                if (enemy.id !== lastTarget.id && !enemy.deathTimestamp && !output.newAttacks.some(a => a.targetId === enemy.id)) {
                    const distSq = (enemy.position.col - lastTarget.position.col)**2 + (enemy.position.row - lastTarget.position.row)**2;
                    if (distSq < minDistanceSq) {
                        minDistanceSq = distSq;
                        nextTarget = enemy;
                    }
                }
            });

            if (nextTarget) {
                const chainDmg = damageAmount * ((effect.potency ?? 0.7) ** (i + 1));
                const { damageDealt: chainDamageDealt, killed: chainKilled } = applyDamage(chainDmg, nextTarget, { ...primaryAttack, baseDamage: chainDmg });
                output.newAttacks.push({ ...primaryAttack, id: crypto.randomUUID(), targetId: nextTarget.id, targetPosition: { ...nextTarget.position }, isChain: true, chainSourceId: lastTarget.id });
                output.damageNumbers.push({ id: crypto.randomUUID(), amount: chainDamageDealt, targetId: nextTarget.id, color: '#2196f3', isCrit: false });
                if(chainKilled) {
                    nextTarget.deathTimestamp = now;
                    output.resourcesGained += nextTarget.bounty;
                    output.killed++;
                }
                lastTarget = nextTarget;
            } else {
                break;
            }
        }
    }
    
     if (effect?.type === 'pull' && effect.radius && effect.duration && effect.potency) {
        output.newGravityWells.push({
            id: `well-${now}`,
            x: target.position.col,
            y: target.position.row,
            radius: effect.radius,
            potency: effect.potency,
            expires: now + effect.duration
        });
    }
    
    // --- SPECIAL CASE: Persistent Cloud ---
    if (effect?.type === 'persistent_cloud' && effect.radius && effect.duration && effect.potency) {
         output.newPoisonClouds.push({
            id: `cloud-${tower.id}-${now}`,
            x: currentTarget.position.col,
            y: currentTarget.position.row,
            radius: effect.radius,
            potency: effect.potency,
            duration: effect.duration,
            expires: now + 10000, // The cloud itself lingers for 10s
        });
    }


    return output;
}


// --- Main-Loop Tick für DoTs (separat, unverändert zum Angriffs-Tempo) ---
export function tickDots(target: Enemy, delta: number): { totalDamage: number, killed: boolean } {
  if (!target.effects?.length || target.deathTimestamp) return { totalDamage: 0, killed: false };
  
  let totalDamage = 0;
  
  for (const effect of target.effects) {
    if ((effect.type === 'burn' || effect.type === 'poison') && effect.expires > Date.now()) {
        const ticksSinceLast = delta / 1000;
        const damageThisFrame = (effect.potency ?? 0) * ticksSinceLast;
        target.health -= damageThisFrame;
        totalDamage += damageThisFrame;
    }
  }

  if (target.health <= 0) {
    return { totalDamage, killed: true };
  }
  
  return { totalDamage, killed: false };
}
