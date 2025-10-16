
"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Header from '@/components/game/header';
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

import { useIsMobile } from '@/hooks/use-mobile';
import { DesktopLayout } from '@/components/layouts/desktop-layout';
import { MobileLayout } from '@/components/layouts/mobile-layout';
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ElementPickDialog } from '@/components/game/element-pick-dialog';
import ScoreboardMiniMap from './ScoreboardMiniMap';


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
    const [players, setPlayers] = useState<Player[]>([]);
    const [gameState, setGameState] = useState<GameState>({ lives: 20 });
    const [gameStatus, setGameStatus] = useState<GameStatus>('playing');
    const [difficulty, setDifficulty] = useState<Difficulty>(initialDifficulty);
    const [isIntermission, setIsIntermission] = useState(true);
    const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);
    const [currentWave, setCurrentWave] = useState(0);
    const [towersByCell, setTowersByCell] = useState<Record<string, PlacedTower>>({});
    const [selectedTowerToBuild, setSelectedTowerToBuild] = useState<Tower | null>(null);
    const [focusedTower, setFocusedTower] = useState<PlacedTower | null>(null);
    const [finalGameResult, setFinalGameResult] = useState<GameResult | null>(null);
    const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string|null>(null);
    const [justPlacedTowerId, setJustPlacedTowerId] = useState<string | null>(null);
    const [renderTick, setRenderTick] = useState(0);

    // --- Refs for state that should NOT cause re-renders within the loop ---
    const enemiesRef = useRef<Enemy[]>([]);
    const attacksRef = useRef<Attack[]>([]);
    const damageNumbersRef = useRef<DamageNumber[]>([]);
    const splashRingsRef = useRef<SplashRing[]>([]);
    const firingTowerIdsRef = useRef<Set<string>>(new Set());
    const totalKilledRef = useRef(0);
    const totalLeakedRef = useRef(0);
    const spawnedThisWaveRef = useRef(0);
    const fpsRef = useRef(0);
    
    // --- Refs for game loop logic ---
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

    const playersRef = useRef(players);
    useEffect(() => { playersRef.current = players; }, [players]);
    
    const gameStateRef = useRef(gameState);
    useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

    const towersByCellRef = useRef(towersByCell);
    useEffect(() => { towersByCellRef.current = towersByCell; }, [towersByCell]);

    const currentPathRef = useRef(currentPath);
    useEffect(() => { currentPathRef.current = currentPath; }, [currentPath]);
    
    const saveGameState = useCallback(() => {
        if (gameStatus === 'gameover' || isCheating) return;
        const stateToSave: GameSaveState = {
            players: { player1: playersRef.current[0], player2: null },
            gameState: gameStateRef.current, 
            towersByCell: towersByCellRef.current, 
            enemies: enemiesRef.current, 
            currentWave, 
            difficulty
        };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stateToSave));
        toast({ title: 'Spiel gespeichert!' });
    }, [currentWave, difficulty, toast, isCheating, gameStatus]);
    
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
            enemiesRef.current = initialSavedGame.enemies;
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
             const existingTower = Object.values(towersByCellRef.current).find(t => t.position.row === row && t.position.col === col);
             if (existingTower) {
                setFocusedTower(existingTower);
             }
            return;
        }
    
        const cellKey = `${row}_${col}`;
        const existingTower = towersByCellRef.current[cellKey];
        if (existingTower) {
            setFocusedTower(existingTower);
            return;
        }
    
        const currentPlacedTowers = Object.values(towersByCellRef.current).map(t => t.position);
        if (!findPath(START_NODE, END_NODE, [...currentPlacedTowers, {row, col}], GRID_ROWS, GRID_COLS)) {
             toast({ title: "Bau fehlgeschlagen", description: "Der Weg für die Gegner darf nicht blockiert werden.", variant: 'destructive' });
            return;
        }

        const player = playersRef.current[0];
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
    
        towersByCellRef.current[cellKey] = newTower;
        setTowersByCell({ ...towersByCellRef.current });

        setPlayers(prevPlayers => prevPlayers.map(p => p.id === player.id ? { ...p, resources: p.resources - newTower.cost } : p));
        setJustPlacedTowerId(newTower.id);
        setTimeout(() => setJustPlacedTowerId(null), 1000);
        audioManager.playSfx('build_tower');
            
    }, [selectedTowerToBuild, toast, START_NODE, END_NODE]);
    
    const handleUpgradeTower = useCallback((upgradeId: string) => {
        const player = playersRef.current[0];
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
    
        towersByCellRef.current[cellKey] = newPlacedTower;
        setTowersByCell({ ...towersByCellRef.current });

        setPlayers(prevPlayers => prevPlayers.map(p => p.id === player.id ? { ...p, resources: p.resources - cost } : p));
        setLastUpgradedTowerId(newPlacedTower.id);
        setTimeout(() => setLastUpgradedTowerId(null), 1000);
        setFocusedTower(null);
        audioManager.playSfx('build_tower');
    }, [focusedTower, difficulty, toast]);
    
    const handleSellTower = useCallback(() => {
        const player = playersRef.current[0];
        if (!player || !focusedTower) return;
    
        const refundPercentage = difficulty === 'Einfach' ? 1.0 : 0.75;
        const refund = Math.round(focusedTower.cost * refundPercentage);
        const cellKey = `${focusedTower.position.row}_${focusedTower.position.col}`;
    
        delete towersByCellRef.current[cellKey];
        setTowersByCell({ ...towersByCellRef.current });
        
        setPlayers(prevPlayers => prevPlayers.map(p => p.id === player.id ? { ...p, resources: p.resources + refund } : p));
        setFocusedTower(null);
        audioManager.playSfx('build_tower');
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
        if (tower && playersRef.current[0].resources < tower.cost) {
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
                playerName: playersRef.current[0]?.name || 'Spieler',
                playerUid: user?.uid || 'anonymous',
                date: new Date().toISOString(),
                difficulty, wave: currentWave, won: false,
                finalTowers: towersByCellRef.current
            });
        }
    }, [gameState.lives, currentWave, difficulty, user, handleGameEnd]);

    useEffect(() => {
        if (gameStatus === 'playing' && !isIntermission) {
            audioManager.playWaveMusic();
        }
    }, [gameStatus, isIntermission]);

    useEffect(() => {
        let isTabVisible = true;
        const handleVisibilityChange = () => {
            isTabVisible = document.visibilityState === 'visible';
            if (isTabVisible && gameStatus === 'playing' && !isIntermission) {
                lastTickRef.current = performance.now();
            }
        };
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
            fpsRef.current = Math.round(1000/delta);
        
            const difficultyMod = difficultyModifiers[difficulty];

            // 1. Enemy Spawning
            if (!spawnerStateRef.current) {
                const waveData = waves[currentWave];
                if (waveData) {
                    spawnerStateRef.current = { count: 0, timer: 0, waveData: waveData.enemies };
                    spawnedThisWaveRef.current = 0;
                }
            }
            
            if (spawnerStateRef.current && currentPathRef.current.length > 0) {
                spawnerStateRef.current.timer += delta;
                if (spawnerStateRef.current.timer >= spawnerStateRef.current.waveData.spawnDelay) {
                    if (spawnerStateRef.current.count < spawnerStateRef.current.waveData.count) {
                        spawnerStateRef.current.timer = 0;
                        const health = isCheating ? spawnerStateRef.current.waveData.health : Math.round(spawnerStateRef.current.waveData.health * difficultyMod.enemyHealth);
                        const movementPattern: Enemy['movementPattern'] = spawnerStateRef.current.waveData.type === 'schnell' ? 'zigzag' : ((spawnerStateRef.current.waveData.type === 'gepanzert' || spawnerStateRef.current.waveData.type === 'boss') ? 'straight' : 'wobble');
                        
                        const newEnemy: Enemy = {
                            id: `enemy-${enemyIdCounter.current++}`, ...spawnerStateRef.current.waveData, health, maxHealth: health,
                            path: currentPathRef.current, pathIndex: 0, position: START_NODE, isBlocked: false, effects: [],
                            lastMove: now, wasHit: false, targetNode: END_NODE, movementPattern
                        };
                        enemiesRef.current.push(newEnemy);
                        spawnedThisWaveRef.current++;
                        spawnerStateRef.current.count++;
                    }
                }
            }

            const newAttacks: Attack[] = [];
            const newDamageNumbers: DamageNumber[] = [];
            const currentTowers = towersByCellRef.current;
            const currentFiringIds = new Set(firingTowerIdsRef.current);

            Object.values(currentTowers).forEach(tower => {
                if (now - tower.lastAttack >= tower.attackSpeed) {
                    const targets = enemiesRef.current.filter(e => {
                        const towerPos = { x: tower.position.col, y: tower.position.row };
                        const enemyPos = { x: e.position.col, y: e.position.row };
                        const distSq = (towerPos.x - enemyPos.x) ** 2 + (towerPos.y - enemyPos.y) ** 2;
                        return distSq <= tower.range ** 2;
                    });

                    if (targets.length > 0) {
                        const mainTarget = targets.sort((a,b) => b.pathIndex - a.pathIndex)[0];
                        tower.lastAttack = now;
                        currentFiringIds.add(tower.id);
                        setTimeout(() => firingTowerIdsRef.current.delete(tower.id), 150);

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

            let playerResourcesToAdd = 0;
            const stillAliveEnemies = enemiesRef.current.map(enemy => {
                let newHealth = enemy.health;
                newAttacks.forEach(attack => {
                    if (attack.targetId === enemy.id) {
                        const tower = Object.values(currentTowers).find(t => t.id === attack.towerId);
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
                    totalKilledRef.current++;
                    return null;
                }

                const isStunned = enemy.effects.some(e => e.type === 'stun' && e.expires > now);
                 if (!isStunned) {
                    const slowEffect = enemy.effects.find(e => e.type === 'slow' && e.expires > now);
                    const effectiveSpeed = enemy.speed * (slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1);
                    const timeSinceMove = now - enemy.lastMove;
                    
                    if (timeSinceMove / (1000 / effectiveSpeed) >= 1) {
                         if (enemy.pathIndex < currentPathRef.current.length - 1) {
                            return {...enemy, health: newHealth, pathIndex: enemy.pathIndex + 1, lastMove: now, position: currentPathRef.current[enemy.pathIndex+1]};
                        } else {
                            totalLeakedRef.current++;
                            setGameState(g => ({...g, lives: Math.max(0, g.lives - 1)}));
                            return null;
                        }
                    }
                 }
                return { ...enemy, health: newHealth };
            }).filter(Boolean) as Enemy[];

            if (playerResourcesToAdd > 0) {
                setPlayers(prev => prev.map(p => ({...p, resources: p.resources + playerResourcesToAdd})));
            }
            
            enemiesRef.current = stillAliveEnemies;
            if(newAttacks.length > 0) attacksRef.current = [...attacksRef.current.slice(-200), ...newAttacks];
            if(newDamageNumbers.length > 0) damageNumbersRef.current = [...damageNumbersRef.current.slice(-100), ...newDamageNumbers];
            firingTowerIdsRef.current = currentFiringIds;

            if (spawnerStateRef.current && spawnerStateRef.current.count >= spawnerStateRef.current.waveData.count && enemiesRef.current.length === 0) {
                spawnerStateRef.current = null;
                const nextWave = currentWave + 1;
                
                if (nextWave >= waves.length) {
                    handleGameEnd({ playerName: playersRef.current[0]?.name || 'Spieler', playerUid: user?.uid || 'anonymous', date: new Date().toISOString(), difficulty: difficulty, wave: waves.length, won: true, finalTowers: towersByCellRef.current });
                } else {
                    if (nextWave > 0 && nextWave % 5 === 0 && ALL_PICKABLE_ELEMENTS.some(e => !playersRef.current[0].unlockedElements.includes(e))) {
                        setGameStatus('picking-element');
                    } else {
                        setCurrentWave(nextWave);
                        setIsIntermission(true);
                        setWaveStartCountdown(INTERMISSION_TIME);
                    }
                }
            }
            setRenderTick(t => t + 1);
        };
        
        gameLoopRef.current = requestAnimationFrame(gameLoop);

        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
        };
    }, [gameStatus, isIntermission, handleGameEnd, user, isCheating, difficulty, currentWave]);
    
    const isMobile = useIsMobile();
    const LayoutComponent = isMobile ? MobileLayout : DesktopLayout;

    if (players.length === 0) {
        return <div className="flex items-center justify-center h-full"><Loader2 className="h-16 w-16 animate-spin text-primary" /></div>
    }

    return (
        <div className="flex flex-col h-full bg-background text-foreground font-body">
            <Header 
                isMobile={isMobile} 
                onExit={() => { saveGameState(); onExit(); }}
                fps={fpsRef.current}
                isMuted={audioManager.isMuted}
                toggleMute={() => {
                  if (audioManager.isMuted) audioManager.unmute();
                  else audioManager.mute();
                  setRenderTick(t => t+1); // force re-render to show mute state
                }}
            />
            <main className="flex-grow md:p-6 h-[calc(100%-69px)]">
                <LayoutComponent
                    players={players}
                    setPlayers={setPlayers}
                    gameState={gameState}
                    localPlayer={players[0]}
                    currentWave={currentWave}
                    totalWaves={waves.length}
                    difficulty={difficulty}
                    handleGameControl={handleGameControl}
                    gameStatus={gameStatus}
                    resetGame={() => { onExit(); }}
                    towers={initialTowers}
                    setTowers={() => {}}
                    placedTowers={Object.values(towersByCell)}
                    enemies={enemiesRef.current}
                    attacks={attacksRef.current}
                    damageNumbers={damageNumbersRef.current}
                    splashRings={splashRingsRef.current}
                    currentPath={currentPath}
                    handlePlaceTower={handlePlaceTower}
                    onFocusTower={setFocusedTower}
                    selectedTowerToBuild={selectedTowerToBuild}
                    focusedTower={focusedTower}
                    rows={GRID_ROWS}
                    cols={GRID_COLS}
                    startNode={START_NODE}
                    endNode={END_NODE}
                    interactionPrompt={selectedTowerToBuild ? 'Wähle Bauplatz' : focusedTower ? 'Upgrade/Verkauf' : 'Wähle einen Turm'}
                    cancelInteractions={cancelInteractions}
                    onSelectTowerToBuild={handleSelectTowerToBuild}
                    handleUpgradeTower={handleUpgradeTower}
                    handleSellTower={handleSellTower}
                    setFocusedTower={setFocusedTower}
                    spawnedThisWave={spawnedThisWaveRef.current}
                    totalEnemiesInWave={waves[currentWave]?.enemies.count || 0}
                    totalKilled={totalKilledRef.current}
                    totalLeaked={totalLeakedRef.current}
                    isIntermission={isIntermission}
                    waveStartCountdown={waveStartCountdown}
                    intermissionTime={INTERMISSION_TIME}
                    handleStartNextWaveNow={handleStartNextWaveNow}
                    lastUpgradedTowerId={lastUpgradedTowerId}
                    justPlacedTowerId={justPlacedTowerId}
                    isCoop={false}
                    playerRole="player1"
                    handleLoadTestLayout={handleLoadTestLayout}
                    handleLoadAllTowersLayout={handleLoadAllTowersLayout}
                    isCheating={isCheating}
                    cheat_addResources={() => setPlayers(prev => prev.map(p => ({...p, resources: p.resources + 10000})))}
                    cheat_skipWaves={() => setCurrentWave(prev => Math.min(prev + 5, waves.length -1))}
                    cheat_heal={() => setGameState(prev => ({...prev, lives: difficultyModifiers[difficulty].startLives}))}
                    cheat_unlockAll={() => setPlayers(prev => prev.map(p => ({...p, unlockedElements: [...ALL_PICKABLE_ELEMENTS, 'neutral']})))}
                    firingTowerIds={firingTowerIdsRef.current}
                    allTowers={initialTowers}
                />
            </main>
      
          <AlertDialog open={gameStatus === 'gameover'}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{gameState.lives > 0 ? "Sieg!" : "Game Over"}</AlertDialogTitle>
                <AlertDialogDescription>
                  {gameState.lives <= 0 ? "Du hast alle Leben verloren." : "Herzlichen Glückwunsch, du hast alle Wellen besiegt!"} Du hast Welle {currentWave + 1} erreicht.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {finalGameResult?.finalTowers && (
                 <div className="flex flex-col items-center gap-2">
                    <p className="text-sm font-semibold text-muted-foreground">Dein finales Spielfeld:</p>
                    <ScoreboardMiniMap towersByCell={finalGameResult.finalTowers} />
                 </div>
              )}
              <AlertDialogFooter>
                <AlertDialogAction onClick={() => onExit()}>Zum Hauptmenü</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
      
          {players[0] && <ElementPickDialog
            isOpen={gameStatus === 'picking-element'}
            unlockedElements={new Set(players[0].unlockedElements)}
            onElementPick={handleElementPick}
            playerName={players[0].name}
            currentWave={currentWave}
          />}
    </div>
    )
}
