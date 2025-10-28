

import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { User } from 'firebase/auth';
import type { PlacedTower, Difficulty, Enemy, Attack, DamageNumber, SplashRing, TowerEffect, Element, LifeGainVfx, SplashRingVfxType } from './game-data/types';
import { elementProjectileColors } from './game-data/constants';
import { audioManager } from './audio/audio-manager';

// This file is intended for reusable game logic that can be shared
// between single-player and multiplayer contexts, especially for
// actions that interact with backend services like Firestore.

/**
 * Handles the logic for when a game ends, such as saving the score.
 * 
 * @param gameId - The ID of the game that just ended.
 * @param user - The authenticated Firebase user.
 * @param difficulty - The difficulty the game was played on.
 * @param wave - The final wave number reached.
 * @param won - Whether the player won the game.
 * @param finalTowers - The state of the towers at the end of the game.
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


/**
 * Processes a single attack from a tower to a target enemy, handling damage, effects, and special attacks.
 * This is a pure function that returns the results of the attack.
 * @returns An object containing the updated enemies, resources gained, and VFX to be rendered.
 */
export function processAttack(
    tower: PlacedTower,
    target: Enemy,
    allEnemies: Enemy[],
    now: number,
    isTowerBuffed: boolean // New parameter to check for Aura buffs
): {
    updatedEnemies: Enemy[];
    resourcesGained: number;
    killed: number;
    livesGained: number;
    damageNumbers: DamageNumber[];
    newAttacks: Attack[];
    splashRings: SplashRing[];
    lifeGainVfx: LifeGainVfx[];
} {
    const output = {
        updatedEnemies: [...allEnemies],
        resourcesGained: 0,
        killed: 0,
        livesGained: 0,
        damageNumbers: [] as DamageNumber[],
        newAttacks: [] as Attack[],
        splashRings: [] as SplashRing[],
        lifeGainVfx: [] as LifeGainVfx[],
    };

    // Play the dynamically generated sound for the primary attack
    audioManager.playAttackSound(tower.elements[0] || 'neutral', { x: tower.position.col, y: tower.position.row });

    const projectileType = tower.specId.includes('-1a') || tower.specId.includes('-2a') ? 'arrow' : 'beam';
    output.newAttacks.push({
        id: crypto.randomUUID(),
        towerId: tower.id,
        targetId: target.id,
        targetPosition: target.position,
        elements: tower.elements,
        projectile: projectileType,
    });

    // Helper to apply damage and effects to a single enemy
    const applyDamage = (
        enemyToDamage: Enemy,
        damageAmount: number,
        isCrit: boolean = false,
        sourceEffect?: TowerEffect
    ): Enemy => {
        // Find if this enemy is already dead, to prevent multi-kill rewards
        const originalEnemyState = allEnemies.find(e => e.id === enemyToDamage.id);
        const wasAlreadyDead = originalEnemyState ? originalEnemyState.health <= 0 : false;

        const armorShred = enemyToDamage.effects.find(ef => ef.type === 'armor_shred')?.potency ?? 0;
        const vulnerability = enemyToDamage.effects.find(ef => ef.type === 'vulnerability')?.potency ?? 0;
        const effectiveArmor = Math.max(0, enemyToDamage.armor * (1 - armorShred));
        
        // New percentage-based damage calculation
        const damageMultiplier = 1 - (effectiveArmor / (effectiveArmor + 100));
        let finalDamage = damageAmount * damageMultiplier;

        finalDamage *= (1 + vulnerability);
        
        let critMultiplier = 1;
        if (isCrit) {
            critMultiplier = sourceEffect?.type === 'crit' ? (sourceEffect.potency ?? 2) : 2;
            finalDamage *= critMultiplier;
        }

        output.damageNumbers.push({
            id: crypto.randomUUID(),
            amount: finalDamage,
            targetId: enemyToDamage.id,
            isCrit,
            color: isCrit ? '#facc15' : '#fff',
        } as DamageNumber);

        const newHealth = enemyToDamage.health - finalDamage;
        let newEffects = [...enemyToDamage.effects];

        if (sourceEffect) {
            const { type, chance = 1, duration = 0, potency = 0 } = sourceEffect;
            if (type !== 'crit' && Math.random() < chance) { // Crits are handled separately
                const existingEffectIndex = newEffects.findIndex(ef => ef.type === type);
                if (existingEffectIndex !== -1) {
                    newEffects[existingEffectIndex] = {
                        ...newEffects[existingEffectIndex],
                        expires: now + duration,
                        potency: Math.max(newEffects[existingEffectIndex].potency, potency),
                    };
                } else {
                    newEffects.push({ type, expires: now + duration, potency, duration });
                }
            }
        }
        
        // Check if the enemy was just defeated by this damage instance
        if (newHealth <= 0 && !wasAlreadyDead) {
            output.resourcesGained += enemyToDamage.bounty;
            output.killed++;
            if (sourceEffect?.type === 'lifesteal' && Math.random() < (sourceEffect.chance ?? 0)) {
                output.livesGained++;
                output.lifeGainVfx.push({ id: crypto.randomUUID(), amount: 1 });
            }
        }

        return { ...enemyToDamage, health: newHealth, wasHit: true, effects: newEffects };
    };
    
    // --- Process primary attack and its effects ---
    let attackDamage = tower.damage;
    if (isTowerBuffed) {
        const auraBuffPotency = 0.15; // Standard potency for aura towers
        attackDamage *= (1 + auraBuffPotency);
    }
    
    let isCrit = false;
    if (tower.effect?.type === 'crit' && Math.random() < (tower.effect.chance ?? 0)) {
        isCrit = true;
    }

    const targetIndex = output.updatedEnemies.findIndex(e => e.id === target.id);
    if (targetIndex > -1) {
        output.updatedEnemies[targetIndex] = applyDamage(output.updatedEnemies[targetIndex], attackDamage, isCrit, tower.effect);
    }
    
    // --- Process Splash Damage ---
    if (tower.effect?.type === 'splash' && tower.effect.radius) {
        const splashPotency = tower.effect.potency ?? 0.5;
        const splashRadiusSq = tower.effect.radius * tower.effect.radius;
        const splashDamage = attackDamage * splashPotency;

        let vfxType: SplashRingVfxType | undefined = undefined;
        const towerId = tower.specId;
        if (towerId.includes('combo-fire-earth')) vfxType = 'magma';
        else if (towerId.includes('fire-2b')) vfxType = 'flame';
        else if (towerId.includes('water-2b')) vfxType = 'ice';
        else if (towerId.includes('earth-2b')) vfxType = 'rock';
        else if (towerId.includes('nature-2b')) vfxType = 'thorn';
        else if (towerId.includes('light-2b')) vfxType = 'light';
        else if (towerId.includes('dark-2b')) vfxType = 'dark';


        output.splashRings.push({
            id: crypto.randomUUID(),
            x: target.position.col,
            y: target.position.row,
            r: tower.effect.radius,
            element: tower.elements[0] || 'neutral',
            color: elementProjectileColors[tower.elements[0] || 'neutral'],
            vfxType: vfxType,
        } as SplashRing);
        
        // Corrected splash damage logic
        const enemiesToUpdate = [...output.updatedEnemies];
        for (let i = 0; i < enemiesToUpdate.length; i++) {
            const enemy = enemiesToUpdate[i];
            if (enemy.id === target.id) continue;
            
            const distSq = (target.position.col - enemy.position.col) ** 2 + (target.position.row - enemy.position.row) ** 2;
            if (distSq <= splashRadiusSq) {
                const updatedEnemy = applyDamage(enemy, splashDamage, false, tower.effect);
                enemiesToUpdate[i] = { ...updatedEnemy, wasHit: true };
            }
        }
        output.updatedEnemies = enemiesToUpdate;
    }

    // --- Process Chain Damage ---
    if (tower.effect?.type === 'chain' && tower.effect.bounces) {
        let lastHitEnemy = target;
        let hitTargets = new Set<string>([target.id]);

        for (let i = 0; i < tower.effect.bounces; i++) {
            let nextTarget: Enemy | null = null;
            let closestDistSq = Infinity;
            
            output.updatedEnemies.forEach(potentialTarget => {
                if (!hitTargets.has(potentialTarget.id)) {
                    const distSq = (lastHitEnemy.position.col - potentialTarget.position.col)**2 + (lastHitEnemy.position.row - potentialTarget.position.row)**2;
                    if (distSq < closestDistSq && distSq <= tower.range ** 2) {
                        closestDistSq = distSq;
                        nextTarget = potentialTarget;
                    }
                }
            });

            if (nextTarget) {
                const chainDamage = attackDamage * (tower.effect?.potency ?? 0.5);
                const nextTargetIndex = output.updatedEnemies.findIndex(e => e.id === nextTarget!.id);
                if (nextTargetIndex > -1) {
                    const updatedEnemy = applyDamage(output.updatedEnemies[nextTargetIndex], chainDamage);
                    output.updatedEnemies[nextTargetIndex] = { ...updatedEnemy, wasHit: true };
                }

                output.newAttacks.push({
                    id: crypto.randomUUID(),
                    towerId: tower.id,
                    targetId: nextTarget.id,
                    isChain: true,
                    chainSourceId: lastHitEnemy.id,
                    targetPosition: nextTarget.position,
                    elements: tower.elements,
                    projectile: 'chain',
                });
                
                hitTargets.add(nextTarget.id);
                lastHitEnemy = nextTarget;
            } else {
                break;
            }
        }
    }
    
    // Function does not remove enemies, just updates their health.
    // The main game loop is responsible for handling death logic.
    return output;
}

