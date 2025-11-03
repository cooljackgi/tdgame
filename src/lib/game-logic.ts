
// src/lib/game-logic.ts
import type {
  Enemy, Attack, Element, AuraBuffs, DoTEffect, DamageApplicationResult, PlacedTower, ProcessAttackResult, SplashRing, DamageNumber, LifeGainVfx, PersistentCloud, GravityWell, SoundEvent,
  Worker, WorkerOrder, PlacePortalOrder, GhostFoundation, GameSessionState, Node, Portal, Player
} from './game-data/types';
import { audioManager } from './audio/audio-manager';
import { elementProjectileColors, GRID_COLS, GRID_ROWS } from './game-data/constants';
import type { Tower } from '@/lib/game-data/types';
import { findPath } from './pathfinding';
import { loadGameConfig, type GameConfig } from './game-config-loader';

const TILE_SIZE = 64;
export const centerOf = (row: number, col: number) => ({
  x: (col - 1) * TILE_SIZE + TILE_SIZE / 2,
  y: (row - 1) * TILE_SIZE + TILE_SIZE / 2,
});


/**
 * Wendet den Schaden eines Angriffs auf ein einzelnes Ziel an.
 * Berechnet den Schaden basierend auf Rüstung, Verwundbarkeit und kritischen Treffern.
 * Berücksichtigt jetzt Rüstungsdurchdringung.
 */
function applyDamage(amount: number, enemy: Enemy, attack: Attack): { damageDealt: number, killed: boolean } {
    const armorShredDebuff = enemy.effects.find(e => e.type === 'armor_shred');
    const armorReduction = armorShredDebuff ? (armorShredDebuff.potency ?? 0) : 0;
    const currentArmor = enemy.armor * (1 - armorReduction);
    
    const armorPen = attack.armorPenFlat ?? 0;
    const effectiveArmor = Math.max(0, currentArmor - armorPen);
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
        newPersistentClouds: [],
        newGravityWells: [],
        soundEvents: [],
        resourcesGained: 0,
        livesGained: 0,
        killed: 0,
    };
    
    let currentTarget = output.updatedEnemies.find(e => e.id === target.id);
    if (!currentTarget || currentTarget.deathTimestamp) {
        return output; // Ziel ist bereits tot oder nicht mehr vorhanden
    }
    
    output.soundEvents.push({ kind: 'attack', element: tower.elements[0], x: tower.position.col, y: tower.position.row });


    const { effects } = tower;
    const critEffect = effects?.find(e => e.type === 'crit');
    const isCrit = (critEffect && Math.random() < (critEffect.chance ?? 0));
    const critMultiplier = isCrit ? (critEffect?.potency ?? 2) : 1;
    
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
    
    const armorShredEffect = effects?.find(e => e.type === 'armor_shred');
    if (armorShredEffect && Math.random() < (armorShredEffect.chance ?? 1)) {
        primaryAttack.armorPenFlat = tower.damage * (armorShredEffect.potency ?? 0);
    }
    output.newAttacks.push(primaryAttack);

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
        output.soundEvents.push({ kind: 'sfx', name: 'enemy_die', x: currentTarget.position.col, y: currentTarget.position.row });
        audioManager.playVibration('kill');
        output.resourcesGained += currentTarget.bounty;
        output.killed++;
        const lifestealEffect = effects?.find(e => e.type === 'lifesteal');
        if (lifestealEffect && Math.random() < (lifestealEffect.chance ?? 0)) {
            output.livesGained += 1;
            output.lifeGainVfx.push({ id: crypto.randomUUID(), amount: 1 });
        }
    } else {
        effects?.forEach(effect => {
            if (effect.type === 'armor_shred' && Math.random() < (effect.chance ?? 1)) {
                currentTarget.effects.push({ type: 'armor_shred', expires: now + (effect.duration ?? 4000), potency: (effect.potency ?? 0) });
            }
            if (effect.type === 'slow' && Math.random() < (effect.chance ?? 1)) {
                currentTarget.effects.push({ type: 'slow', expires: now + (effect.duration ?? 2000), potency: (effect.potency ?? 0.5) });
            }
            if (effect.type === 'stun' && Math.random() < (effect.chance ?? 1)) {
                currentTarget.effects.push({ type: 'stun', expires: now + (effect.duration ?? 500), potency: 1 });
            }
            if (effect.type === 'burn' && Math.random() < (effect.chance ?? 1)) {
                currentTarget.effects.push({ type: 'burn', expires: now + (effect.duration ?? 3000), potency: (effect.potency ?? 0) * damageAmount, lastTick: now });
            }
            if (effect.type === 'vulnerability' && Math.random() < (effect.chance ?? 1)) {
                currentTarget.effects.push({ type: 'vulnerability', expires: now + (effect.duration ?? 5000), potency: (effect.potency ?? 0.1) });
            }
        });
    }

    const splashEffect = effects?.find(e => e.type === 'splash');
    if (splashEffect) {
        output.splashRings.push({
            id: crypto.randomUUID(),
            x: currentTarget.position.col,
            y: currentTarget.position.row,
            r: splashEffect.radius!,
            vfxR: splashEffect.vfxRadius,
            color: elementProjectileColors[tower.elements[0] || 'neutral'],
            element: tower.elements[0],
            vfxType: splashEffect.vfxType
        });
        
        output.updatedEnemies.forEach(enemy => {
            if (enemy.id !== currentTarget!.id && !enemy.deathTimestamp) {
                const distSq = (enemy.position.col - currentTarget!.position.col)**2 + (enemy.position.row - currentTarget!.position.row)**2;
                if (distSq <= splashEffect.radius!**2) {
                    const splashDmg = damageAmount * (splashEffect.potency ?? 0.5);
                    const { damageDealt: splashDamageDealt, killed: splashKilled } = applyDamage(splashDmg, enemy, { ...primaryAttack, baseDamage: splashDmg });
                    output.damageNumbers.push({ id: crypto.randomUUID(), amount: splashDamageDealt, targetId: enemy.id, color: '#ffc107', isCrit: false });
                    if(splashKilled) {
                        enemy.deathTimestamp = now;
                        output.soundEvents.push({ kind: 'sfx', name: 'enemy_die', x: enemy.position.col, y: enemy.position.row });
                        audioManager.playVibration('kill');
                        output.resourcesGained += enemy.bounty;
                        output.killed++;
                    }
                    if (tower.specId === 'dark-2b') {
                        enemy.effects.push({ type: 'vulnerability', expires: now + 5000, potency: splashEffect.potency ?? 0.1 });
                    }
                }
            }
        });
    }

    if (tower.specId === 'combo-water-nature') {
        const slowPotency = 0.25;
        const poisonPotency = 15;
        const effectDuration = 3000;
        currentTarget.effects.push({ type: 'slow', expires: now + effectDuration, potency: slowPotency });
        currentTarget.effects.push({ type: 'poison', expires: now + effectDuration, potency: poisonPotency, lastTick: now });
    }

    const chainEffect = effects?.find(e => e.type === 'chain');
    if (chainEffect && chainEffect.bounces) {
        let lastTarget = currentTarget;
        for (let i = 0; i < chainEffect.bounces; i++) {
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
                const chainDmg = damageAmount * ((chainEffect.potency ?? 0.7) ** (i + 1));
                const { damageDealt: chainDamageDealt, killed: chainKilled } = applyDamage(chainDmg, nextTarget, { ...primaryAttack, baseDamage: chainDmg });
                output.newAttacks.push({ ...primaryAttack, id: crypto.randomUUID(), targetId: nextTarget.id, targetPosition: { ...nextTarget.position }, isChain: true, chainSourceId: lastTarget.id });
                output.damageNumbers.push({ id: crypto.randomUUID(), amount: chainDamageDealt, targetId: nextTarget.id, color: '#2196f3', isCrit: false });
                if(chainKilled) {
                    nextTarget.deathTimestamp = now;
                    output.soundEvents.push({ kind: 'sfx', name: 'enemy_die', x: nextTarget.position.col, y: nextTarget.position.row });
                    audioManager.playVibration('kill');
                    output.resourcesGained += nextTarget.bounty;
                    output.killed++;
                }
                lastTarget = nextTarget;
            } else {
                break;
            }
        }
    }
    
    const pullEffect = effects?.find(e => e.type === 'pull');
    if (pullEffect && pullEffect.radius && pullEffect.duration && pullEffect.potency) {
        output.newGravityWells.push({
            id: `well-${now}`,
            x: target.position.col,
            y: target.position.row,
            radius: pullEffect.radius,
            potency: pullEffect.potency,
            expires: now + pullEffect.duration
        });
    }
    
    const cloudEffect = effects?.find(e => e.type === 'persistent_cloud');
    if (cloudEffect && cloudEffect.radius && cloudEffect.duration && cloudEffect.potency) {
         output.newPersistentClouds.push({
            id: `cloud-${tower.id}-${now}`,
            effectType: cloudEffect.cloudEffect || 'slow',
            x: currentTarget.position.col,
            y: currentTarget.position.row,
            radius: cloudEffect.radius,
            potency: cloudEffect.potency,
            duration: cloudEffect.duration,
            expires: now + 10000,
        });
    }

    return output;
}


export function tickDots(target: Enemy, delta: number): { totalDamage: number, killed: boolean } {
  if (!target.effects?.length || target.deathTimestamp) return { totalDamage: 0, killed: false };
  
  let totalDamage = 0;
  
  for (const effect of target.effects) {
    if (effect.expires > Date.now()) {
        const ticksSinceLast = delta / 1000;
        
        if (effect.type === 'burn' || effect.type === 'poison') {
            const damageThisFrame = (effect.potency ?? 0) * ticksSinceLast;
            target.health -= damageThisFrame;
            totalDamage += damageThisFrame;
        }
    }
  }

  if (target.health <= 0) {
    return { totalDamage, killed: true };
  }
  
  return { totalDamage, killed: false };
}


// --- Worker Logic ---

export function startNextOrder(state: GameSessionState, w: Worker): GameSessionState {
  if (w.moveTarget && w.state !== 'building') {
    w.state = "moving";
    w.current = undefined;
    return state;
  }

  const next = w.queue.shift();
  if (!next) { 
    w.state = "idle";
    w.current = undefined;
    return state;
  }

  let targetRow: number, targetCol: number;

  if (next.type === "build_tower") {
    targetRow = next.row; targetCol = next.col;
  } else { // place_portal
    const phaseCell = next.phase === "entrance" ? next.entrance : next.exit;
    targetRow = phaseCell.row; targetCol = phaseCell.col;
  }
  const { x, y } = centerOf(targetRow, targetCol);
  w.current = { order: next, targetX: x, targetY: y };
  w.state = "moving";
  return state;
}


export function tickWorkers(state: GameSessionState, dtMs: number, now: number, allTowers: Tower[]): GameSessionState {
  let newState = { ...state };
  for (const w of newState.workers) {
    const updatedState = stepWorker(newState, w, dtMs, now, allTowers);
    newState = { ...updatedState };
  }
  return newState;
}

function stepWorker(state: GameSessionState, w: Worker, dtMs: number, now: number, allTowers: Tower[]): GameSessionState {
  if (w.state === "idle") {
    if (w.queue.length > 0) {
      return startNextOrder(state, w);
    }
    return state;
  }

  if (w.state === "moving") {
    const targetX = w.moveTarget ? w.moveTarget.x : w.current!.targetX;
    const targetY = w.moveTarget ? w.moveTarget.y : w.current!.targetY;
    
    const dx = targetX - w.x, dy = targetY - w.y;
    const dist = Math.hypot(dx, dy);
    const step = (w.speed * dtMs) / 1000;

    w.z = 4 * Math.sin(now / 180);

    if (dist <= step) {
      w.x = targetX;
      w.y = targetY;

      if (w.moveTarget) {
        w.moveTarget = null;
        w.state = "idle";
        return startNextOrder(state, w);
      } else {
        w.state = "building";
        w.current!.startedAt = now;
        const o = w.current!.order;
        w.current!.eta = now + (o.type === "build_tower" ? o.buildTimeMs : (o.phase === "entrance" ? o.buildTimeMsEntrance : o.buildTimeMsExit));
      }
    } else {
      w.x += (dx / dist) * step;
      w.y += (dy / dist) * step;
    }
    return state;
  }

  if (w.state === "building") {
    if (!w.current) {
      w.state = "idle";
      return state;
    }
    
    const { order, startedAt, eta } = w.current;
    const p = Math.min(1, (now - (startedAt ?? now)) / (eta! - (startedAt ?? now) || 1));
    
    if (order.type === 'build_tower') {
      const ghost = state.ghosts.find(g => g.row === order.row && g.col === order.col);
      if(ghost) ghost.progress = p;
    }

    if (now >= (eta ?? now)) {
      if (order.type === 'build_tower') {
        return completeConstruction(state, w, allTowers);
      } else {
        return completePlacePortalPhase(state, w);
      }
    }
    return state;
  }
  return state;
}

function completeConstruction(state: GameSessionState, w: Worker, allTowers: Tower[]): GameSessionState {
  if (!w.current || w.current.order.type !== 'build_tower') return state;
  const { order } = w.current;
  
  const newState = { ...state };
  
  newState.ghosts = newState.ghosts.filter(g => !(g.row === order.row && g.col === order.col));

  const towerSpec = allTowers.find(t => t.id === order.towerId)!;
  
  const owner = newState.players.find(p => p.id === (w.id.includes('1') ? 'player1' : 'player2'));

  const newTower: PlacedTower = {
    ...towerSpec,
    id: `tower-${order.row}-${order.col}-${Date.now()}`,
    specId: towerSpec.id,
    position: { row: order.row, col: order.col },
    lastAttack: 0,
    health: towerSpec.maxHealth,
    ownerId: owner ? owner.id : 'player1',
  };

  const cellKey = `${order.row}_${order.col}`;
  newState.towersByCell = { ...newState.towersByCell, [cellKey]: newTower };

  audioManager.play({kind: 'sfx', name: 'build_tower'});

  w.current = undefined;
  w.state = "idle";
  
  return startNextOrder(newState, w);
}

function completePlacePortalPhase(state: GameSessionState, w: Worker): GameSessionState {
    if (!w.current || w.current.order.type !== 'place_portal') return state;
    const order = w.current.order as PlacePortalOrder;
    const now = Date.now();
    const ownerId = w.id.includes('1') ? 'player1' : 'player2';

    if (order.phase === 'entrance') {
        state.ghosts.push({ id: `ghost-portal-entrance-${now}`, row: order.entrance.row, col: order.entrance.col, towerId: 'portal_entrance', startedAt: now, buildTimeMs: 0, progress: 1, });
        order.phase = 'exit';
        const { x, y } = centerOf(order.exit.row, order.exit.col);
        w.current.targetX = x;
        w.current.targetY = y;
        w.state = 'moving';
        w.current.startedAt = now; // Reset timer for next phase
        w.current.eta = now + order.buildTimeMsExit;
        return state;
    } else { // Phase is 'exit'
        state.ghosts.push({ id: `ghost-portal-exit-${now}`, row: order.exit.row, col: order.exit.col, towerId: 'portal_exit', startedAt: now, buildTimeMs: 0, progress: 1, });
        
        const newPortals = state.portals ? [...state.portals] : [];
        newPortals.push({
            id: `portal-${order.createdAt}`,
            ownerId: ownerId,
            entrance: order.entrance,
            exit: order.exit,
            active: true,
            usesLeft: Infinity,
            perEnemyCooldownMs: 5000,
            expiresAt: 0, // Will be set at end of wave
        });
        state.portals = newPortals;

        w.current = undefined;
        w.state = "idle";
        return startNextOrder(state, w);
    }
}
