

"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import GameSession from './game-session';
import type { Tower, PlacedTower, Enemy, Node, Element, Difficulty, Attack, DamageNumber, SplashRing, GameSaveState, GameResult, GameDelta, EnemyStatusEffect, MovementPattern } from '@/lib/game-data/types';
import { DeltaType } from '@/lib/game-data/types';
import { useToast } from '@/hooks/use-toast';
import { difficultyModifiers, ALL_PICKABLE_ELEMENTS, INTERMISSION_TIME, GRID_ROWS, GRID_COLS, LOCAL_STORAGE_KEY } from '@/lib/game-data/constants';
import type { User } from 'firebase/auth';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { normalizePlayers } from '@/lib/player-utils';
import { Loader2 } from 'lucide-react';
import { audioManager } from '@/lib/audio/audio-manager';
import { findPath } from '@/lib/pathfinding';

import type { Player, GameState, GameStatus } from './game-session';
import { towers as initialTowers } from '@/lib/game-data/towers';
import { waves } from '@/lib/game-data/enemies';

function findClosestPathIndex(path: Node[], position: Node): number {
    if (!path || path.length === 0) return 0;
    let closestIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < path.length; i++) {
        const node = path[i];
        const distSq = Math.pow(node.col - position.col, 2) + Math.pow(node.row - position.row, 2);
        if (distSq < minDistance) {
            minDistance = distSq;
            closestIndex = i;
        }
    }
    return closestIndex;
}


type SinglePlayerGameProps = {
    difficulty: Difficulty;
    onExit: () => void;
    initialSavedGame: GameSaveState | null;
    isCheating?: boolean;
    startWithTutorial?: boolean;
    user: User | null;
}

export default function SinglePlayerGame({
    difficulty: initialDifficulty,
    onExit,
    initialSavedGame,
    isCheating = false,
    startWithTutorial = false,
    user
}: SinglePlayerGameProps) {
    const { toast } = useToast();

    // --- Core Game State ---
    const [players, setPlayers] = useState<Player[]>([]);
    const [gameState, setGameState] = useState<GameState>({ lives: 20 });
    const [towersByCell, setTowersByCell] = useState<Record<string, PlacedTower>>({});
    const [enemies, setEnemies] = useState<Enemy[]>([]);
    const [currentWave, setCurrentWave] = useState(0);
    const [gameStatus, setGameStatus] = useState<GameStatus>('playing');
    const [difficulty, setDifficulty] = useState<Difficulty>(initialDifficulty);
    const [isIntermission, setIsIntermission] = useState(true);
    const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);
    
    // --- VFX State ---
    const [attacks, setAttacks] = useState<Attack[]>([]);
    const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
    const [splashRings, setSplashRings] = useState<SplashRing[]>([]);
    const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string|null>(null);
    const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());

    // --- Local UI & Logic State ---
    const [finalGameResult, setFinalGameResult] = useState<GameResult | null>(null);
    const [selectedTowerToBuild, setSelectedTowerToBuild] = useState<Tower | null>(null);
    const [focusedTower, setFocusedTower] = useState<PlacedTower | null>(null);
    const [spawnedThisWave, setSpawnedThisWave] = useState(0);
    const [fps, setFps] = useState(0);
    
    // --- Refs for Game Loop ---
    const gameLoopRef = useRef<number>();
    const lastTickRef = useRef(performance.now());
    const spawnerRef = useRef<NodeJS.Timeout>();
    const waveInProgressRef = useRef(false);
    const enemyIdCounter = useRef(0);
    
    const START_NODE = { row: 1, col: 1 };
    const END_NODE = { row: GRID_ROWS, col: GRID_COLS };
  
    const currentPath = useMemo(() => {
      const blockedPositions = Object.values(towersByCell).map(t => t.position);
      return findPath(START_NODE, END_NODE, blockedPositions, GRID_ROWS, GRID_COLS) || [];
    }, [towersByCell]);
    
    const applyDeltas = useCallback((deltas: GameDelta[]) => {
      setEnemies(prevEnemies => {
          let newEnemies = [...prevEnemies];
          const deltasToProcess = [...deltas];
          let stateUpdate: Partial<GameState & { gameStatus: GameStatus, currentWave: number, isIntermission: boolean, waveStartCountdown: number, spawnedThisWave: number }> | null = null;
          let playerUpdates: Record<string, Partial<Player>> | null = null;
          let newTowers: Record<string, PlacedTower> | null = null;

          deltasToProcess.forEach(delta => {
              const type = delta[0];
              const payload = delta[1];
              switch (type) {
                  case DeltaType.ENEMY_SPAWN:
                      newEnemies.push({ ...payload, path: currentPath });
                      break;
                  case DeltaType.ENEMY_MOVE:
                      const [id, pathIndex, now] = delta.slice(1);
                      newEnemies = newEnemies.map(e => e.id === id ? { ...e, pathIndex, lastMove: now, position: currentPath[pathIndex] || e.position } : e);
                      break;
                  case DeltaType.ENEMY_PATH_UPDATE:
                       const [enemyId, newPath, newPathIndex] = delta.slice(1);
                       newEnemies = newEnemies.map(e => e.id === enemyId ? { ...e, path: newPath, pathIndex: newPathIndex } : e);
                       break;
                  case DeltaType.ENEMY_DAMAGE:
                      const [dmgId, damage] = delta.slice(1);
                      newEnemies = newEnemies.map(e => e.id === dmgId ? { ...e, health: e.health - (damage as number), wasHit: true } : e);
                      setTimeout(() => setEnemies(prev => prev.map(e => e.id === dmgId ? { ...e, wasHit: false } : e)), 150);
                      break;
                  case DeltaType.ENEMY_DIE:
                      newEnemies = newEnemies.filter(e => e.id !== payload);
                      break;
                  case DeltaType.ENEMY_REACH_END:
                      newEnemies = newEnemies.filter(e => e.id !== payload);
                      setGameState(s => ({ ...s, lives: Math.max(0, s.lives - 1) }));
                      break;
                  case DeltaType.ENEMY_ADD_EFFECT:
                      const [effectId, effect] = delta.slice(1) as [string, EnemyStatusEffect];
                      newEnemies = newEnemies.map(e => {
                          if (e.id === effectId) {
                              const newEffects = e.effects.filter(ef => ef.type !== effect.type);
                              newEffects.push(effect);
                              return { ...e, effects: newEffects };
                          }
                          return e;
                      });
                      break;
                  case DeltaType.ENEMY_REMOVE_EFFECT:
                      const [removeId, effectType] = delta.slice(1);
                      newEnemies = newEnemies.map(e => e.id === removeId ? { ...e, effects: e.effects.filter(ef => ef.type !== effectType) } : e);
                      break;
                  case DeltaType.TOWER_ATTACK:
                      setAttacks(prev => [...prev.slice(-200), payload]);
                      audioManager.playSfx('shoot', 0.3);
                      setFiringTowerIds(prev => new Set(prev).add((payload as Attack).towerId));
                      setTimeout(() => setFiringTowerIds(prev => {
                          const s = new Set(prev); s.delete((payload as Attack).towerId); return s;
                      }), 150);
                      break;
                  case DeltaType.VFX_DAMAGE_NUMBER:
                      setDamageNumbers(prev => [...prev.slice(-100), payload]);
                      break;
                  case DeltaType.VFX_SPLASH:
                      setSplashRings(prev => [...prev.slice(-50), payload]);
                      break;
                  case DeltaType.TOWER_UPGRADE_VFX:
                      const { towerId } = payload as { towerId: string; position: Node };
                      setLastUpgradedTowerId(towerId);
                      setTimeout(() => setLastUpgradedTowerId(null), 1000);
                      break;
                  case DeltaType.GAME_STATE_UPDATE:
                      stateUpdate = { ...(stateUpdate || {}), ...payload };
                      break;
                  case DeltaType.PLAYER_UPDATE:
                      playerUpdates = { ...(playerUpdates || {}), ...payload };
                      break;
                  case DeltaType.TOWERS_UPDATE:
                      newTowers = payload;
                      break;
              }
          });

          if (stateUpdate) {
              if (stateUpdate.gameStatus) setGameStatus(stateUpdate.gameStatus);
              if (stateUpdate.currentWave !== undefined) setCurrentWave(stateUpdate.currentWave);
              if (stateUpdate.isIntermission !== undefined) setIsIntermission(stateUpdate.isIntermission);
              if (stateUpdate.waveStartCountdown !== undefined) setWaveStartCountdown(stateUpdate.waveStartCountdown);
              if (stateUpdate.lives !== undefined) setGameState(s => ({ ...s, lives: stateUpdate!.lives! }));
              if (stateUpdate.spawnedThisWave !== undefined) setSpawnedThisWave(stateUpdate.spawnedThisWave);
          }
          if (playerUpdates) {
              setPlayers(prev => prev.map(p => playerUpdates![p.id] ? { ...p, ...playerUpdates![p.id] } : p));
          }
          if (newTowers) {
              setTowersByCell(newTowers);
          }
          
          return newEnemies;
      });
  }, [currentPath]);

    const broadcastGameData = useCallback((deltas: GameDelta[]) => {
      if(deltas.length === 0) return;
      applyDeltas(deltas);
    }, [applyDeltas]);


    const saveGameState = useCallback(() => {
        if (gameStatus === 'gameover' || isCheating) return;
        const stateToSave: GameSaveState = {
            players: { player1: players[0], player2: null },
            gameState, towersByCell, enemies: [], currentWave, difficulty
        };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stateToSave));
        toast({ title: 'Spiel gespeichert!' });
    }, [gameStatus, players, gameState, towersByCell, currentWave, difficulty, toast, isCheating]);
    
    const handleGameEnd = useCallback(async (result: GameResult) => {
        if (gameStatus !== 'gameover') {
            setGameStatus('gameover');
            if (!isCheating) saveGameState();
            if (user && !isCheating) {
                try {
                    const docData = { ...result, date: serverTimestamp() };
                    await addDoc(collection(db, "scores"), docData);
                    localStorage.removeItem(LOCAL_STORAGE_KEY);
                    setFinalGameResult({ ...result, date: new Date().toISOString() });
                } catch(e) {
                    console.error("Failed to save score", e);
                    setFinalGameResult(result);
                }
            } else {
                setFinalGameResult(result);
            }
        }
    }, [gameStatus, saveGameState, user, isCheating, difficulty]);

    useEffect(() => {
        if (initialSavedGame && !isCheating) {
            setPlayers(normalizePlayers(initialSavedGame.players));
            setGameState(initialSavedGame.gameState);
            setTowersByCell(initialSavedGame.towersByCell);
            setCurrentWave(initialSavedGame.currentWave);
            setDifficulty(initialSavedGame.difficulty);
        } else {
            const difficultyMod = difficultyModifiers[difficulty];
            const startLives = isCheating ? 999 : difficultyMod.startLives;
            const startRes = isCheating ? 99999 : difficultyMod.startResources;
            const startElements = isCheating ? ['neutral', ...ALL_PICKABLE_ELEMENTS] as Element[] : ['neutral'] as Element[];

            const player1: Player = { id: 'player1', name: isCheating ? 'Chaos-Meister' : (user?.displayName || 'Spieler 1'), resources: startRes, unlockedElements: startElements, avatarUrl: user?.photoURL || null };
            setPlayers([player1]);
            setGameState({ lives: startLives });
        }
        setIsIntermission(true);
        setGameStatus('playing');
        setWaveStartCountdown(INTERMISSION_TIME);
        setEnemies([]);
    }, [initialSavedGame, isCheating, startWithTutorial, initialDifficulty, user, difficulty]);


    const handlePlaceTower = useCallback((row: number, col: number) => {
        const player = players[0];
        if (!player || !selectedTowerToBuild) return;

        const cellKey = `${row}_${col}`;
        const existingTower = towersByCell[cellKey];
        if (existingTower) {
            setFocusedTower(existingTower);
            setSelectedTowerToBuild(null);
            return;
        }

        const currentPlacedTowers = Object.values(towersByCell).map(t => t.position);
        const newPath = findPath(START_NODE, END_NODE, [...currentPlacedTowers, { row, col }], GRID_ROWS, GRID_COLS);
        if (!newPath) {
            toast({ title: "Bau fehlgeschlagen", description: "Der Weg für die Gegner darf nicht blockiert werden.", variant: 'destructive' });
            return;
        }

        if (player.resources < selectedTowerToBuild.cost) {
            toast({ title: "Bau fehlgeschlagen", description: "Nicht genügend Ressourcen.", variant: 'destructive' });
            return;
        }

        const newTower: PlacedTower = {
            ...selectedTowerToBuild,
            id: `tower-${row}-${col}-${Date.now()}`,
            specId: selectedTowerToBuild.id,
            position: { row, col },
            lastAttack: 0,
            health: selectedTowerToBuild.maxHealth,
            ownerId: player.id,
        };

        const newTowersByCell = { ...towersByCell, [cellKey]: newTower };
        const playerUpdates = { [player.id]: { resources: player.resources - newTower.cost } };
        
        broadcastGameData([
            [DeltaType.TOWERS_UPDATE, newTowersByCell],
            [DeltaType.PLAYER_UPDATE, playerUpdates]
        ]);
        
        setSelectedTowerToBuild(null);
        audioManager.playSfx('build_tower');
    }, [players, selectedTowerToBuild, towersByCell, toast, broadcastGameData]);
    
    const handleUpgradeTower = useCallback((upgradeId: string) => {
        const player = players[0];
        if (!player || !focusedTower) return;
    
        const upgradeTowerSpec = initialTowers.find(t => t.id === upgradeId);
        if (!upgradeTowerSpec) {
            toast({ title: "Upgrade-Fehler", variant: 'destructive' });
            return;
        }
    
        const refundPercentage = difficulty === 'Einfach' ? 1.0 : 0.75;
        const cost = Math.max(0, upgradeTowerSpec.cost - Math.floor(focusedTower.cost * refundPercentage));
    
        if (player.resources < cost) {
            toast({ title: "Upgrade fehlgeschlagen", description: "Nicht genügend Ressourcen.", variant: 'destructive' });
            return;
        }
    
        const cellKey = `${focusedTower.position.row}_${focusedTower.position.col}`;
        const newTowersByCell = { ...towersByCell };
        
        const upgradedTower: PlacedTower = {
          ...newTowersByCell[cellKey],
          specId: upgradeTowerSpec.id, name: upgradeTowerSpec.name, damage: upgradeTowerSpec.damage,
          range: upgradeTowerSpec.range, attackSpeed: upgradeTowerSpec.attackSpeed, maxHealth: upgradeTowerSpec.maxHealth,
          health: upgradeTowerSpec.maxHealth, elements: upgradeTowerSpec.elements, effect: upgradeTowerSpec.effect,
          cost: upgradeTowerSpec.cost, tier: upgradeTowerSpec.tier, upgradesTo: upgradeTowerSpec.upgradesTo,
          isBase: upgradeTowerSpec.isBase,
        };
        newTowersByCell[cellKey] = upgradedTower;
    
        const playerUpdates = { [player.id]: { resources: player.resources - cost } };
        
        broadcastGameData([
          [DeltaType.PLAYER_UPDATE, playerUpdates],
          [DeltaType.TOWERS_UPDATE, newTowersByCell],
          [DeltaType.TOWER_UPGRADE_VFX, { towerId: upgradedTower.id, position: upgradedTower.position }]
        ]);
    
        setFocusedTower(null);
        audioManager.playSfx('build_tower');
    
    }, [players, focusedTower, difficulty, toast, towersByCell, broadcastGameData]);
    
    const handleSellTower = useCallback(() => {
        const player = players[0];
        if (!player || !focusedTower) return;
    
        const refundPercentage = difficulty === 'Einfach' ? 1.0 : 0.75;
        const refund = Math.round(focusedTower.cost * refundPercentage);
        const cellKey = `${focusedTower.position.row}_${focusedTower.position.col}`;
    
        const newTowersByCell = { ...towersByCell };
        delete newTowersByCell[cellKey];
    
        const playerUpdates = { [player.id]: { resources: player.resources + refund } };
    
        broadcastGameData([
            [DeltaType.TOWERS_UPDATE, newTowersByCell],
            [DeltaType.PLAYER_UPDATE, playerUpdates]
        ]);
    
        setFocusedTower(null);
        audioManager.playSfx('build_tower');
    }, [players, focusedTower, difficulty, broadcastGameData, towersByCell]);
    
    const handleGameControl = useCallback(() => {
        if (gameStatus === 'playing') setGameStatus('paused');
        else if (gameStatus === 'paused') setGameStatus('playing');
    }, [gameStatus]);

    const handleStartNextWaveNow = useCallback(() => {
        if (isIntermission && gameStatus === 'playing') {
            broadcastGameData([[DeltaType.GAME_STATE_UPDATE, { isIntermission: false, waveStartCountdown: 0 }]]);
        }
    }, [isIntermission, gameStatus, broadcastGameData]);

    const startWave = useCallback(() => {
        if (currentWave >= waves.length || waveInProgressRef.current) return;
        
        waveInProgressRef.current = true;
        if (spawnerRef.current) clearTimeout(spawnerRef.current);
        spawnerRef.current = undefined;

        broadcastGameData([[DeltaType.GAME_STATE_UPDATE, { spawnedThisWave: 0 }]]);
        audioManager.playWaveMusic();
      
        const waveData = waves[currentWave];
        let spawnedCount = 0;
      
        const spawnEnemy = () => {
          if (gameStatus !== 'playing' || isIntermission) {
            waveInProgressRef.current = false;
            return;
          }
          if (spawnedCount >= waveData.enemies.count) {
            return; // Wave fully spawned
          }
      
          const difficultyMod = difficultyModifiers[difficulty];
          const health = isCheating ? waveData.enemies.health : Math.round(waveData.enemies.health * difficultyMod.enemyHealth);
          let movementPattern: MovementPattern = waveData.enemies.type === 'schnell' ? 'zigzag' : ((waveData.enemies.type === 'gepanzert' || waveData.enemies.type === 'boss') ? 'straight' : 'wobble');

          const newEnemy: Enemy = {
            id: `enemy-${enemyIdCounter.current++}`, ...waveData.enemies, health, maxHealth: health,
            path: [], pathIndex: 0, position: START_NODE, isBlocked: false, effects: [],
            lastMove: performance.now(), wasHit: false, targetNode: END_NODE, movementPattern
          };
          
          broadcastGameData([[DeltaType.ENEMY_SPAWN, newEnemy]]);
          
          spawnedCount++;
          broadcastGameData([[DeltaType.GAME_STATE_UPDATE, { spawnedThisWave: spawnedCount }]]);
          spawnerRef.current = setTimeout(spawnEnemy, waveData.enemies.spawnDelay);
        };
        spawnEnemy();
    }, [currentWave, gameStatus, isIntermission, difficulty, broadcastGameData, isCheating]);

    // Main Game Loop
    useEffect(() => {
      let isTabVisible = true;
      const handleVisibilityChange = () => { isTabVisible = document.visibilityState === 'visible'; };
      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener('beforeunload', saveGameState);

      const simulate = (now: number) => {
        if (gameStatus !== 'playing' || !isTabVisible) return;
        
        if (!isIntermission && !waveInProgressRef.current) {
          startWave();
        }

        const deltas: GameDelta[] = [];
        let livesLostThisTick = 0;
        let resourcesGained = 0;

        const currentPlacedTowers = Object.values(towersByCell);

        const updatedEnemies = enemies.map(enemy => {
          if (enemy.health <= 0) {
              deltas.push([DeltaType.ENEMY_DIE, enemy.id]);
              resourcesGained += enemy.bounty;
              return null;
          }

          let activeEffects = enemy.effects.filter(e => e.expires > now);
          if (activeEffects.length < enemy.effects.length) {
              enemy.effects.filter(e => e.expires <= now).forEach(e => deltas.push([DeltaType.ENEMY_REMOVE_EFFECT, enemy.id, e.type]));
          }
          let isStunned = activeEffects.some(e => e.type === 'stun');
          
          let newWasHit = enemy.wasHit;
          if(enemy.wasHit && now - enemy.lastMove > 150) newWasHit = false;

          let newPathIndex = enemy.pathIndex;
          let newLastMove = enemy.lastMove;

          if (!isStunned) {
              const slowEffect = activeEffects.find(e => e.type === 'slow');
              const effectiveSpeed = enemy.speed * (slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1);
              if (now - enemy.lastMove > 1000 / effectiveSpeed) {
                  if (enemy.pathIndex < currentPath.length - 1) {
                      newPathIndex++; newLastMove = now;
                      deltas.push([DeltaType.ENEMY_MOVE, enemy.id, newPathIndex, now]);
                  } else {
                      livesLostThisTick++;
                      deltas.push([DeltaType.ENEMY_REACH_END, enemy.id]);
                      return null;
                  }
              }
          }
          return { ...enemy, pathIndex: newPathIndex, lastMove: newLastMove, effects: activeEffects, wasHit: newWasHit };
        }).filter(Boolean) as Enemy[];

        currentPlacedTowers.forEach(tower => {
            if (now - (towersByCell[tower.position.row + '_' + tower.position.col]?.lastAttack || 0) <= tower.attackSpeed) return;
            const enemiesInRange = updatedEnemies.filter(e => Math.hypot(e.position.row - tower.position.row, e.position.col - tower.position.col) <= tower.range);
            if (enemiesInRange.length > 0) {
                const mainTarget = enemiesInRange[0];
                const projectileType = tower.specId.includes('-1a') || tower.specId.includes('-2a') ? 'arrow' : 'beam';
                deltas.push([DeltaType.TOWER_ATTACK, { id: `attack-${now}-${Math.random()}`, towerId: tower.id, targetId: mainTarget.id, elements: tower.elements, projectile: projectileType }]);
                towersByCell[tower.position.row + '_' + tower.position.col].lastAttack = now;

                let damage = tower.damage; let isCrit = false;
                if (tower.effect?.type === 'crit' && Math.random() < (tower.effect.chance ?? 0)) { damage *= (tower.effect.potency ?? 1); isCrit = true; }
                deltas.push([DeltaType.ENEMY_DAMAGE, mainTarget.id, damage]);
                deltas.push([DeltaType.VFX_DAMAGE_NUMBER, { id: `dn-${now}-${Math.random()}`, amount: damage, position: mainTarget.position, color: isCrit ? '#fde047' : '#ffffff', isCrit }]);
            }
        });
        
        if (livesLostThisTick > 0) {
          if (gameState.lives - livesLostThisTick <= 0) {
            handleGameEnd({ playerName: players[0].name, playerUid: user?.uid || 'local', date: new Date().toISOString(), difficulty, wave: currentWave, won: false, finalTowers: towersByCell });
          }
        }
        if (resourcesGained > 0) deltas.push([DeltaType.PLAYER_UPDATE, { player1: { resources: players[0].resources + resourcesGained } }]);

        const totalEnemiesInWave = waves[currentWave]?.enemies.count || 0;
        if (!isIntermission && spawnedThisWave >= totalEnemiesInWave && updatedEnemies.length === 0) {
            waveInProgressRef.current = false;
            const nextWave = currentWave + 1;
            if (nextWave >= waves.length) {
                handleGameEnd({ playerName: players[0].name, playerUid: user?.uid || 'local', date: new Date().toISOString(), difficulty, wave: nextWave, won: true, finalTowers: towersByCell });
            } else {
                const canPickElement = nextWave > 0 && nextWave % 5 === 0 && players[0].unlockedElements.length < ALL_PICKABLE_ELEMENTS.length + 1;
                deltas.push([DeltaType.GAME_STATE_UPDATE, { 
                    gameStatus: (canPickElement && !isCheating) ? 'picking-element' : 'playing',
                    currentWave: (canPickElement && !isCheating) ? currentWave : nextWave,
                    isIntermission: true,
                    waveStartCountdown: INTERMISSION_TIME
                }]);
            }
        }

        if(deltas.length > 0) broadcastGameData(deltas);
      };

      const gameTick = (now: number) => {
        const delta = now - lastTickRef.current;
        if (delta >= 1000/60) { //~60fps
            simulate(now);
            lastTickRef.current = now;
        }
        gameLoopRef.current = requestAnimationFrame(gameTick);
      };
      
      gameLoopRef.current = requestAnimationFrame(gameTick);
      return () => {
          document.removeEventListener("visibilitychange", handleVisibilityChange);
          window.removeEventListener('beforeunload', saveGameState);
          if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
          if (spawnerRef.current) clearTimeout(spawnerRef.current);
      };
    }, [gameStatus, isIntermission, currentPath, broadcastGameData, handleGameEnd, saveGameState, towersByCell, enemies, players, currentWave, difficulty, isCheating, user, gameState.lives, spawnedThisWave, startWave]);

    // Countdown timer effect
    useEffect(() => {
        if (isIntermission && gameStatus === 'playing') {
            const countdownInterval = setInterval(() => {
                setWaveStartCountdown(prev => {
                    if (prev <= 1) {
                        clearInterval(countdownInterval);
                        broadcastGameData([[DeltaType.GAME_STATE_UPDATE, { isIntermission: false, waveStartCountdown: 0 }]]);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
            return () => clearInterval(countdownInterval);
        }
    }, [isIntermission, gameStatus, broadcastGameData]);


    if (players.length === 0) {
        return <div className="flex items-center justify-center h-full"><Loader2 className="h-16 w-16 animate-spin text-primary" /></div>
    }

    return (
        <GameSession
            players={players} setPlayers={setPlayers}
            gameState={gameState} setGameState={setGameState}
            towersByCell={towersByCell} setTowersByCell={setTowersByCell}
            currentWave={currentWave} setCurrentWave={setCurrentWave}
            gameStatus={gameStatus} setGameStatus={setGameStatus}
            difficulty={difficulty} setDifficulty={setDifficulty}
            isIntermission={isIntermission} setIsIntermission={setIsIntermission}
            waveStartCountdown={waveStartCountdown} setWaveStartCountdown={setWaveStartCountdown}
            currentPath={currentPath}
            enemies={enemies} setEnemies={setEnemies}
            spawnedThisWave={spawnedThisWave} setSpawnedThisWave={setSpawnedThisWave}
            isCoop={false}
            isGameHost={true}
            localPlayerId="player1"
            broadcastGameData={broadcastGameData}
            applyDeltas={applyDeltas}
            onGameEnd={handleGameEnd}
            onExit={() => { saveGameState(); onExit(); }}
            attacks={attacks}
            damageNumbers={damageNumbers}
            splashRings={splashRings}
            lastUpgradedTowerId={lastUpgradedTowerId}
            setLastUpgradedTowerId={setLastUpgradedTowerId}
            firingTowerIds={firingTowerIds}
            setFiringTowerIds={setFiringTowerIds}
            isCheating={isCheating}
            fps={fps} setFps={setFps}
            finalGameResult={finalGameResult}
            handleUpgradeTower={handleUpgradeTower}
            handleSellTower={handleSellTower}
            handleSelectTowerToBuild={setSelectedTowerToBuild}
            selectedTowerToBuild={selectedTowerToBuild}
            focusedTower={focusedTower}
            setFocusedTower={setFocusedTower}
            onFocusTower={setFocusedTower}
            handleGameControl={handleGameControl}
            handleStartNextWaveNow={handleStartNextWaveNow}
            handlePlaceTower={handlePlaceTower}
            allTowers={initialTowers}
            cancelInteractions={() => {
                setSelectedTowerToBuild(null);
                setFocusedTower(null);
            }}
        />
    )
}
