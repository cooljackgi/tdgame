// src/lib/game-logic.ts
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { User } from 'firebase/auth';
import type {
  PlacedTower, Difficulty, Enemy, Attack, DamageNumber, SplashRing, TowerEffect, Element, LifeGainVfx, SplashRingVfxType, PoisonCloud,
  AuraBuffs, DoTEffect, DamageApplicationResult, GravityWell
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

type ProcessAttackResult = {
    updatedEnemies: Enemy[];
    newAttacks: Attack[];
    damageNumbers: DamageNumber[];
    splashRings: SplashRing[];
    lifeGainVfx: LifeGainVfx[];
    newPoisonClouds: PoisonCloud[];
    resourcesGained: number;
    livesGained: number;
    killed: number;
};

export function processAttack(
    tower: PlacedTower,
    target: Enemy,
    allEnemies: Enemy[],
    now: number,
    isBuffed: boolean = false,
    opts: DamagePipelineOpts = { minDamage: 1, allowNegativeArmor: false }
): ProcessAttackResult {
    
    const output: ProcessAttackResult = {
        updatedEnemies: [...allEnemies],
        newAttacks: [],
        damageNumbers: [],
        splashRings: [],
        lifeGainVfx: [],
        newPoisonClouds: [],
        resourcesGained: 0,
        livesGained: 0,
        killed: 0,
    };
    
    const applyDamage = (enemy: Enemy, amount: number, isCrit: boolean = false): boolean => {
        if (enemy.deathTimestamp) return false;
        
        const damageDealt = Math.max(1, amount - enemy.armor);
        enemy.health -= damageDealt;
        enemy.wasHit = true;

        output.damageNumbers.push({
            id: crypto.randomUUID(),
            amount: damageDealt,
            targetId: enemy.id,
            isCrit,
            color: isCrit ? '#facc15' : '#fff'
        } as DamageNumber);
        
        if (enemy.health <= 0) {
            enemy.deathTimestamp = now;
            output.resourcesGained += enemy.bounty;
            output.killed++;
            return true;
        }
        return false;
    };
    
    const { effect } = tower;
    
    // --- Initial Attack on Primary Target ---
    const baseDamage = tower.damage * (isBuffed ? 1.15 : 1);
    const isCrit = (effect?.type === 'crit' && Math.random() < (effect.chance ?? 0));
    const critDamage = isCrit ? baseDamage * (effect.potency ?? 2) : baseDamage;

    const killedPrimary = applyDamage(target, critDamage, isCrit);

    // --- Process Effects ---
    if (effect && (!effect.chance || Math.random() < effect.chance)) {
        switch (effect.type) {
            case 'burn':
            case 'slow':
            case 'vulnerability':
            case 'armor_shred':
            case 'stun': {
                const existingEffectIndex = target.effects.findIndex(e => e.type === effect.type);
                if (existingEffectIndex !== -1) {
                    target.effects[existingEffectIndex].expires = now + (effect.duration ?? 2000);
                } else {
                    target.effects.push({
                        type: effect.type,
                        expires: now + (effect.duration ?? 2000),
                        potency: effect.potency ?? 0,
                    });
                }
                break;
            }
            case 'splash': {
                if(effect.radius && effect.vfxType){
                     output.splashRings.push({
                        id: crypto.randomUUID(),
                        x: target.position.col,
                        y: target.position.row,
                        r: effect.radius,
                        color: 'red',
                        element: tower.elements[0],
                        vfxType: effect.vfxType
                    } as SplashRing);
                }
                if (effect.potency && effect.radius) {
                    const splashDamage = critDamage * effect.potency;
                    output.updatedEnemies.forEach(enemy => {
                        if (enemy.id !== target.id && !enemy.deathTimestamp) {
                            const distSq = (target.position.col - enemy.position.col) ** 2 + (target.position.row - enemy.position.row) ** 2;
                            if (distSq <= effect.radius! ** 2) {
                                applyDamage(enemy, splashDamage, false);
                            }
                        }
                    });
                }
                 if (effect.vfxType === 'poison' && effect.radius && effect.duration && effect.potency) {
                    output.newPoisonClouds.push({
                        id: `cloud-${now}`,
                        x: target.position.col,
                        y: target.position.row,
                        radius: effect.radius,
                        potency: effect.potency,
                        duration: effect.duration,
                        expires: now + effect.duration * 1.5,
                    });
                }
                break;
            }
            case 'lifesteal': {
                const lifeGained = Math.floor(critDamage * (effect.potency ?? 0));
                if (lifeGained > 0) {
                    output.livesGained += lifeGained;
                    output.lifeGainVfx.push({ id: crypto.randomUUID(), amount: lifeGained });
                }
                break;
            }
            case 'chain': {
                let lastTarget = target;
                let bounces = effect.bounces ?? 1;
                let bounceDamage = critDamage;
                let potentialTargets = output.updatedEnemies.filter(e => e.id !== target.id && !e.deathTimestamp);

                for (let i = 0; i < bounces; i++) {
                    let nextTarget: Enemy | null = null;
                    let minBounceDistSq = 4 * 4; // Max bounce range

                    potentialTargets.forEach(pt => {
                        const distSq = (lastTarget.position.col - pt.position.col) ** 2 + (lastTarget.position.row - pt.position.row) ** 2;
                        if (distSq < minBounceDistSq) {
                            minBounceDistSq = distSq;
                            nextTarget = pt;
                        }
                    });

                    if (nextTarget) {
                        bounceDamage *= (effect.potency ?? 0.75);
                        applyDamage(nextTarget, bounceDamage, false);

                        output.newAttacks.push({
                            id: crypto.randomUUID(),
                            towerId: tower.id,
                            targetId: nextTarget.id,
                            targetPosition: nextTarget.position,
                            elements: tower.elements,
                            projectile: 'chain',
                            isChain: true,
                            chainSourceId: lastTarget.id,
                            baseDamage: 0
                        });
                        
                        lastTarget = nextTarget;
                        potentialTargets = potentialTargets.filter(t => t.id !== nextTarget!.id);
                    } else {
                        break;
                    }
                }
                break;
            }
        }
    }

    return output;
}


// --- Main-Loop Tick für DoTs (separat, unverändert zum Angriffs-Tempo) ---
export function tickDots(target: Enemy, deltaMs: number): { totalDamage: number, killed: boolean } {
  if (!target.effects?.length) return { totalDamage: 0, killed: false };
  
  let totalDamage = 0;
  let wasKilled = false;

  target.effects = target.effects.filter(effect => {
    if(effect.expires <= Date.now()) return false;

    if ((effect.type === 'burn' || effect.type === 'poison') && effect.potency) {
      const ticksDue = Math.floor((now - (effect.lastTick || (effect.expires - (effect.duration || 1000)))) / 1000);
      if (ticksDue > 0) {
        const tickDmg = Math.max(1, Math.floor(effect.potency));
        target.health -= tickDmg * ticksDue;
        totalDamage += tickDmg * ticksDue;
        effect.lastTick = now;
        
        if (target.health <= 0) {
          wasKilled = true;
        }
      }
    }
    return true;
  });

  return { totalDamage, killed: wasKilled };
}
