

"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import GameSession from './game-session';
import type { Tower, PlacedTower, Enemy, Node, Element, Difficulty, Attack, DamageNumber, SplashRing, GameSaveState, GameResult, GameResultWithId, EnemyStatusEffect, MovementPattern } from '@/lib/game-data/types';
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
import type { GameBoardHandle } from './game-board';
import { interpolatedEnemyPositions } from './game-board';


export default function SinglePlayerGame({
    difficulty: initialDifficulty,
    onExit,
    initialSavedGame,
    isCheating = false,
    startWithTutorial = false,
    user
}: SinglePlayerGameProps) {
    const { toast } = useToast();
    const gameBoardRef = useRef<GameBoardHandle>(null);

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

    // --- VFX State ---
    const [localAttacks, setLocalAttacks] = useState<Attack[]>([]);
    const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
    const [splashRings, setSplashRings] = useState<SplashRing[]>([]);
    const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string|null>(null);
    const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());
    const [finalGameResult, setFinalGameResult] = useState<GameResult | null>(null);

    // --- Game Loop Refs ---
    const gameLoopRef = useRef<number>();
    const lastTickRef = useRef(performance.now());
    const enemyIdCounter = useRef(0);
    
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
            if(gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
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
    }, [saveGameState, user, isCheating, difficulty, gameStatus]);

    useEffect(() => {
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
    }, [initialSavedGame, isCheating, startWithTutorial, initialDifficulty, user, difficulty]);

    const handlePlaceTower = useCallback((row: number, col: number) => {
        const player = players[0];
        if (!player) return;
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
            setSelectedTowerToBuild(null);
            return;
        }
    
        const currentPlacedTowers = Object.values(towersByCell).map(t => t.position);
        if (!findPath(START_NODE, END_NODE, [...currentPlacedTowers, {row, col}], GRID_ROWS, GRID_COLS)) {
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
    
        setTowersByCell(prev => ({ ...prev, [cellKey]: newTower }));
        setPlayers(prev => prev.map(p => p.id === player.id ? { ...p, resources: p.resources - newTower.cost } : p));
        setSelectedTowerToBuild(null);
        audioManager.playSfx('build_tower');
    }, [players, selectedTowerToBuild, towersByCell, toast, START_NODE, END_NODE]);
    
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
        
        const newPlacedTower: PlacedTower = {
            ...focusedTower,
            ...upgradeTowerSpec,
            specId: upgradeTowerSpec.id,
            health: upgradeTowerSpec.maxHealth,
        };
    
        setTowersByCell(prev => ({ ...prev, [cellKey]: newPlacedTower }));
        setPlayers(prev => prev.map(p => p.id === player.id ? { ...p, resources: p.resources - cost } : p));
        setLastUpgradedTowerId(newPlacedTower.id);
        setTimeout(() => setLastUpgradedTowerId(null), 1000);
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
    
        setPlayers(prev => prev.map(p => p.id === player.id ? { ...p, resources: p.resources + refund } : p));
        setFocusedTower(null);
        audioManager.playSfx('build_tower');
    }, [players, focusedTower, difficulty]);
    
    const handleGameControl = useCallback(() => {
        setGameStatus(prev => prev === 'playing' ? 'paused' : 'playing');
    }, []);

    const startWave = useCallback(() => {
        setIsIntermission(false);
        audioManager.playWaveMusic();
        setSpawnedThisWave(0);
    }, []);

    const handleStartNextWaveNow = useCallback(() => {
        if (isIntermission && gameStatus === 'playing') {
            startWave();
            setWaveStartCountdown(0);
        }
    }, [isIntermission, startWave, gameStatus]);

    const cancelInteractions = useCallback(() => {
        setSelectedTowerToBuild(null);
        setFocusedTower(null);
    }, []);
    
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
        setPlayers(prev => prev.map(p => ({...p, unlockedElements: [...p.unlockedElements, element]})));
        setCurrentWave(prev => prev + 1);
        setIsIntermission(true);
        setWaveStartCountdown(INTERMISSION_TIME);
        setGameStatus('playing');
    };

    const handleLoadTestLayout = useCallback(() => handleLoadMazetLayout(false), [handleLoadMazetLayout]);
    const handleLoadAllTowersLayout = useCallback(() => handleLoadMazetLayout(true), [handleLoadMazetLayout]);

    useEffect(() => {
        let isTabVisible = true;
        const handleVisibilityChange = () => { isTabVisible = document.visibilityState === 'visible'; };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener('beforeunload', saveGameState);

        let lastCountdownUpdateTime = 0;
        let spawnerState: { count: number; timer: number; waveData: any } | null = null;
        let waveInProgress = false;

        const gameLoop = (now: number) => {
            gameLoopRef.current = requestAnimationFrame(gameLoop);
            const delta = now - lastTickRef.current;
            if (delta < 1000 / 65) return;
            lastTickRef.current = now;
            setFps(Math.round(1000 / delta));

            if (gameStatus !== 'playing' || !isTabVisible) return;
            
            if (isIntermission) {
                if (now - lastCountdownUpdateTime > 1000) {
                    lastCountdownUpdateTime = now;
                    setWaveStartCountdown(prev => {
                        const newTime = Math.max(0, prev - 1);
                        if (newTime <= 0) startWave();
                        return newTime;
                    });
                }
                return;
            }

            if (!waveInProgress) {
                waveInProgress = true;
                const waveData = waves[currentWave];
                if (!waveData) return;
                if (!currentPath || currentPath.length === 0) return;
                spawnerState = { count: 0, timer: 0, waveData: waveData.enemies };
            }
            
            setEnemies(currentEnemies => {
                const currentTowers = Object.values(towersByCell);
                const newAttacks: Attack[] = [];
                const newFiringTowerIds = new Set<string>();

                // 1. Spawn new enemies
                let enemiesToSpawn = [...currentEnemies];
                if (spawnerState && spawnerState.count < spawnerState.waveData.count) {
                    spawnerState.timer += delta;
                    if (spawnerState.timer >= spawnerState.waveData.spawnDelay) {
                        spawnerState.timer = 0;
                        const difficultyMod = difficultyModifiers[difficulty];
                        const health = isCheating ? spawnerState.waveData.health : Math.round(spawnerState.waveData.health * difficultyMod.enemyHealth);
                        const movementPattern: MovementPattern = spawnerState.waveData.type === 'schnell' ? 'zigzag' : ((spawnerState.waveData.type === 'gepanzert' || spawnerState.waveData.type === 'boss') ? 'straight' : 'wobble');
                        
                        enemiesToSpawn.push({
                            id: `enemy-${enemyIdCounter.current++}`, ...spawnerState.waveData, health, maxHealth: health,
                            pathIndex: 0, position: START_NODE, isBlocked: false, effects: [],
                            lastMove: now, wasHit: false, targetNode: END_NODE, movementPattern
                        });
                        setSpawnedThisWave(c => c + 1);
                        spawnerState.count++;
                    }
                }

                // 2. Tower attacks
                currentTowers.forEach(tower => {
                    if (now - tower.lastAttack > tower.attackSpeed) {
                         const enemiesInRange = enemiesToSpawn.filter(e => {
                            const enemyPos = interpolatedEnemyPositions.get(e.id) || e.position;
                            const towerPos = tower.position;
                            const distanceSq = Math.pow(enemyPos.row - towerPos.row, 2) + Math.pow(enemyPos.col - towerPos.col, 2);
                            return distanceSq <= tower.range * tower.range;
                        });

                        if (enemiesInRange.length > 0) {
                            const mainTarget = enemiesInRange[0];
                            const projectileType = tower.specId.includes('-1a') || tower.specId.includes('-2a') ? 'arrow' : 'beam';
                            newAttacks.push({ id: `attack-${now}-${Math.random()}`, towerId: tower.id, targetId: mainTarget.id, elements: tower.elements, projectile: projectileType });
                            
                            let damage = tower.damage;
                            mainTarget.health -= damage;
                            mainTarget.wasHit = true;
                            tower.lastAttack = now;
                            newFiringTowerIds.add(tower.id);
                        }
                    }
                });

                // 3. Move enemies and check for reaching end
                 let livesLostThisFrame = 0;
                 let resourcesGainedThisFrame = 0;
                const nextEnemies = enemiesToSpawn.filter(enemy => {
                    if (enemy.health <= 0) {
                        setPlayers(prevPlayers => prevPlayers.map(p => ({...p, resources: p.resources + enemy.bounty})));
                        return false; 
                    }
                    const isStunned = enemy.effects.some(e => e.expires > now && e.type === 'stun');
                    if (!isStunned) {
                        const slowEffect = enemy.effects.find(e => e.type === 'slow' && e.expires > now);
                        const effectiveSpeed = enemy.speed * (slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1);
                        const timeSinceMove = now - enemy.lastMove;
                        if (timeSinceMove / (1000 / effectiveSpeed) >= 1) {
                             if (enemy.pathIndex < currentPath.length - 1) {
                                enemy.pathIndex++;
                                enemy.lastMove = now;
                            } else {
                                setGameState(g => ({...g, lives: Math.max(0, g.lives - 1)}));
                                return false; 
                            }
                        }
                    }
                    return true;
                });
                
                if(newAttacks.length > 0) setLocalAttacks(prev => [...prev, ...newAttacks]);
                if(newFiringTowerIds.size > 0) {
                    setFiringTowerIds(prev => { const next = new Set(prev); newFiringTowerIds.forEach(id => next.add(id)); return next; });
                    setTimeout(() => setFiringTowerIds(prev => { const next = new Set(prev); newFiringTowerIds.forEach(id => next.delete(id)); return next; }), 150);
                }

                const waveData = waves[currentWave];
                const allEnemiesSpawned = spawnerState ? spawnerState.count >= waveData.enemies.count : false;
                if (waveInProgress && allEnemiesSpawned && nextEnemies.length === 0) {
                    waveInProgress = false;
                    spawnerState = null;
                    const nextWaveIdx = currentWave + 1;
                    if (nextWaveIdx >= waves.length) {
                        handleGameEnd({ playerName: players[0].name, playerUid: user?.uid || 'local', date: new Date().toISOString(), difficulty, wave: nextWaveIdx, won: true, finalTowers: towersByCell });
                    } else {
                        const canPickElement = nextWaveIdx > 0 && nextWaveIdx % 5 === 0 && players[0].unlockedElements.length < ALL_PICKABLE_ELEMENTS.length + 1;
                        if (canPickElement && !isCheating) {
                            setGameStatus('picking-element');
                        } else {
                            setCurrentWave(nextWaveIdx);
                            setIsIntermission(true);
                            setWaveStartCountdown(INTERMISSION_TIME);
                            lastCountdownUpdateTime = now;
                        }
                    }
                }
                
                if (gameState.lives <= 0) {
                   handleGameEnd({ playerName: players[0].name, playerUid: user?.uid || 'local', date: new Date().toISOString(), difficulty, wave: currentWave, won: false, finalTowers: towersByCell });
                }

                return nextEnemies;
            });
        };

        gameLoopRef.current = requestAnimationFrame(gameLoop);
        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener('beforeunload', saveGameState);
            if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
        };
    }, [saveGameState, players, currentWave, difficulty, isCheating, user, gameState.lives, handleGameEnd, isIntermission, startWave, towersByCell, currentPath, gameStatus]);

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
            attacks={localAttacks}
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
        />
    )
}
