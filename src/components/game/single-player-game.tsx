

"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import GameSession from './game-session';
import type { Tower, PlacedTower, Enemy, Node, Element, Difficulty, Attack, DamageNumber, SplashRing, TowerEffect, GameSaveState, GameResult, GameResultWithId, GameDelta, MovementPattern, EnemyStatusEffect } from '@/lib/game-data/types';
import { useToast } from '@/hooks/use-toast';
import { difficultyModifiers, ALL_PICKABLE_ELEMENTS, INTERMISSION_TIME, GRID_ROWS, GRID_COLS, LOCAL_STORAGE_KEY, elementProjectileColors } from '@/lib/game-data/constants';
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

const TUTORIAL_COMPLETED_KEY = 'nexus-tutorial-completed';

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

    // All game state is now managed directly in this component
    const [players, setPlayers] = useState<Player[]>([]);
    const [gameState, setGameState] = useState<GameState>({ lives: 20 });
    const [towersByCell, setTowersByCell] = useState<Record<string, PlacedTower>>({});
    const [enemies, setEnemies] = useState<Enemy[]>([]);
    const [currentWave, setCurrentWave] = useState(0);
    const [gameStatus, setGameStatus] = useState<GameStatus>('playing');
    const [difficulty, setDifficulty] = useState<Difficulty>(initialDifficulty);
    const [isIntermission, setIsIntermission] = useState(true);
    const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);
    const [spawnedThisWave, setSpawnedThisWave] = useState(0);
    const [fps, setFps] = useState(0);
    
    // VFX State
    const [attacks, setAttacks] = useState<Attack[]>([]);
    const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
    const [splashRings, setSplashRings] = useState<SplashRing[]>([]);
    const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string|null>(null);
    const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());

    // Local UI State
    const [finalGameResult, setFinalGameResult] = useState<GameResult | null>(null);
    const [selectedTowerToBuild, setSelectedTowerToBuild] = useState<Tower | null>(null);
    const [focusedTower, setFocusedTower] = useState<PlacedTower | null>(null);
    const [totalKilled, setTotalKilled] = useState(0);
    const [totalLeaked, setTotalLeaked] = useState(0);
    
    const gameLoopRef = useRef<number>();
    const lastRafTimeRef = useRef(performance.now());
    
    const frameCountRef = useRef(0);
    const lastFpsUpdateTimeRef = useRef(performance.now());
    
    const spawnerRef = useRef<NodeJS.Timeout>();
    const waveInProgressRef = useRef(false);
    
    const START_NODE = { row: 1, col: 1 };
    const END_NODE = { row: GRID_ROWS, col: GRID_COLS };
  
    const currentPath = useMemo(() => {
      const blockedPositions = Object.values(towersByCell).map(t => t.position);
      return findPath(START_NODE, END_NODE, blockedPositions, GRID_ROWS, GRID_COLS) || [];
    }, [towersByCell]);

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

    // Initialize game state from save or new
    useEffect(() => {
        if (initialSavedGame && !isCheating) {
            const now = performance.now();
            const rehydratedTowers = Object.values(initialSavedGame.towersByCell || {}).reduce((acc, savedTower) => {
                const towerSpec = initialTowers.find(t => t.id === savedTower.specId);
                if (towerSpec) {
                    acc[`${savedTower.position.row}_${savedTower.position.col}`] = { ...towerSpec, ...savedTower, id: savedTower.id, lastAttack: now, isBase: savedTower.isBase };
                }
                return acc;
            }, {} as Record<string, PlacedTower>);
            
            setPlayers(normalizePlayers(initialSavedGame.players));
            setGameState(initialSavedGame.gameState);
            setTowersByCell(rehydratedTowers);
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
            setTowersByCell({});
            setCurrentWave(0);
            setDifficulty(initialDifficulty);
        }
        setIsIntermission(true);
        setGameStatus('playing');
        setWaveStartCountdown(INTERMISSION_TIME);
        setEnemies([]);
    }, [initialSavedGame, isCheating, startWithTutorial, initialDifficulty, user]);


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

        setTowersByCell(prev => ({...prev, [cellKey]: newTower }));
        setPlayers(prev => [{ ...prev[0], resources: prev[0].resources - newTower.cost }]);
        setSelectedTowerToBuild(null);
        audioManager.playSfx('build_tower');
    }, [players, selectedTowerToBuild, towersByCell, toast]);
    
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
        
        setTowersByCell(prevTowers => {
            const newTowers = { ...prevTowers };
            const upgradedTower: PlacedTower = {
                ...newTowers[cellKey],
                specId: upgradeTowerSpec.id,
                name: upgradeTowerSpec.name,
                damage: upgradeTowerSpec.damage,
                range: upgradeTowerSpec.range,
                attackSpeed: upgradeTowerSpec.attackSpeed,
                maxHealth: upgradeTowerSpec.maxHealth,
                health: upgradeTowerSpec.maxHealth,
                elements: upgradeTowerSpec.elements,
                effect: upgradeTowerSpec.effect,
                cost: upgradeTowerSpec.cost,
                tier: upgradeTowerSpec.tier,
                upgradesTo: upgradeTowerSpec.upgradesTo,
                isBase: upgradeTowerSpec.isBase,
            };
            newTowers[cellKey] = upgradedTower;
            setLastUpgradedTowerId(upgradedTower.id);
            setTimeout(() => setLastUpgradedTowerId(null), 1000);
            return newTowers;
        });

        setPlayers(prev => [{ ...prev[0], resources: prev[0].resources - cost }]);
        setFocusedTower(null);
        audioManager.playSfx('build_tower');
    
    }, [players, focusedTower, difficulty, toast]);
    
    const handleSellTower = useCallback(() => {
        const player = players[0];
        if (!player || !focusedTower) return;
    
        const refundPercentage = difficulty === 'Einfach' ? 1.0 : 0.75;
        const refund = Math.round(focusedTower.cost * refundPercentage);
        const cellKey = `${focusedTower.position.row}_${focusedTower.position.col}`;
    
        setTowersByCell(prev => {
            const newTowers = { ...prev };
            delete newTowers[cellKey];
            return newTowers;
        });
        setPlayers(prev => [{ ...prev[0], resources: prev[0].resources + refund }]);
        setFocusedTower(null);
        audioManager.playSfx('build_tower');
    }, [players, focusedTower, difficulty]);
    

    const handleGameControl = useCallback(() => {
        if (gameStatus === 'playing') {
            setGameStatus('paused');
        } else if (gameStatus === 'paused') {
            setGameStatus('playing');
        }
    }, [gameStatus]);

    const handleStartNextWaveNow = useCallback(() => {
        if (isIntermission && gameStatus === 'playing') {
            setIsIntermission(false);
            setWaveStartCountdown(0);
        }
    }, [isIntermission, gameStatus]);
    
    // Main Game Loop Effect
    useEffect(() => {
        let isTabVisible = true;
        let countdownInterval: ReturnType<typeof setInterval> | undefined;

        let enemyIdCounter = 0;
        
        const startWave = () => {
            if (currentWave >= waves.length || waveInProgressRef.current) return;
            waveInProgressRef.current = true;
            if (spawnerRef.current) clearTimeout(spawnerRef.current);
            audioManager.playWaveMusic();
            const waveData = waves[currentWave];
            let spawnedCount = 0;
            
            const spawnEnemy = () => {
                if (gameStatus !== 'playing' || isIntermission || !isTabVisible) {
                    waveInProgressRef.current = false;
                    return;
                }
                if (spawnedCount >= waveData.enemies.count) {
                    return; // All enemies for this wave spawned
                }
                
                const difficultyMod = difficultyModifiers[difficulty];
                const health = isCheating ? waveData.enemies.health : Math.round(waveData.enemies.health * difficultyMod.enemyHealth);
                const movementPattern: MovementPattern = waveData.enemies.type === 'schnell' ? 'zigzag' : (waveData.enemies.type === 'gepanzert' || waveData.enemies.type === 'boss') ? 'straight' : 'wobble';
                
                const newEnemy: Enemy = {
                    id: `enemy-${enemyIdCounter++}`, ...waveData.enemies, health, maxHealth: health,
                    path: currentPath, pathIndex: 0, position: START_NODE, isBlocked: false, effects: [],
                    lastMove: performance.now(), wasHit: false, targetNode: END_NODE, movementPattern
                };
                
                setEnemies(prev => [...prev, newEnemy]);
                spawnedCount++;
                setSpawnedThisWave(spawnedCount);
                
                if (spawnedCount < waveData.enemies.count) {
                    spawnerRef.current = setTimeout(spawnEnemy, waveData.enemies.spawnDelay);
                }
            };
            spawnEnemy();
        };

        const simulate = (now: number) => {
            
            let livesLost = 0;
            const deadEnemyIds = new Set<string>();
            let resourcesGained = 0;
            
            const newAttacks: Attack[] = [];
            const newDamageNumbers: DamageNumber[] = [];

            setEnemies(currentEnemies => {
                const updatedEnemies = currentEnemies.map(enemy => {
                    if (enemy.health <= 0) {
                        deadEnemyIds.add(enemy.id);
                        resourcesGained += enemy.bounty;
                        return null;
                    }
    
                    let activeEffects = enemy.effects.filter(e => e.expires > now);
                    let isStunned = activeEffects.some(e => e.type === 'stun');
                    
                    let newWasHit = enemy.wasHit;
                    if (enemy.wasHit && now - enemy.lastMove > 150) {
                        newWasHit = false;
                    }

                    let newPosition = enemy.position;
                    let newPathIndex = enemy.pathIndex;
                    let newLastMove = enemy.lastMove;
                    
                    if (!isStunned) {
                        const slowEffect = activeEffects.find(e => e.type === 'slow');
                        const effectiveSpeed = enemy.speed * (slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1);
        
                        if (now - enemy.lastMove > 1000 / effectiveSpeed) {
                            if (enemy.pathIndex < currentPath.length - 1) {
                                newPathIndex++;
                                newPosition = currentPath[newPathIndex];
                                newLastMove = now;
                            } else {
                                livesLost++;
                                deadEnemyIds.add(enemy.id);
                                return null;
                            }
                        }
                    }
                    return { ...enemy, pathIndex: newPathIndex, position: newPosition, effects: activeEffects, lastMove: newLastMove, path: currentPath, wasHit: newWasHit };
                }).filter(e => e !== null) as Enemy[];

                // Tower attacks
                const placedTowers = Object.values(towersByCell);
                placedTowers.forEach(tower => {
                    if (now - (tower.lastAttack || 0) <= tower.attackSpeed) return;
                    
                    const enemiesInRange = updatedEnemies.filter(enemy => {
                        const dx = enemy.position.row - tower.position.row;
                        const dy = enemy.position.col - tower.position.col;
                        return (dx * dx + dy * dy) <= (tower.range * tower.range);
                    });
    
                    if (enemiesInRange.length > 0) {
                        const mainTarget = enemiesInRange[0];
                        const projectileType = tower.specId.includes('-1a') || tower.specId.includes('-2a') ? 'arrow' : 'beam';
                        newAttacks.push({ id: `attack-${now}-${Math.random()}`, towerId: tower.id, targetId: mainTarget.id, elements: tower.elements, projectile: projectileType });
    
                        setTowersByCell(prev => {
                            const newTowers = {...prev};
                            const key = `${tower.position.row}_${tower.position.col}`;
                            if(newTowers[key]) newTowers[key].lastAttack = now;
                            return newTowers;
                        });
                        
                        setFiringTowerIds(prev => new Set(prev).add(tower.id));
                        setTimeout(() => setFiringTowerIds(prev => { const s = new Set(prev); s.delete(tower.id); return s; }), 150);
    
                        let damage = tower.damage;
                        let isCrit = false;
                        if (tower.effect?.type === 'crit' && Math.random() < (tower.effect.chance ?? 0)) {
                            damage *= (tower.effect.potency ?? 1); isCrit = true;
                        }
    
                        const targetIndex = updatedEnemies.findIndex(e => e.id === mainTarget.id);
                        if (targetIndex > -1) {
                          updatedEnemies[targetIndex].health -= damage;
                          updatedEnemies[targetIndex].wasHit = true;
                          newDamageNumbers.push({ id: `dn-${now}-${Math.random()}`, amount: damage, position: mainTarget.position, color: isCrit ? '#fde047' : '#ffffff', isCrit });
                        }
                    }
                });
                
                setTotalKilled(k => k + deadEnemyIds.size - livesLost);
                setTotalLeaked(l => l + livesLost);
                if (resourcesGained > 0) setPlayers(prev => [{ ...prev[0], resources: prev[0].resources + resourcesGained }]);
                if (newAttacks.length > 0) setAttacks(prev => [...prev.slice(-200), ...newAttacks]);
                if (newDamageNumbers.length > 0) setDamageNumbers(prev => [...prev.slice(-100), ...newDamageNumbers]);
                if (livesLost > 0) {
                  setGameState(prev => {
                    const newLives = Math.max(0, prev.lives - livesLost);
                    if (newLives <= 0) {
                      handleGameEnd({ playerName: players[0].name, playerUid: user?.uid || 'local', date: new Date().toISOString(), difficulty, wave: currentWave, won: false, finalTowers: towersByCell });
                    }
                    return {...prev, lives: newLives };
                  });
                }
                
                // Check for wave end
                const totalEnemiesInWave = waves[currentWave]?.enemies.count || 0;
                if (!isIntermission && spawnedThisWave >= totalEnemiesInWave && updatedEnemies.length === 0) {
                    waveInProgressRef.current = false;
                    const nextWave = currentWave + 1;
                    if (nextWave >= waves.length) {
                        handleGameEnd({ playerName: players[0].name, playerUid: user?.uid || 'local', date: new Date().toISOString(), difficulty, wave: nextWave, won: true, finalTowers: towersByCell });
                    } else {
                        const canPickElement = nextWave > 0 && nextWave % 5 === 0 && players[0].unlockedElements.length < ALL_PICKABLE_ELEMENTS.length + 1;
                        if (canPickElement && !isCheating) {
                            setGameStatus('picking-element');
                        } else {
                            setCurrentWave(nextWave);
                            setIsIntermission(true);
                            setWaveStartCountdown(INTERMISSION_TIME);
                        }
                    }
                }

                return updatedEnemies;
            });
        };

        const rafLoop = (now: number) => {
            gameLoopRef.current = requestAnimationFrame(rafLoop);
            if (!isTabVisible || gameStatus !== 'playing') return;

            const frameTime = now - lastRafTimeRef.current;
            lastRafTimeRef.current = now;
            
            simulate(now);
            
            frameCountRef.current++;
            if (now - lastFpsUpdateTimeRef.current >= 1000) {
                setFps(frameCountRef.current);
                frameCountRef.current = 0;
                lastFpsUpdateTimeRef.current = now;
            }
        };

        const handleVisibilityChange = () => { isTabVisible = document.visibilityState === 'visible'; };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener('beforeunload', saveGameState);

        if (gameStatus === 'playing') {
            if (isIntermission) {
                countdownInterval = setInterval(() => {
                    setWaveStartCountdown(prev => {
                        if (prev <= 1) {
                            clearInterval(countdownInterval!);
                            setIsIntermission(false);
                            return 0;
                        }
                        return prev - 1;
                    });
                }, 1000);
            } else if (!waveInProgressRef.current) {
                startWave();
            }
        }
        
        lastRafTimeRef.current = performance.now();
        gameLoopRef.current = requestAnimationFrame(rafLoop);

        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener('beforeunload', saveGameState);
            if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
            if (countdownInterval) clearInterval(countdownInterval);
            if (spawnerRef.current) clearTimeout(spawnerRef.current);
        }
    }, [gameStatus, isIntermission, currentPath, currentWave, difficulty, handleGameEnd, isCheating, players, saveGameState, user, towersByCell, spawnedThisWave]);

    if (players.length === 0) {
        return (
             <div className="flex flex-col items-center justify-center min-h-screen">
                <Loader2 className="h-16 w-16 animate-spin text-primary" />
                <p className="ml-4 text-lg">Initialisiere Einzelspieler-Spiel...</p>
            </div>
        )
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
            broadcastGameData={() => {}}
            applyDeltas={() => {}}
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
            totalKilled={totalKilled}
            totalLeaked={totalLeaked}
        />
    )
}
