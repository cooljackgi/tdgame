

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

    // --- Core Game State (React for UI) ---
    const [players, setPlayers] = useState<Player[]>([]);
    const [gameState, setGameState] = useState<GameState>({ lives: 20 });
    const [towersByCell, setTowersByCell] = useState<Record<string, PlacedTower>>({});
    const [enemies, setEnemies] = useState<Enemy[]>([]);
    const [currentWave, setCurrentWave] = useState(0);
    const [gameStatus, setGameStatus] = useState<GameStatus>('playing');
    const [difficulty, setDifficulty] = useState<Difficulty>(initialDifficulty);
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
    const [totalKilled, setTotalKilled] = useState(0);
    const [totalLeaked, setTotalLeaked] = useState(0);
    
    // --- Refs for Game Loop (to avoid re-renders triggering loops) ---
    const gameLoopRef = useRef<number>();
    const lastTickRef = useRef(performance.now());
    const waveInProgressRef = useRef(false);
    const isIntermissionRef = useRef(true);
    const countdownRef = useRef(INTERMISSION_TIME);
    
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
        setGameStatus('playing');
        countdownRef.current = INTERMISSION_TIME;
        setWaveStartCountdown(INTERMISSION_TIME);
        setEnemies([]);
    }, [initialSavedGame, isCheating, startWithTutorial, initialDifficulty, user, difficulty]);

    const handlePlaceTower = useCallback((row: number, col: number) => {
        const player = players[0];
        if (!player || !selectedTowerToBuild) {
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
            if (prev === 'playing') return 'paused';
            if (prev === 'paused') return 'playing';
            return prev;
        });
    }, []);

    const handleStartNextWaveNow = useCallback(() => {
        if (isIntermissionRef.current && gameStatus === 'playing') {
            isIntermissionRef.current = false;
            countdownRef.current = 0;
            setWaveStartCountdown(0);
            waveInProgressRef.current = true;
        }
    }, [gameStatus]);

    // Main Game Loop using requestAnimationFrame
    useEffect(() => {
        let isTabVisible = true;
        const handleVisibilityChange = () => { isTabVisible = document.visibilityState === 'visible'; };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener('beforeunload', saveGameState);

        let enemyIdCounter = 0;

        const startWave = () => {
            setSpawnedThisWave(0);
            audioManager.playWaveMusic();

            let spawnedCount = 0;
            let lastSpawnTime = performance.now();
            const waveData = waves[currentWave];
            if (!waveData) return;
    
            const spawnEnemy = (now: number) => {
                if (gameStatus !== 'playing') return;
                if (spawnedCount >= waveData.enemies.count) return;

                if (now - lastSpawnTime > waveData.enemies.spawnDelay) {
                    lastSpawnTime = now;
                    const difficultyMod = difficultyModifiers[difficulty];
                    const health = isCheating ? waveData.enemies.health : Math.round(waveData.enemies.health * difficultyMod.enemyHealth);
                    const movementPattern: MovementPattern = waveData.enemies.type === 'schnell' ? 'zigzag' : ((waveData.enemies.type === 'gepanzert' || waveData.enemies.type === 'boss') ? 'straight' : 'wobble');

                    const newEnemy: Enemy = {
                        id: `enemy-${enemyIdCounter++}`, ...waveData.enemies, health, maxHealth: health,
                        path: currentPath, pathIndex: 0, position: START_NODE, isBlocked: false, effects: [],
                        lastMove: now, wasHit: false, targetNode: END_NODE, movementPattern
                    };
                    
                    setEnemies(prev => [...prev, newEnemy]);
                    setSpawnedThisWave(c => c + 1);
                    spawnedCount++;
                }
            };
            return spawnEnemy;
        }

        let currentSpawner: ((now: number) => void) | null = null;
        let lastCountdownUpdateTime = 0;

        const simulate = (now: number) => {
            gameLoopRef.current = requestAnimationFrame(simulate);

            const delta = now - lastTickRef.current;
            if (delta < 1000 / 65) return;
            lastTickRef.current = now;
            setFps(Math.round(1000 / delta));

            if (gameStatus !== 'playing' || !isTabVisible) {
                return;
            }
            
            if (isIntermissionRef.current) {
                 if (now - lastCountdownUpdateTime > 1000) {
                    lastCountdownUpdateTime = now;
                    countdownRef.current -= 1;
                    setWaveStartCountdown(countdownRef.current);
                    if (countdownRef.current <= 0) {
                        handleStartNextWaveNow();
                    }
                }
                return;
            }

            if (waveInProgressRef.current && !currentSpawner) {
                currentSpawner = startWave();
            }
            if (currentSpawner) {
                currentSpawner(now);
            }

            let livesLostThisTick = 0;
            let resourcesGained = 0;
            const newAttacks: Attack[] = [];
            const newDamageNumbers: DamageNumber[] = [];
            const towers = Object.values(towersByCell);
            
            const updatedHitEffects = new Map<string, boolean>();

            const updatedEnemies = enemies.map(enemy => {
                if (enemy.health <= 0) {
                    resourcesGained += enemy.bounty;
                    setTotalKilled(k => k + 1);
                    return null;
                }

                let activeEffects = enemy.effects.filter(e => e.expires > now);
                let isStunned = activeEffects.some(e => e.type === 'stun');
                
                let newPathIndex = enemy.pathIndex;
                let newLastMove = enemy.lastMove;

                if (!isStunned) {
                    const slowEffect = activeEffects.find(e => e.type === 'slow');
                    const effectiveSpeed = enemy.speed * (slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1);
                    if (now - enemy.lastMove > 1000 / effectiveSpeed) {
                        if (enemy.pathIndex < currentPath.length - 1) {
                            newPathIndex++;
                            newLastMove = now;
                        } else {
                            livesLostThisTick++;
                            setTotalLeaked(l => l + 1);
                            return null;
                        }
                    }
                }
                
                return { ...enemy, pathIndex: newPathIndex, lastMove: newLastMove, effects: activeEffects, wasHit: false };
            }).filter(Boolean) as Enemy[];

            towers.forEach(tower => {
                if (now - tower.lastAttack > tower.attackSpeed) {
                    const enemiesInRange = updatedEnemies.filter(e => Math.hypot(e.position.row - tower.position.row, e.position.col - tower.position.col) <= tower.range);
                    if (enemiesInRange.length > 0) {
                        const mainTarget = enemiesInRange[0];
                        const projectileType = tower.specId.includes('-1a') || tower.specId.includes('-2a') ? 'arrow' : 'beam';
                        newAttacks.push({ id: `attack-${now}-${Math.random()}`, towerId: tower.id, targetId: mainTarget.id, elements: tower.elements, projectile: projectileType });
                        
                        let damage = tower.damage;
                        let isCrit = false;
                        if (tower.effect?.type === 'crit' && Math.random() < (tower.effect.chance ?? 0)) {
                            damage *= (tower.effect.potency ?? 1);
                            isCrit = true;
                        }
                        
                        const targetIndex = updatedEnemies.findIndex(e => e.id === mainTarget.id);
                        if(targetIndex > -1) {
                            updatedEnemies[targetIndex].health -= damage;
                            updatedHitEffects.set(mainTarget.id, true);
                        }

                        newDamageNumbers.push({ id: `dn-${now}-${Math.random()}`, amount: damage, position: mainTarget.position, color: isCrit ? '#fde047' : '#ffffff', isCrit });
                        
                        tower.lastAttack = now;
                    }
                }
            });

            updatedEnemies.forEach(e => {
                if(updatedHitEffects.has(e.id)) {
                    e.wasHit = true;
                }
            });

            if (newAttacks.length > 0) setAttacks(prev => [...prev.slice(-200), ...newAttacks]);
            if (newDamageNumbers.length > 0) setDamageNumbers(prev => [...prev.slice(-100), ...newDamageNumbers]);
            setEnemies(updatedEnemies);

            if (livesLostThisTick > 0) {
                setGameState(prev => ({ ...prev, lives: Math.max(0, prev.lives - livesLostThisTick) }));
            }
             if (gameState.lives - livesLostThisTick <= 0) {
                handleGameEnd({ playerName: players[0].name, playerUid: user?.uid || 'local', date: new Date().toISOString(), difficulty, wave: currentWave, won: false, finalTowers: towersByCell });
            }

            if (resourcesGained > 0) {
                setPlayers(prev => prev.map(p => ({ ...p, resources: p.resources + resourcesGained })));
            }

            const waveData = waves[currentWave];
            const totalEnemiesInWave = waveData?.enemies.count || 0;
            if (waveInProgressRef.current && spawnedThisWave >= totalEnemiesInWave && updatedEnemies.length === 0) {
                waveInProgressRef.current = false;
                currentSpawner = null;
                const nextWave = currentWave + 1;
                if (nextWave >= waves.length) {
                    handleGameEnd({ playerName: players[0].name, playerUid: user?.uid || 'local', date: new Date().toISOString(), difficulty, wave: nextWave, won: true, finalTowers: towersByCell });
                } else {
                    const canPickElement = nextWave > 0 && nextWave % 5 === 0 && players[0].unlockedElements.length < ALL_PICKABLE_ELEMENTS.length + 1;
                    if (canPickElement && !isCheating) {
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
        };

        gameLoopRef.current = requestAnimationFrame(simulate);
        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener('beforeunload', saveGameState);
            if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
        };
    }, [gameStatus, currentPath, handleGameEnd, saveGameState, towersByCell, enemies, players, currentWave, difficulty, isCheating, user, gameState.lives, spawnedThisWave]);

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
            totalKilled={totalKilled}
            totalLeaked={totalLeaked}
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
        />
    )
}

    