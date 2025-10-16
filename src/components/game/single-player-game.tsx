

"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import GameSession from './game-session';
import type { Tower, PlacedTower, Enemy, Node, Element, Difficulty, Attack, DamageNumber, SplashRing, GameSaveState, GameResult, GameDelta, EnemyStatusEffect, MovementPattern } from '@/lib/game-data/types';
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
import { GameBoardHandle, interpolatedEnemyPositions } from './game-board';

type SinglePlayerGameProps = {
    difficulty: Difficulty;
    onExit: () => void;
    initialSavedGame: GameSaveState | null;
    isCheating?: boolean;
    startWithTutorial?: boolean;
    user: User | null;
}

const CELL_SIZE = 64;
function gridToPx(node: Node) {
    const x = (node.col - 1) * CELL_SIZE + CELL_SIZE / 2;
    const y = (node.row - 1) * CELL_SIZE + CELL_SIZE / 2;
    return { x, y };
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
    const gameBoardRef = useRef<GameBoardHandle>(null);

    // React State (for UI rendering)
    const [players, setPlayers] = useState<Player[]>([]);
    const [gameState, setGameState] = useState<GameState>({ lives: 20 });
    const [towersByCell, setTowersByCell] = useState<Record<string, PlacedTower>>({});
    const [enemies, setEnemies] = useState<Enemy[]>([]);
    const [currentWave, setCurrentWave] = useState(0);
    const [gameStatus, setGameStatus] = useState<GameStatus>('playing');
    const [difficulty, setDifficulty] = useState<Difficulty>(initialDifficulty);
    const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);
    const [spawnedThisWave, setSpawnedThisWave] = useState(0);
    const [localAttacks, setLocalAttacks] = useState<Attack[]>([]);
    const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
    const [splashRings, setSplashRings] = useState<SplashRing[]>([]);
    const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string|null>(null);
    const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());
    const [finalGameResult, setFinalGameResult] = useState<GameResult | null>(null);
    const [selectedTowerToBuild, setSelectedTowerToBuild] = useState<Tower | null>(null);
    const [focusedTower, setFocusedTower] = useState<PlacedTower | null>(null);
    const [fps, setFps] = useState(0);

    // Refs for stable game loop state
    const gameLoopRef = useRef<number>();
    const lastTickRef = useRef(performance.now());
    const isIntermissionRef = useRef(true);
    const waveInProgressRef = useRef(false);
    const countdownRef = useRef(INTERMISSION_TIME);
    const spawnerStateRef = useRef<{ count: number; timer: number; waveData: any } | null>(null);
    const gameStatusRef = useRef<GameStatus>('playing');
    const enemiesRef = useRef<Enemy[]>([]);

    const START_NODE = { row: 1, col: 1 };
    const END_NODE = { row: GRID_ROWS, col: GRID_COLS };
  
    const currentPath = useMemo(() => {
      const blockedPositions = Object.values(towersByCell).map(t => t.position);
      return findPath(START_NODE, END_NODE, blockedPositions, GRID_ROWS, GRID_COLS) || [];
    }, [towersByCell]);
    
    useEffect(() => { gameStatusRef.current = gameStatus; }, [gameStatus]);

    const saveGameState = useCallback(() => {
        if (gameStatusRef.current === 'gameover' || isCheating) return;
        const stateToSave: GameSaveState = {
            players: { player1: players[0], player2: null },
            gameState, towersByCell, enemies: [], currentWave, difficulty
        };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stateToSave));
        toast({ title: 'Spiel gespeichert!' });
    }, [players, gameState, towersByCell, currentWave, difficulty, toast, isCheating]);
    
    const handleGameEnd = useCallback(async (result: GameResult) => {
        if (gameStatusRef.current !== 'gameover') {
            waveInProgressRef.current = false;
            if(gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
            gameStatusRef.current = 'gameover';
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
    }, [saveGameState, user, isCheating, difficulty]);

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
        isIntermissionRef.current = true;
        waveInProgressRef.current = false;
        gameStatusRef.current = 'playing';
        setGameStatus('playing');
        countdownRef.current = INTERMISSION_TIME;
        setWaveStartCountdown(INTERMISSION_TIME);
        enemiesRef.current = [];
        setEnemies([]);
    }, [initialSavedGame, isCheating, startWithTutorial, initialDifficulty, user, difficulty]);

    const handlePlaceTower = useCallback((row: number, col: number) => {
        const player = players[0];
        if (!player || !selectedTowerToBuild) {
             if (selectedTowerToBuild === null && towersByCell[`${row}_${col}`]) {
                setFocusedTower(towersByCell[`${row}_${col}`]);
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
    
        setTowersByCell(prev => ({ ...prev, [cellKey]: newTower }));
        setPlayers(prev => prev.map(p => p.id === player.id ? { ...p, resources: p.resources - newTower.cost } : p));
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
        setGameStatus(prev => {
            const newStatus = prev === 'playing' ? 'paused' : 'playing';
            gameStatusRef.current = newStatus;
            return newStatus;
        });
    }, []);

    const handleStartNextWaveNow = useCallback(() => {
        if (isIntermissionRef.current && gameStatusRef.current === 'playing') {
            isIntermissionRef.current = false;
            countdownRef.current = 0;
            setWaveStartCountdown(0);
        }
    }, []);

    const cancelInteractions = useCallback(() => {
        setSelectedTowerToBuild(null);
        setFocusedTower(null);
    }, []);

    const startWave = useCallback((now: number) => {
        waveInProgressRef.current = true;
        isIntermissionRef.current = false;
        audioManager.playWaveMusic();
        const waveData = waves[currentWave];
        if (!waveData) return;

        spawnerStateRef.current = {
            count: 0,
            timer: 0,
            waveData: waveData.enemies,
        };
    }, [currentWave]);
    
    const handleLoadMazeLayout = useCallback((useAllTowers: boolean = false) => {
        const layout: Node[] = [];
        // Erzeugt ein langes Schlangen-Labyrinth
        for (let r = 3; r < GRID_ROWS; r += 2) {
            if (r % 4 === 3) {
                for (let c = 1; c < GRID_COLS; c++) layout.push({ row: r, col: c });
            } else {
                for (let c = 2; c <= GRID_COLS; c++) layout.push({ row: r, col: c });
            }
        }

        let towerSpecs = useAllTowers ? initialTowers : [initialTowers.find(t => t.id === 'neutral-0')!];
        let towerIndex = 0;

        const newTowersByCell = layout.reduce((acc, pos) => {
            let towerSpec = towerSpecs[towerIndex % towerSpecs.length];
            if (!towerSpec) towerSpec = initialTowers[0];

            const id = `tower-${pos.row}-${pos.col}-${Date.now()}-${Math.random()}`;
            acc[`${pos.row}_${pos.col}`] = { ...towerSpec, id, specId: towerSpec.id, position: pos, lastAttack: 0, health: towerSpec.maxHealth, ownerId: 'player1' };
            
            if (useAllTowers) towerIndex++;

            return acc;
        }, {} as Record<string, PlacedTower>);
        
        setTowersByCell(newTowersByCell);
        setPlayers(prev => prev.map(p => ({...p, resources: 50000})));
        toast({ title: "Maze-Layout geladen!", description: "Ein langer Weg wurde gebaut." });
    }, [toast]);


    const handleLoadTestLayout = useCallback(() => {
        handleLoadMazeLayout(false);
    }, [handleLoadMazeLayout]);

    const handleLoadAllTowersLayout = useCallback(() => {
        handleLoadMazeLayout(true);
    }, [handleLoadMazeLayout]);

    const renderVfx = useCallback((now: number) => {
        const newLocalAttacks: Attack[] = [];
        const currentTowers = Object.values(towersByCell);
        let currentEnemies = [...enemiesRef.current];

        currentTowers.forEach(tower => {
            if (now - tower.lastAttack > tower.attackSpeed) {
                const towerPos = gridToPx(tower.position);
                
                const enemiesInRange = currentEnemies.filter(e => {
                    const enemyWorldPos = interpolatedEnemyPositions.get(e.id);
                    if (!enemyWorldPos) return false;
                    const distance = Math.hypot(enemyWorldPos.y - towerPos.y, enemyWorldPos.x - towerPos.x);
                    return distance <= (tower.range + 0.5) * 64;
                });

                if (enemiesInRange.length > 0) {
                    const mainTarget = enemiesInRange[0];
                    const projectileType = tower.specId.includes('-1a') || tower.specId.includes('-2a') ? 'arrow' : 'beam';
                    newLocalAttacks.push({ id: `attack-${now}-${Math.random()}`, towerId: tower.id, targetId: mainTarget.id, elements: tower.elements, projectile: projectileType });
                    
                    let damage = tower.damage;
                    mainTarget.health -= damage;
                    mainTarget.wasHit = true;
                    
                    tower.lastAttack = now;
                    setFiringTowerIds(prev => {
                        const newSet = new Set(prev);
                        newSet.add(tower.id);
                        return newSet;
                    });
                    setTimeout(() => setFiringTowerIds(prev => {
                        const newSet = new Set(prev);
                        newSet.delete(tower.id);
                        return newSet;
                    }), 150);
                }
            }
        });
        
        enemiesRef.current = currentEnemies;
        if (newLocalAttacks.length > 0) {
            setLocalAttacks(prev => [...prev.slice(-100), ...newLocalAttacks]);
        }
    }, [towersByCell]);


    useEffect(() => {
        let isTabVisible = true;
        const handleVisibilityChange = () => { isTabVisible = document.visibilityState === 'visible'; };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener('beforeunload', saveGameState);

        let enemyIdCounter = 0;
        let lastCountdownUpdateTime = 0;

        const simulate = (now: number) => {
            gameLoopRef.current = requestAnimationFrame(simulate);

            const delta = now - lastTickRef.current;
            if (delta < 1000 / 65) return;
            lastTickRef.current = now;
            setFps(Math.round(1000 / delta));

            if (gameStatusRef.current !== 'playing' || !isTabVisible) {
                return;
            }
            
            if (isIntermissionRef.current) {
                if (now - lastCountdownUpdateTime > 1000) {
                    lastCountdownUpdateTime = now;
                    countdownRef.current = Math.max(0, countdownRef.current - 1);
                    setWaveStartCountdown(countdownRef.current);
                    if (countdownRef.current <= 0) {
                       startWave(now);
                    }
                }
                return;
            }

            if (!waveInProgressRef.current) {
                startWave(now);
            }
            
            let currentEnemies = enemiesRef.current;
            const spawner = spawnerStateRef.current;
            if (spawner && spawner.count < spawner.waveData.count) {
                spawner.timer += delta;
                if (spawner.timer >= spawner.waveData.spawnDelay) {
                    spawner.timer = 0;
                    
                    const difficultyMod = difficultyModifiers[difficulty];
                    const health = isCheating ? spawner.waveData.health : Math.round(spawner.waveData.health * difficultyMod.enemyHealth);
                    const movementPattern: MovementPattern = spawner.waveData.type === 'schnell' ? 'zigzag' : ((spawner.waveData.type === 'gepanzert' || spawner.waveData.type === 'boss') ? 'straight' : 'wobble');
                    
                    const newEnemy: Enemy = {
                        id: `enemy-${enemyIdCounter++}`, ...spawner.waveData, health, maxHealth: health,
                        path: currentPath, pathIndex: 0, position: START_NODE, isBlocked: false, effects: [],
                        lastMove: now, wasHit: false, targetNode: END_NODE, movementPattern
                    };
                    
                    currentEnemies.push(newEnemy);
                    spawner.count++;
                    setSpawnedThisWave(spawner.count);
                }
            }

            renderVfx(now);
            
            let livesLost = 0;
            let resourcesGained = 0;
            const remainingEnemies: Enemy[] = [];

            for (let i = 0; i < currentEnemies.length; i++) {
                const enemy = currentEnemies[i];

                if (enemy.health <= 0) {
                    resourcesGained += enemy.bounty;
                    continue;
                }
                
                let isStunned = enemy.effects.some(e => e.expires > now && e.type === 'stun');

                if (!isStunned) {
                    const slowEffect = enemy.effects.find(e => e.type === 'slow' && e.expires > now);
                    const effectiveSpeed = enemy.speed * (slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1);
                    const timeSinceMove = now - enemy.lastMove;
                    const progress = timeSinceMove / (1000 / effectiveSpeed);

                    if (progress >= 1) {
                         if (enemy.pathIndex < currentPath.length - 1) {
                            enemy.pathIndex++;
                            enemy.lastMove = now;
                            enemy.position = currentPath[enemy.pathIndex];
                        } else {
                            livesLost++;
                            continue;
                        }
                    }
                }
                remainingEnemies.push(enemy);
            }
            
            enemiesRef.current = remainingEnemies;
            setEnemies(remainingEnemies);
            
            if (livesLost > 0) {
                setGameState(prev => ({ ...prev, lives: Math.max(0, prev.lives - livesLost) }));
            }
            if (resourcesGained > 0) {
                setPlayers(prev => prev.map(p => ({ ...p, resources: p.resources + resourcesGained })));
            }

            const waveData = waves[currentWave];
            const totalEnemiesInWave = waveData?.enemies.count || 0;
            const allEnemiesSpawned = spawner ? spawner.count >= totalEnemiesInWave : false;
            
            if (waveInProgressRef.current && allEnemiesSpawned && remainingEnemies.length === 0) {
                waveInProgressRef.current = false;
                spawnerStateRef.current = null;
                const nextWave = currentWave + 1;
                if (nextWave >= waves.length) {
                    handleGameEnd({ playerName: players[0].name, playerUid: user?.uid || 'local', date: new Date().toISOString(), difficulty, wave: nextWave, won: true, finalTowers: towersByCell });
                } else {
                    const canPickElement = nextWave > 0 && nextWave % 5 === 0 && players[0].unlockedElements.length < ALL_PICKABLE_ELEMENTS.length + 1;
                    if (canPickElement && !isCheating) {
                        gameStatusRef.current = 'picking-element';
                        setGameStatus('picking-element');
                    } else {
                        setCurrentWave(nextWave);
                        isIntermissionRef.current = true;
                        countdownRef.current = INTERMISSION_TIME;
                        setWaveStartCountdown(INTERMISSION_TIME);
                        lastCountdownUpdateTime = now;
                    }
                }
            }
            
            if (gameState.lives - livesLost <= 0) {
                handleGameEnd({ playerName: players[0].name, playerUid: user?.uid || 'local', date: new Date().toISOString(), difficulty, wave: currentWave, won: false, finalTowers: towersByCell });
            }

        };

        gameLoopRef.current = requestAnimationFrame(simulate);
        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener('beforeunload', saveGameState);
            if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
        };
    }, [currentPath, handleGameEnd, saveGameState, players, currentWave, difficulty, isCheating, user, gameState.lives, startWave, renderVfx]);

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
            isIntermission={isIntermissionRef.current} setIsIntermission={(val) => isIntermissionRef.current = val}
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
