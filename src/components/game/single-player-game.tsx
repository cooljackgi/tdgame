
"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import GameSession from './game-session';
import type { Tower, PlacedTower, Enemy, Node, Element, Difficulty, Attack, DamageNumber, SplashRing, GameSaveState, GameResult, GameResultWithId, EnemyStatusEffect, MovementPattern } from '@/lib/game-data/types';
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


export default function SinglePlayerGame({
    difficulty: initialDifficulty,
    onExit,
    initialSavedGame,
    isCheating = false,
    startWithTutorial = false,
    user
}: {
    difficulty: Difficulty,
    onExit: () => void,
    initialSavedGame: GameSaveState | null,
    isCheating?: boolean,
    startWithTutorial?: boolean,
    user: User | null
}) {
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
    
    // --- UI & Local State ---
    const [selectedTowerToBuild, setSelectedTowerToBuild] = useState<Tower | null>(null);
    const [focusedTower, setFocusedTower] = useState<PlacedTower | null>(null);
    const [spawnedThisWave, setSpawnedThisWave] = useState(0);
    const [fps, setFps] = useState(0);
    
    // --- Stats ---
    const [totalKilled, setTotalKilled] = useState(0);
    const [totalLeaked, setTotalLeaked] = useState(0);


    // --- VFX State ---
    const [attacks, setAttacks] = useState<Attack[]>([]);
    const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
    const [splashRings, setSplashRings] = useState<SplashRing[]>([]);
    const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string|null>(null);
    const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());
    const [finalGameResult, setFinalGameResult] = useState<GameResult | null>(null);
    
    const gameLoopRef = useRef<number>();
    const lastTickRef = useRef(performance.now());
    const enemyIdCounter = useRef(0);
    const spawnerStateRef = useRef<{ count: number; timer: number; waveData: any } | null>(null);


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
            gameState, towersByCell, enemies, currentWave, difficulty
        };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stateToSave));
        toast({ title: 'Spiel gespeichert!' });
    }, [players, gameState, towersByCell, enemies, currentWave, difficulty, toast, isCheating, gameStatus]);
    
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
    }, [saveGameState, user, isCheating, gameStatus]);

    useEffect(() => {
        window.addEventListener('beforeunload', saveGameState);
        if (initialSavedGame && !isCheating) {
            setPlayers(normalizePlayers(initialSavedGame.players));
            setGameState(initialSavedGame.gameState);
            setTowersByCell(initialSavedGame.towersByCell);
            setEnemies(initialSavedGame.enemies);
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

        return () => {
            window.removeEventListener('beforeunload', saveGameState);
        }

    }, [initialSavedGame, isCheating, startWithTutorial, initialDifficulty, user, difficulty, saveGameState]);

    const handlePlaceTower = useCallback((row: number, col: number) => {
        if (!selectedTowerToBuild) {
             const existingTower = Object.values(towersByCell).find(t => t.position.row === row && t.position.col === col);
             if (existingTower) {
                setFocusedTower(existingTower);
             }
            return;
        }
    
        const cellKey = `${row}_${col}`;
        const existingTower = towersByCell[cellKey];
        if (existingTower) {
            setFocusedTower(existingTower);
            return;
        }
    
        const currentPlacedTowers = Object.values(towersByCell).map(t => t.position);
        if (!findPath(START_NODE, END_NODE, [...currentPlacedTowers, {row, col}], GRID_ROWS, GRID_COLS)) {
             toast({ title: "Bau fehlgeschlagen", description: "Der Weg für die Gegner darf nicht blockiert werden.", variant: 'destructive' });
            return;
        }

        setPlayers(prevPlayers => {
            const player = prevPlayers[0];
            if (player.resources < selectedTowerToBuild.cost) {
                toast({ title: "Bau fehlgeschlagen", description: "Nicht genügend Ressourcen.", variant: 'destructive' });
                return prevPlayers;
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
        
            setTowersByCell(prev => ({ ...prev, [cellKey]: newTower }));
            audioManager.playSfx('build_tower');
            
            return prevPlayers.map(p => p.id === player.id ? { ...p, resources: p.resources - newTower.cost } : p);
        });
    }, [selectedTowerToBuild, towersByCell, toast, START_NODE, END_NODE]);
    
    const handleUpgradeTower = useCallback((upgradeId: string) => {
        setPlayers(prevPlayers => {
            const player = prevPlayers[0];
            if (!player || !focusedTower) return prevPlayers;
        
            const upgradeTowerSpec = initialTowers.find(t => t.id === upgradeId);
            if (!upgradeTowerSpec) {
                toast({ title: "Upgrade-Fehler", variant: 'destructive' });
                return prevPlayers;
            }
        
            const refundPercentage = difficulty === 'Einfach' ? 1.0 : 0.75;
            const cost = Math.max(0, upgradeTowerSpec.cost - Math.floor(focusedTower.cost * refundPercentage));
        
            if (player.resources < cost) {
                toast({ title: "Upgrade fehlgeschlagen", description: "Nicht genügend Ressourcen.", variant: 'destructive' });
                return prevPlayers;
            }
        
            const cellKey = `${focusedTower.position.row}_${focusedTower.position.col}`;
            
            const newPlacedTower: PlacedTower = {
                ...focusedTower,
                ...upgradeTowerSpec,
                specId: upgradeTowerSpec.id,
                health: upgradeTowerSpec.maxHealth,
            };
        
            setTowersByCell(prev => ({ ...prev, [cellKey]: newPlacedTower }));
            setLastUpgradedTowerId(newPlacedTower.id);
            setTimeout(() => setLastUpgradedTowerId(null), 1000);
            setFocusedTower(null);
            audioManager.playSfx('build_tower');
            
            return prevPlayers.map(p => p.id === player.id ? { ...p, resources: p.resources - cost } : p);
        });
    }, [focusedTower, difficulty, toast]);
    
    const handleSellTower = useCallback(() => {
        setPlayers(prevPlayers => {
            const player = prevPlayers[0];
            if (!player || !focusedTower) return prevPlayers;
        
            const refundPercentage = difficulty === 'Einfach' ? 1.0 : 0.75;
            const refund = Math.round(focusedTower.cost * refundPercentage);
            const cellKey = `${focusedTower.position.row}_${focusedTower.position.col}`;
        
            setTowersByCell(prev => {
                const newTowers = { ...prev };
                delete newTowers[cellKey];
                return newTowers;
            });
            
            setFocusedTower(null);
            audioManager.playSfx('build_tower');
            return prevPlayers.map(p => p.id === player.id ? { ...p, resources: p.resources + refund } : p);
        });
    }, [focusedTower, difficulty]);
    
    const handleGameControl = useCallback(() => {
        setGameStatus(prev => prev === 'playing' ? 'paused' : 'playing');
    }, []);

    const handleStartNextWaveNow = useCallback(() => {
        if (isIntermission && gameStatus === 'playing') {
            setIsIntermission(false);
            setWaveStartCountdown(0);
        }
    }, [isIntermission, gameStatus]);

    const cancelInteractions = useCallback(() => {
        setSelectedTowerToBuild(null);
        if (focusedTower) {
            setFocusedTower(null);
        }
    }, [focusedTower]);

    const handleSelectTowerToBuild = (tower: Tower | null) => {
        if (tower?.id === selectedTowerToBuild?.id) {
            setSelectedTowerToBuild(null);
            return;
        }
        if (tower && players[0].resources < tower.cost) {
            toast({ title: 'Nicht genügend Ressourcen', variant: 'destructive'});
            return;
        }
        if(tower === null) {
            setSelectedTowerToBuild(null);
            return;
        }
        setSelectedTowerToBuild(tower);
        setFocusedTower(null);
    };

    const handleLoadMazetLayout = useCallback((useAllTowers: boolean = false) => {
        const layout: Node[] = [];
        for (let r = 2; r < GRID_ROWS; r += 2) {
            if (r % 4 === 2) {
                for (let c = 1; c < GRID_COLS; c++) layout.push({ row: r, col: c });
            } else {
                for (let c = 2; c <= GRID_COLS; c++) layout.push({ row: r, col: c });
            }
        }

        let towerSpecsToPlace = useAllTowers ? initialTowers.filter(t => t.tier > 0) : [initialTowers.find(t => t.id === 'neutral-0')!];
        let towerIndex = 0;

        const newTowersByCell = layout.reduce((acc, pos) => {
            let towerSpec = towerSpecsToPlace[towerIndex % towerSpecsToPlace.length];
            if (!towerSpec) towerSpec = initialTowers[0];
            const id = `tower-${pos.row}-${pos.col}-${Date.now()}-${Math.random()}`;
            acc[`${pos.row}_${pos.col}`] = { ...towerSpec, id, specId: towerSpec.id, position: pos, lastAttack: 0, health: towerSpec.maxHealth, ownerId: 'player1' };
            if (useAllTowers) towerIndex++;
            return acc;
        }, {} as Record<string, PlacedTower>);
        
        setTowersByCell(newTowersByCell);
        setPlayers(prev => prev.map(p => ({...p, resources: 50000})));
        toast({ title: "Langes Labyrinth-Layout geladen!"});
    }, [toast]);
    
    const handleElementPick = (element: Element) => {
      setPlayers(prev => prev.map(p => ({ ...p, unlockedElements: [...p.unlockedElements, element] })));
      const nextWave = currentWave + 1;
      setCurrentWave(nextWave);
      setGameStatus('playing');
      setIsIntermission(true);
      setWaveStartCountdown(INTERMISSION_TIME);
    };

    const handleLoadTestLayout = useCallback(() => handleLoadMazetLayout(false), [handleLoadMazetLayout]);
    const handleLoadAllTowersLayout = useCallback(() => handleLoadMazetLayout(true), [handleLoadMazetLayout]);

    useEffect(() => {
        let isTabVisible = true;
        const handleVisibilityChange = () => { isTabVisible = document.visibilityState === 'visible'; };
        document.addEventListener("visibilitychange", handleVisibilityChange);

        let countdownInterval: ReturnType<typeof setInterval>;
        
        countdownInterval = setInterval(() => {
            if (gameStatus !== 'playing' || !isIntermission || !isTabVisible) return;
            setWaveStartCountdown(prev => {
                const newTime = Math.max(0, prev - 1);
                if (newTime <= 0) {
                    setIsIntermission(false);
                }
                return newTime;
            });
        }, 1000);
        
        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            if (countdownInterval) clearInterval(countdownInterval);
        };
    }, [gameStatus, isIntermission]);

    useEffect(() => {
        if (gameState.lives <= 0) {
            handleGameEnd({
                playerName: players[0]?.name || 'Spieler',
                playerUid: user?.uid || 'anonymous',
                date: new Date().toISOString(),
                difficulty, wave: currentWave, won: false,
                finalTowers: towersByCell
            });
        }
    }, [gameState.lives, players, currentWave, difficulty, user, towersByCell, handleGameEnd]);

    useEffect(() => {
        if (gameStatus === 'playing' && !isIntermission) {
            audioManager.playWaveMusic();
        }
    }, [gameStatus, isIntermission]);

    useEffect(() => {
        let isTabVisible = true;
        const handleVisibilityChange = () => { isTabVisible = document.visibilityState === 'visible'; };
        document.addEventListener("visibilitychange", handleVisibilityChange);

        const gameLoop = (now: number) => {
            gameLoopRef.current = requestAnimationFrame(gameLoop);
            
            if (gameStatus !== 'playing' || isIntermission || !isTabVisible) {
                lastTickRef.current = now;
                return;
            }
            
            const delta = now - lastTickRef.current;
            if (delta < 1000 / 65) return;
            lastTickRef.current = now;
            setFps(Math.round(1000 / delta));
        
            // 1. Enemy Spawning
            if (!spawnerStateRef.current) {
                const waveData = waves[currentWave];
                if (waveData) {
                    spawnerStateRef.current = { count: 0, timer: 0, waveData: waveData.enemies };
                    setSpawnedThisWave(0);
                }
            }
            
            if (spawnerStateRef.current && currentPath.length > 0) {
                spawnerStateRef.current.timer += delta;
                if (spawnerStateRef.current.timer >= spawnerStateRef.current.waveData.spawnDelay) {
                    if (spawnerStateRef.current.count < spawnerStateRef.current.waveData.count) {
                        spawnerStateRef.current.timer = 0;
                        const difficultyMod = difficultyModifiers[difficulty];
                        const health = isCheating ? spawnerStateRef.current.waveData.health : Math.round(spawnerStateRef.current.waveData.health * difficultyMod.enemyHealth);
                        const movementPattern: Enemy['movementPattern'] = spawnerStateRef.current.waveData.type === 'schnell' ? 'zigzag' : ((spawnerStateRef.current.waveData.type === 'gepanzert' || spawnerStateRef.current.waveData.type === 'boss') ? 'straight' : 'wobble');
                        
                        const newEnemy: Enemy = {
                            id: `enemy-${enemyIdCounter.current++}`, ...spawnerStateRef.current.waveData, health, maxHealth: health,
                            path: currentPath, pathIndex: 0, position: START_NODE, isBlocked: false, effects: [],
                            lastMove: now, wasHit: false, targetNode: END_NODE, movementPattern
                        };
                        setEnemies(prev => [...prev, newEnemy]);
                        setSpawnedThisWave(prev => prev + 1);
                        spawnerStateRef.current.count++;
                    }
                }
            }

            const newAttacks: Attack[] = [];
            const newDamageNumbers: DamageNumber[] = [];
            const newSplashRings: SplashRing[] = [];
            
            setTowersByCell(currentTowers => {
                const updatedTowers = {...currentTowers};
                Object.values(updatedTowers).forEach(tower => {
                    if (now - tower.lastAttack >= tower.attackSpeed) {
                        const targets = enemies.filter(e => {
                            const towerPos = { x: tower.position.col, y: tower.position.row };
                            const enemyPos = { x: e.position.col, y: e.position.row };
                            const distSq = (towerPos.x - enemyPos.x) ** 2 + (towerPos.y - enemyPos.y) ** 2;
                            return distSq <= tower.range ** 2;
                        });

                        if (targets.length > 0) {
                            const mainTarget = targets.sort((a,b) => b.pathIndex - a.pathIndex)[0];
                            updatedTowers[tower.id] = { ...tower, lastAttack: now };
                            newAttacks.push({
                                id: `attack-${now}-${Math.random()}`,
                                towerId: tower.id,
                                targetId: mainTarget.id,
                                elements: tower.elements,
                                projectile: 'beam'
                            });
                        }
                    }
                });
                return updatedTowers;
            });

            if (newAttacks.length > 0) setAttacks(a => [...a.slice(-200), ...newAttacks]);

            setEnemies(currentEnemies => {
                 let playerResourcesToAdd = 0;
                 const newEnemies = currentEnemies.map(enemy => {
                    let newHealth = enemy.health;
                    newAttacks.forEach(attack => {
                        if (attack.targetId === enemy.id) {
                            const tower = Object.values(towersByCell).find(t => t.id === attack.towerId);
                            if (tower) {
                                newHealth -= tower.damage;
                                newDamageNumbers.push({
                                    id: `dmg-${now}-${Math.random()}`,
                                    targetId: enemy.id,
                                    amount: tower.damage,
                                    color: elementProjectileColors[tower.elements[0]] || 'white',
                                    position: enemy.position,
                                });
                            }
                        }
                    });
                    
                    if (newHealth <= 0) {
                        playerResourcesToAdd += enemy.bounty;
                        setTotalKilled(k => k + 1);
                        return null;
                    }
                    return { ...enemy, health: newHealth };
                }).filter(Boolean) as Enemy[];

                if (playerResourcesToAdd > 0) {
                    setPlayers(prev => prev.map(p => ({...p, resources: p.resources + playerResourcesToAdd})));
                }

                if (newDamageNumbers.length > 0) {
                  setDamageNumbers(d => [...d.slice(-100), ...newDamageNumbers]);
                }
                
                return newEnemies.map(enemy => {
                     const isStunned = enemy.effects.some(e => e.type === 'stun' && e.expires > now);
                     if (!isStunned) {
                        const slowEffect = enemy.effects.find(e => e.type === 'slow' && e.expires > now);
                        const effectiveSpeed = enemy.speed * (slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1);
                        const timeSinceMove = now - enemy.lastMove;
                        
                        if (timeSinceMove / (1000 / effectiveSpeed) >= 1) {
                             if (enemy.pathIndex < currentPath.length - 1) {
                                return {...enemy, pathIndex: enemy.pathIndex + 1, lastMove: now};
                            } else {
                                setGameState(g => ({...g, lives: Math.max(0, g.lives - 1)}));
                                setTotalLeaked(l => l+1);
                                return null;
                            }
                        }
                     }
                    return enemy;
                }).filter(Boolean) as Enemy[];
            });


            // Wave Completion Check
            if (spawnerStateRef.current && spawnerStateRef.current.count >= spawnerStateRef.current.waveData.count && enemies.length === 0) {
                spawnerStateRef.current = null;
                const nextWave = currentWave + 1;
                
                if (nextWave >= waves.length) {
                    handleGameEnd({ playerName: players[0]?.name || 'Spieler', playerUid: user?.uid || 'anonymous', date: new Date().toISOString(), difficulty, wave: waves.length, won: true, finalTowers: towersByCell });
                } else {
                    if (nextWave > 0 && nextWave % 5 === 0 && ALL_PICKABLE_ELEMENTS.some(e => !players[0].unlockedElements.includes(e))) {
                        setGameStatus('picking-element');
                    } else {
                        setCurrentWave(nextWave);
                        setIsIntermission(true);
                        setWaveStartCountdown(INTERMISSION_TIME);
                    }
                }
            }
        };

        gameLoopRef.current = requestAnimationFrame(gameLoop);

        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
        };
    }, [gameStatus, isIntermission, currentPath, currentWave, difficulty, isCheating, players, user, handleGameEnd, towersByCell]);


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
            handleSelectTowerToBuild={handleSelectTowerToBuild}
            selectedTowerToBuild={selectedTowerToBuild}
            focusedTower={focusedTower}
            setFocusedTower={setFocusedTower}
            handleGameControl={handleGameControl}
            handleStartNextWaveNow={handleStartNextWaveNow}
            handlePlaceTower={handlePlaceTower}
            allTowers={initialTowers}
            cancelInteractions={cancelInteractions}
            handleLoadTestLayout={handleLoadTestLayout}
            handleLoadAllTowersLayout={handleLoadAllTowersLayout}
            cheat_addResources={() => setPlayers(prev => prev.map(p => ({...p, resources: p.resources + 10000})))}
            cheat_skipWaves={() => setCurrentWave(prev => Math.min(prev + 5, waves.length -1))}
            cheat_heal={() => setGameState(prev => ({...prev, lives: difficultyModifiers[difficulty].startLives}))}
            cheat_unlockAll={() => setPlayers(prev => prev.map(p => ({...p, unlockedElements: [...ALL_PICKABLE_ELEMENTS, 'neutral']})))}
            totalKilled={totalKilled} setTotalKilled={setTotalKilled}
            totalLeaked={totalLeaked} setTotalLeaked={setTotalLeaked}
            handleElementPick={handleElementPick}
        />
    )
}
