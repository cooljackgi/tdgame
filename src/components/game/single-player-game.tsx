

"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Tower, PlacedTower, Enemy, Node, Element, Difficulty, Attack, DamageNumber, SplashRing, GameSaveState, GameResult, GameResultWithId, EnemyStatusEffect, MovementPattern } from '@/lib/game-data/types';
import { useToast } from '@/hooks/use-toast';
import { difficultyModifiers, ALL_PICKABLE_ELEMENTS, INTERMISSION_TIME, GRID_ROWS, GRID_COLS, LOCAL_STORAGE_KEY, elementProjectileColors } from '@/lib/game-data/constants';
import type { User } from 'firebase/auth';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { normalizePlayers } from '@/lib/player-utils';
import { audioManager } from '@/lib/audio/audio-manager';
import { findPath } from '@/lib/pathfinding';
import GameSession from './game-session';
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
    
    // --- State that causes re-renders (UI-related) ---
    const [gameStatus, setGameStatus] = useState<GameStatus>('playing');
    const [finalGameResult, setFinalGameResult] = useState<GameResult | null>(null);
    const [fps, setFps] = useState(0);
    const [totalKilled, setTotalKilled] = useState(0);
    const [totalLeaked, setTotalLeaked] = useState(0);

    // --- VFX State (fed by deltas) ---
    const [attacks, setAttacks] = useState<Attack[]>([]);
    const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
    const [splashRings, setSplashRings] = useState<SplashRing[]>([]);
    const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string | null>(null);
    const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());

    // --- Core game state ---
    const [players, setPlayers] = useState<Player[]>([]);
    const [gameState, setGameState] = useState<GameState>({ lives: 20 });
    const [difficulty, setDifficulty] = useState<Difficulty>(initialDifficulty);
    const [isIntermission, setIsIntermission] = useState(true);
    const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);
    const [currentWave, setCurrentWave] = useState(0);
    const [towersByCell, setTowersByCell] = useState<Record<string, PlacedTower>>({});
    const [enemies, setEnemies] = useState<Enemy[]>([]);
    const [spawnedThisWave, setSpawnedThisWave] = useState(0);
    
    // --- Refs for game loop logic ---
    const spawnerStateRef = useRef<{ count: number; timer: number; waveData: any } | null>(null);
    const enemyIdCounter = useRef(0);
    const gameLoopRef = useRef<number>();
    const lastTickRef = useRef(performance.now());
    
    const allTowers = useMemo(() => initialTowers.map(t => ({...t})), []);
    const currentPath = useMemo(() => findPath({ row: 1, col: 1 }, { row: GRID_ROWS, col: GRID_COLS }, Object.values(towersByCell), GRID_ROWS, GRID_COLS) || [], [towersByCell]);

    useEffect(() => {
        if (initialSavedGame) {
            setPlayers(normalizePlayers(initialSavedGame.players));
            setGameState(initialSavedGame.gameState);
            setTowersByCell(initialSavedGame.towersByCell);
            setEnemies(initialSavedGame.enemies);
            setCurrentWave(initialSavedGame.currentWave);
            setDifficulty(initialSavedGame.difficulty);
        } else {
            const difficultyMod = difficultyModifiers[initialDifficulty];
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

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
          if (gameStatus !== 'gameover' && !isCheating) {
            saveGameState();
          }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            if(gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
        }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialSavedGame, isCheating, startWithTutorial, initialDifficulty, user]);
    
    const saveGameState = useCallback(() => {
        if (gameStatus === 'gameover' || isCheating) return;
        const stateToSave: GameSaveState = {
            players: { player1: players[0], player2: null },
            gameState, 
            towersByCell, 
            enemies, 
            currentWave, 
            difficulty
        };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stateToSave));
        toast({ title: 'Spiel gespeichert!' });
    }, [gameStatus, isCheating, toast, players, gameState, towersByCell, enemies, currentWave, difficulty]);
    
    const handleGameEnd = useCallback(async (result: GameResult) => {
        if (gameStatus !== 'gameover') {
            setGameStatus('gameover');
            localStorage.removeItem(LOCAL_STORAGE_KEY);
            if (user && !isCheating) {
                try {
                    const docData = { ...result, date: serverTimestamp() };
                    await addDoc(collection(db, "scores"), docData);
                    setFinalGameResult({ ...result, date: new Date().toISOString() });
                } catch(e) {
                    console.error("Failed to save score", e);
                    setFinalGameResult(result);
                }
            } else {
                setFinalGameResult(result);
            }
        }
    }, [user, isCheating, gameStatus]);

    const handlePlaceTower = useCallback((row: number, col: number, playerId: Player['id'], towerId: string) => {
        const selectedTowerToBuild = allTowers.find(t => t.id === towerId);
        if (!selectedTowerToBuild) return;

        const cellKey = `${row}_${col}`;
        if (towersByCell[cellKey]) return;
        
        const currentPlacedTowers = Object.values(towersByCell).map(t => t.position);
        if (!findPath({row:1, col:1}, {row:GRID_ROWS, col:GRID_COLS}, [...currentPlacedTowers, {row, col}], GRID_ROWS, GRID_COLS)) {
            return;
        }

        const player = players.find(p => p.id === playerId);
        if (!player || player.resources < selectedTowerToBuild.cost) return;

        const newTower: PlacedTower = JSON.parse(JSON.stringify({
            ...selectedTowerToBuild,
            id: `tower-${row}-${col}-${Date.now()}`,
            specId: selectedTowerToBuild.id,
            position: { row, col },
            lastAttack: 0,
            health: selectedTowerToBuild.maxHealth,
            ownerId: player.id,
        }));
        
        setTowersByCell(prev => ({ ...prev, [cellKey]: newTower }));
        setPlayers(prevPlayers => prevPlayers.map(p => p.id === playerId ? {...p, resources: p.resources - newTower.cost} : p));
    }, [allTowers, towersByCell, players]);

     const handleUpgradeTower = useCallback((row: number, col: number, upgradeId: string, playerId: Player['id']) => {
        const player = players.find(p => p.id === playerId);
        const cellKey = `${row}_${col}`;
        const focusedTower = towersByCell[cellKey];

        if (!player || !focusedTower || focusedTower.ownerId !== playerId) return;

        const upgradeTowerSpec = allTowers.find(t => t.id === upgradeId);
        if (!upgradeTowerSpec) return;

        const refundPercentage = difficulty === 'Einfach' ? 1.0 : 0.75;
        const cost = Math.max(0, upgradeTowerSpec.cost - Math.floor(focusedTower.cost * refundPercentage));

        if (player.resources < cost) return;

        const newPlacedTower: PlacedTower = JSON.parse(JSON.stringify({ 
            ...focusedTower, 
            ...upgradeTowerSpec, 
            specId: upgradeTowerSpec.id, 
            health: upgradeTowerSpec.maxHealth 
        }));
        
        setTowersByCell(prev => ({...prev, [cellKey]: newPlacedTower }));
        setPlayers(prev => prev.map(p => p.id === playerId ? {...p, resources: p.resources - cost} : p));

        setLastUpgradedTowerId(newPlacedTower.id);
        setTimeout(() => setLastUpgradedTowerId(null), 1000);
    }, [allTowers, players, towersByCell, difficulty]);

    const handleSellTower = useCallback((row: number, col: number, playerId: Player['id']) => {
        const player = players.find(p => p.id === playerId);
        const cellKey = `${row}_${col}`;
        const focusedTower = towersByCell[cellKey];

        if (!player || !focusedTower || focusedTower.ownerId !== playerId) return;

        const refundPercentage = difficulty === 'Einfach' ? 1.0 : 0.75;
        const refund = Math.round(focusedTower.cost * refundPercentage);

        setTowersByCell(prev => {
            const next = {...prev};
            delete next[cellKey];
            return next;
        });
        setPlayers(prev => prev.map(p => p.id === playerId ? {...p, resources: p.resources + refund} : p));
    }, [players, towersByCell, difficulty]);

    const onLocalAction = useCallback((action: 'build' | 'upgrade' | 'sell', payload: any) => {
        const selectedTowerId = (document as any).__SELECTED_TOWER_ID;
        const { row, col, upgradeId } = payload;
        switch(action) {
            case 'build':
                handlePlaceTower(row, col, 'player1', selectedTowerId);
                break;
            case 'upgrade':
                handleUpgradeTower(row, col, upgradeId, 'player1');
                break;
            case 'sell':
                handleSellTower(row, col, 'player1');
                break;
        }
    }, [handlePlaceTower, handleUpgradeTower, handleSellTower]);
    
    // --- Game Loop ---
    useEffect(() => {
        const gameLoop = (now: number) => {
            gameLoopRef.current = requestAnimationFrame(gameLoop);
            if (gameStatus !== 'playing') {
                lastTickRef.current = now;
                return;
            }

            const delta = now - lastTickRef.current;
            if (delta < 1000/65) return; // ~60fps cap
            lastTickRef.current = now;
            setFps(Math.round(1000 / delta));
            
            if (isIntermission) {
                setWaveStartCountdown(prev => {
                    const newTime = prev - delta / 1000;
                    if (newTime <= 0) {
                        setIsIntermission(false);
                        audioManager.playWaveMusic();
                        return 0;
                    }
                    return newTime;
                });
                return;
            }

            // --- Spawning ---
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
                        const health = Math.round(spawnerStateRef.current.waveData.health * difficultyMod.enemyHealth);
                        const newEnemy: Enemy = {
                            id: `enemy-${currentWave}-${enemyIdCounter.current++}`,
                            ...spawnerStateRef.current.waveData,
                            health,
                            maxHealth: health,
                            path: currentPath,
                            pathIndex: 0,
                            position: {row: 1, col: 1},
                            isBlocked: false,
                            effects: [],
                            lastMove: now,
                            wasHit: false,
                            targetNode: {row: GRID_ROWS, col: GRID_COLS},
                            movementPattern: spawnerStateRef.current.waveData.type === 'schnell' ? 'zigzag' : 'wobble'
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
            const newFiringTowerIds = new Set<string>();

            // Tower attacks
            setTowersByCell(currentTowers => {
                const updatedTowers = {...currentTowers};
                setEnemies(currentEnemies => {
                    const enemiesCopy = [...currentEnemies];
                    
                    Object.values(updatedTowers).forEach(tower => {
                        if (now - tower.lastAttack >= tower.attackSpeed) {
                            const targets = enemiesCopy.filter(e => {
                                const towerPos = { x: tower.position.col, y: tower.position.row };
                                const enemyPos = { x: e.position.col, y: e.position.row };
                                const distSq = (towerPos.x - enemyPos.x) ** 2 + (towerPos.y - enemyPos.y) ** 2;
                                return distSq <= tower.range ** 2;
                            });
                            
                            if (targets.length > 0) {
                                const mainTarget = targets.sort((a,b) => b.pathIndex - a.pathIndex)[0];
                                tower.lastAttack = now;
                                
                                newAttacks.push({ id: `attack-${now}-${Math.random()}`, towerId: tower.id, targetId: mainTarget.id, targetPosition: mainTarget.position, elements: tower.elements, projectile: 'beam' });
                                newFiringTowerIds.add(tower.id);
                                audioManager.playSfx('shoot', 0.3);
                                
                                const damage = tower.damage;
                                mainTarget.health -= damage;
                                mainTarget.wasHit = true;
                                newDamageNumbers.push({ id: `dmg-${now}-${Math.random()}`, targetId: mainTarget.id, amount: damage, color: elementProjectileColors[tower.elements[0]] || 'white', position: mainTarget.position });
                            }
                        }
                    });

                    return enemiesCopy;
                });
                return updatedTowers;
            });
            

            setAttacks(prev => [...prev.slice(-100), ...newAttacks]);
            setDamageNumbers(prev => [...prev.slice(-100), ...newDamageNumbers]);
            setSplashRings(prev => [...prev.slice(-50), ...newSplashRings]);
            setFiringTowerIds(newFiringTowerIds);
            setTimeout(() => setFiringTowerIds(new Set()), 150);

            // Enemy movement & state updates
            let livesLost = 0;
            setEnemies(currentEnemies => {
                const nextEnemies: Enemy[] = [];
                for (const enemy of currentEnemies) {
                    if (enemy.health <= 0) {
                        setPlayers(prevPlayers => prevPlayers.map(p => ({...p, resources: p.resources + enemy.bounty})));
                        setTotalKilled(k => k + 1);
                        continue;
                    }

                    if (enemy.pathIndex >= currentPath.length - 1) {
                        livesLost++;
                        setTotalLeaked(l => l + 1);
                        continue;
                    }

                    const slowEffect = enemy.effects.find(e => e.type === 'slow' && e.expires > now);
                    const effectiveSpeed = enemy.speed * (slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1);
                    
                    if (now - enemy.lastMove >= 1000 / effectiveSpeed) {
                        enemy.pathIndex++;
                        enemy.position = currentPath[enemy.pathIndex];
                        enemy.lastMove = now;
                    }
                    
                    enemy.wasHit = false;
                    nextEnemies.push(enemy);
                }
                return nextEnemies;
            });

            if (livesLost > 0) {
                setGameState(prev => {
                    const newLives = prev.lives - livesLost;
                    if (newLives <= 0) {
                        handleGameEnd({ playerName: players[0].name, playerUid: players[0].id, date: new Date().toISOString(), difficulty, wave: currentWave + 1, won: false, finalTowers: towersByCell });
                        return { lives: 0 };
                    }
                    return { lives: newLives };
                });
            }

            if (spawnerStateRef.current && spawnerStateRef.current.count >= spawnerStateRef.current.waveData.count && enemies.length === 0) {
                spawnerStateRef.current = null;
                const nextWave = currentWave + 1;
                if (nextWave >= waves.length) {
                    handleGameEnd({ playerName: players[0].name, playerUid: players[0].id, date: new Date().toISOString(), difficulty, wave: waves.length, won: true, finalTowers: towersByCell });
                } else {
                    if ((nextWave + 1) % 5 === 0 && ALL_PICKABLE_ELEMENTS.some(e => !players[0].unlockedElements.includes(e))) {
                        setGameStatus('picking-element');
                    } else {
                        setCurrentWave(nextWave);
                        setIsIntermission(true);
                        setWaveStartCountdown(INTERMISSION_TIME);
                        if (!isCheating) saveGameState();
                    }
                }
            }
        };
        gameLoopRef.current = requestAnimationFrame(gameLoop);
        return () => { if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current); };
    }, [gameStatus, isIntermission, currentPath, handleGameEnd, isCheating, saveGameState, currentWave, difficulty, players, enemies, towersByCell]);


    const handleElementPick = (element: Element) => {
        setPlayers(prev => [{...prev[0], unlockedElements: [...prev[0].unlockedElements, element]}]);
        setCurrentWave(prev => prev + 1);
        setIsIntermission(true);
        setWaveStartCountdown(INTERMISSION_TIME);
        setGameStatus('playing');
        if (!isCheating) saveGameState();
    };

    const handleStartNextWaveNow = () => {
        if(isIntermission && gameStatus === 'playing') {
            setIsIntermission(false);
            setWaveStartCountdown(0);
            audioManager.playWaveMusic();
        }
    };
    
    if (!players[0]) return null;

    // Use dummy functions for coop-specific props
    const dummyBroadcast = () => {};
    const dummyApplyDeltas = () => {};

    return (
        <GameSession
            players={players} setPlayers={setPlayers}
            gameState={gameState} setGameState={setGameState}
            towersByCell={towersByCell} setTowersByCell={setTowersByCell}
            currentWave={currentWave} setCurrentWave={setCurrentWave}
            gameStatus={gameStatus} setGameStatus={setGameStatus}
            difficulty={difficulty} setDifficulty={setDifficulty}
            isIntermission={isIntermission} setIsIntermission={setIsIntermission}
            waveStartCountdown={Math.round(waveStartCountdown)} setWaveStartCountdown={setWaveStartCountdown}
            currentPath={currentPath}
            enemies={enemies} setEnemies={setEnemies}
            spawnedThisWave={spawnedThisWave} setSpawnedThisWave={setSpawnedThisWave}
            isCoop={false} isGameHost={true} localPlayerId="player1"
            broadcastGameData={dummyBroadcast} applyDeltas={dummyApplyDeltas} onGameEnd={handleGameEnd}
            onExit={onExit} onLocalAction={onLocalAction}
            attacks={attacks} damageNumbers={damageNumbers} splashRings={splashRings}
            lastUpgradedTowerId={lastUpgradedTowerId} setLastUpgradedTowerId={setLastUpgradedTowerId}
            firingTowerIds={firingTowerIds} setFiringTowerIds={setFiringTowerIds}
            fps={fps} setFps={setFps}
            totalKilled={totalKilled} setTotalKilled={setTotalKilled}
            totalLeaked={totalLeaked} setTotalLeaked={setTotalLeaked}
            finalGameResult={finalGameResult}
        />
    )
}
