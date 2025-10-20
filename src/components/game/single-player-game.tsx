

'use client';

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import type { Difficulty, GameSaveState, User, Player, GameState, PlacedTower, Tower, Node, Element, Enemy, Attack, DamageNumber, SplashRing, MovementPattern } from '@/lib/game-data/types';
import { towers as initialTowers } from '@/lib/game-data/towers';
import { waves } from '@/lib/game-data/enemies';
import { difficultyModifiers, GRID_COLS, GRID_ROWS, LOCAL_STORAGE_KEY, INTERMISSION_TIME, ALL_PICKABLE_ELEMENTS } from '@/lib/game-data/constants';
import { findPath } from '@/lib/pathfinding';
import { useToast } from '@/hooks/use-toast';
import { audioManager } from '@/lib/audio/audio-manager';
import type { GameBoardHandle } from './game-board';
import { useIsMobile } from '@/hooks/use-mobile';
import { DesktopLayout } from '@/components/layouts/desktop-layout';
import { MobileLayout } from '@/components/layouts/mobile-layout';
import { ElementPickDialog } from './element-pick-dialog';
import { onGameEnd, processAttack } from '@/lib/game-logic';
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import ScoreboardMiniMap from './ScoreboardMiniMap';
import Header from './header';


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
    const isMobile = useIsMobile();

    // --- Core Game State ---
    const [players, setPlayers] = useState<Player[]>([]);
    const [gameState, setGameState] = useState<GameState>({ lives: 20 });
    const [towersByCell, setTowersByCell] = useState<Record<string, PlacedTower>>({});
    const [currentWave, setCurrentWave] = useState(0);
    const [difficulty, setDifficulty] = useState(initialDifficulty);
    const [enemies, setEnemies] = useState<Enemy[]>([]);
    const [gameStatus, setGameStatus] = useState<"waiting" | "playing" | "paused" | "gameover" | "picking-element">('playing');
    const [currentPath, setCurrentPath] = useState<Node[]>([]);
    const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);
    const [isIntermission, setIsIntermission] = useState(true);

    // --- UI/Interaction State ---
    const [selectedTowerToBuild, setSelectedTowerToBuild] = useState<Tower | null>(null);
    const [justPlacedTowerId, setJustPlacedTowerId] = useState<string | null>(null);
    const [focusedTower, setFocusedTower] = useState<PlacedTower | null>(null);
    const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string | null>(null);
    const [hasInteracted, setHasInteracted] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [finalGameResult, setFinalGameResult] = useState<any | null>(null);


    // --- VFX State ---
    const [attacks, setAttacks] = useState<Attack[]>([]);
    const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
    const [splashRings, setSplashRings] = useState<SplashRing[]>([]);
    const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());
    
    // --- Stats State ---
    const [totalKilled, setTotalKilled] = useState(0);
    const [totalLeaked, setTotalLeaked] = useState(0);

    // --- Game Loop Refs ---
    const gameLoopRef = useRef<number>();
    const lastTickRef = useRef(performance.now());
    const enemyIdCounter = useRef(0);
    const gameBoardRef = useRef<GameBoardHandle>(null);
    const spawnQueueRef = useRef<any[]>([]);
    const waveStartTimeRef = useRef<number>(0);


    // --- Refs for stable access in game loop ---
    const playersRef = useRef(players);
    const towersByCellRef = useRef(towersByCell);
    const enemiesRef = useRef(enemies);
    const gameStateRef = useRef(gameState);
    const currentWaveRef = useRef(currentWave);
    const difficultyRef = useRef(difficulty);
    const gameStatusRef = useRef(gameStatus);
    const localPlayerRef = useRef<Player | undefined>(undefined);
    const currentPathRef = useRef(currentPath);
    const isIntermissionRef = useRef(isIntermission);


    useEffect(() => { playersRef.current = players; localPlayerRef.current = players[0]; }, [players]);
    useEffect(() => { towersByCellRef.current = towersByCell; }, [towersByCell]);
    useEffect(() => { enemiesRef.current = enemies; }, [enemies]);
    useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
    useEffect(() => { currentWaveRef.current = currentWave; }, [currentWave]);
    useEffect(() => { difficultyRef.current = difficulty; }, [difficulty]);
    useEffect(() => { gameStatusRef.current = gameStatus; }, [gameStatus]);
    useEffect(() => { currentPathRef.current = currentPath; }, [currentPath]);
    useEffect(() => { isIntermissionRef.current = isIntermission; }, [isIntermission]);


    useEffect(() => {
        if (initialSavedGame) {
            const now = performance.now();
            const loadedTowers = initialSavedGame.towersByCell;
            for (const key in loadedTowers) {
                loadedTowers[key].lastAttack = now - (loadedTowers[key].attackSpeed + Math.random() * 500); 
            }

            setPlayers([initialSavedGame.players.player1]);
            setGameState(initialSavedGame.gameState);
            setTowersByCell(loadedTowers);
            setEnemies(initialSavedGame.enemies);
            setCurrentWave(initialSavedGame.currentWave);
            setDifficulty(initialSavedGame.difficulty);
            setGameStatus('playing');
            // If the saved game has no enemies and is not in intermission, it means a wave just ended.
            // Start the next intermission.
            if (initialSavedGame.enemies.length === 0) {
                 setIsIntermission(true);
                 setWaveStartCountdown(INTERMISSION_TIME);
            }
            const path = findPath({row:1,col:1},{row:GRID_ROWS,col:GRID_COLS}, Object.values(initialSavedGame.towersByCell).map(t => t.position), GRID_ROWS, GRID_COLS) ?? [];
            setCurrentPath(path);
        } else {
            const difficultyMod = difficultyModifiers[initialDifficulty];
            const player1: Player = {
                id: 'player1',
                name: user?.displayName || 'Spieler 1',
                avatarUrl: user?.photoURL || null,
                resources: difficultyMod.startResources,
                unlockedElements: ['neutral'],
            };

            setPlayers([player1]);
            setGameState({ lives: difficultyMod.startLives });
            setTowersByCell({});
            setEnemies([]);
            setCurrentWave(0);
            setDifficulty(initialDifficulty);
            setGameStatus('playing');
            setIsIntermission(true);
            setWaveStartCountdown(INTERMISSION_TIME);
            setCurrentPath(findPath({row:1,col:1},{row:GRID_ROWS,col:GRID_COLS}, [], GRID_ROWS, GRID_COLS) ?? []);
        }
    }, [initialSavedGame, initialDifficulty, user]);
    
    // Auto-save game state on unload
    useEffect(() => {
        const saveGame = () => {
            if (isCheating || gameStatusRef.current !== 'playing') {
                localStorage.removeItem(LOCAL_STORAGE_KEY);
                return;
            }
            
            const player1 = playersRef.current[0];
            if (!player1) return;

            const saveState: GameSaveState = {
                players: { player1, player2: null },
                gameState: gameStateRef.current,
                towersByCell: towersByCellRef.current,
                enemies: enemiesRef.current,
                currentWave: currentWaveRef.current,
                difficulty: difficultyRef.current,
            };
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(saveState));
        };
        
        window.addEventListener('beforeunload', saveGame);
        
        return () => {
            saveGame();
            window.removeEventListener('beforeunload', saveGame);
        };
    }, [isCheating]);

    const placedTowers = useMemo(() => Object.values(towersByCell), [towersByCell]);
    const localPlayer = useMemo(() => players.find(p => p.id === 'player1'), [players]);
    const LayoutComponent = useMemo(() => isMobile ? MobileLayout : DesktopLayout, [isMobile]);
    
    const buffedTowerIds = useMemo(() => {
        const ids = new Set<string>();
        const auraTowers = placedTowers.filter(t => t.effect?.type === 'aura');
        if (auraTowers.length === 0) return ids;

        placedTowers.forEach(tower => {
          if (tower.effect?.type === 'aura') return;
          for (const auraTower of auraTowers) {
            const distSq = Math.pow(tower.position.col - auraTower.position.col, 2) + Math.pow(tower.position.row - auraTower.position.row, 2);
            if (distSq <= Math.pow(auraTower.effect!.radius!, 2)) {
              ids.add(tower.id);
              break;
            }
          }
        });
        return ids;
    }, [placedTowers]);

    const handleGameEnd = useCallback(async (won: boolean) => {
        if(gameStatusRef.current === 'gameover') return;
        setGameStatus('gameover');
        
        const result = { 
            playerName: localPlayerRef.current?.name || 'Spieler', 
            playerUid: user?.uid || 'anonymous', 
            difficulty: difficultyRef.current, 
            wave: currentWaveRef.current + 1, 
            won, 
            finalTowers: towersByCellRef.current 
        };
        
        if (!isCheating) {
            localStorage.removeItem(LOCAL_STORAGE_KEY);
            if (user?.uid) {
                 try {
                    await onGameEnd(`sp-${user.uid}-${Date.now()}`, user, result.difficulty, result.wave, won, result.finalTowers);
                } catch(e) { console.error("Failed to save score", e); }
            }
        }
        setFinalGameResult({ ...result, date: new Date().toISOString() });
    }, [isCheating, user]);

    const handleStartNextWaveNow = useCallback(() => {
        const waveData = waves[currentWaveRef.current];
        if (!waveData) return;

        const difficultyMod = difficultyModifiers[difficultyRef.current];
        const enemiesToSpawn = Array.from({ length: waveData.enemies.count }).map((_, i) => {
            const health = Math.round(waveData.enemies.health * difficultyMod.enemyHealth);
            return {
                id: `enemy-${currentWaveRef.current}-${enemyIdCounter.current++}`,
                type: waveData.enemies.type,
                health: health,
                maxHealth: health,
                armor: waveData.enemies.armor,
                speed: waveData.enemies.speed,
                damage: waveData.enemies.damage,
                bounty: waveData.enemies.bounty,
                path: currentPathRef.current,
                pathIndex: 0,
                position: { row: 1, col: 1 },
                isBlocked: false,
                effects: [],
                lastMove: 0, // Will be set on actual spawn
                wasHit: false,
                targetNode: { row: GRID_ROWS, col: GRID_COLS },
                movementPattern: waveData.enemies.type === 'schnell' ? 'zigzag' : 'wobble',
                _spawnTime: i * waveData.enemies.spawnDelay,
            };
        });
        
        spawnQueueRef.current = enemiesToSpawn;
        waveStartTimeRef.current = Date.now();
        setIsIntermission(false);
        setWaveStartCountdown(0);
        audioManager.playWaveMusic();
    }, []);
    
    const handlePlaceTower = useCallback((row: number, col: number) => {
        if (!selectedTowerToBuild) return;

        const player = localPlayerRef.current;
        const towerSpec = initialTowers.find(t => t.id === selectedTowerToBuild.id);

        if (!player || !towerSpec) return;

        const currentTowers = Object.values(towersByCellRef.current);
        const cellKey = `${row}_${col}`;

        if (currentTowers.some(t => t.position.row === row && t.position.col === col)) return;
        if ((row === 1 && col === 1) || (row === GRID_ROWS && col === GRID_COLS)) return;
        if (player.resources < towerSpec.cost) {
            toast({ title: 'Nicht genügend Ressourcen', variant: 'destructive'});
            return;
        }

        const newBlockedPositions = [...currentTowers.map(t => t.position), { row, col }];
        const path = findPath({ row: 1, col: 1 }, { row: GRID_ROWS, col: GRID_COLS }, newBlockedPositions, GRID_ROWS, GRID_COLS);
        if (!path) {
            toast({ title: 'Pfad blockiert', description: 'Du kannst den Weg für die Gegner nicht komplett blockieren.', variant: 'destructive'});
            return;
        }
        
        const newTower: PlacedTower = {
            ...towerSpec,
            id: `tower-${row}-${col}-${Date.now()}`,
            specId: towerSpec.id,
            position: { row, col },
            lastAttack: performance.now() - 99999,
            health: towerSpec.maxHealth,
            ownerId: player.id,
        };

        setTowersByCell(prev => ({ ...prev, [cellKey]: newTower }));
        setPlayers(prev => [{ ...prev[0], resources: prev[0].resources - towerSpec.cost }]);
        setCurrentPath(path);
        setEnemies(prevEnemies => prevEnemies.map(e => ({ ...e, path })));
        setJustPlacedTowerId(newTower.id);
        setTimeout(() => setJustPlacedTowerId(null), 500);

    }, [selectedTowerToBuild, toast]);

    const handleUpgradeTower = useCallback((upgradeId: string) => {
        const player = localPlayerRef.current;
        if (!player || !focusedTower) return;
        
        const cellKey = `${focusedTower.position.row}_${focusedTower.position.col}`;
        const upgradeTowerSpec = initialTowers.find(t => t.id === upgradeId);
        if (!upgradeTowerSpec) return;
        
        const refundPercentage = difficultyRef.current === 'Einfach' ? 1.0 : 0.75;
        const cost = Math.max(0, upgradeTowerSpec.cost - Math.floor(focusedTower.cost * refundPercentage));
        
        if (player.resources < cost) {
            toast({ title: 'Nicht genügend Ressourcen für das Upgrade.', variant: 'destructive' });
            return;
        }

        const newPlacedTower: PlacedTower = { 
            ...focusedTower, ...upgradeTowerSpec, specId: upgradeTowerSpec.id, health: upgradeTowerSpec.maxHealth, id: focusedTower.id 
        };
        
        setTowersByCell(prev => ({ ...prev, [cellKey]: newPlacedTower }));
        setPlayers(prev => [{ ...prev[0], resources: prev[0].resources - cost }]);
        setFocusedTower(newPlacedTower);
        setLastUpgradedTowerId(newPlacedTower.id);
        setTimeout(() => setLastUpgradedTowerId(null), 500);
    }, [toast, focusedTower]);

    const handleSellTower = useCallback(() => {
        const player = localPlayerRef.current;
        if (!player || !focusedTower) return;
        
        const cellKey = `${focusedTower.position.row}_${focusedTower.position.col}`;
        const refundPercentage = difficultyRef.current === 'Einfach' ? 1.0 : 0.75;
        const refund = Math.round(focusedTower.cost * refundPercentage);
        
        setTowersByCell(prev => { const newTowers = { ...prev }; delete newTowers[cellKey]; return newTowers; });
        setPlayers(prev => [{ ...prev[0], resources: prev[0].resources + refund }]);
        setFocusedTower(null);
    }, [focusedTower]);
    
    const handleElementPick = useCallback((element: Element) => {
        setPlayers(prev => [{ ...prev[0], unlockedElements: Array.from(new Set([...prev[0].unlockedElements, element])) }]);
        setCurrentWave(prev => prev + 1);
        setIsIntermission(true);
        setWaveStartCountdown(INTERMISSION_TIME);
        setGameStatus('playing');
    }, []);

    const onFocusTower = useCallback((tower: PlacedTower) => {
        setSelectedTowerToBuild(null);
        setFocusedTower(tower);
    }, []);
    
    const cancelInteractions = useCallback(() => {
        setSelectedTowerToBuild(null);
        setFocusedTower(null);
    }, []);

    const onSelectTowerToBuild = useCallback((tower: Tower | null) => {
        setFocusedTower(null);
        setSelectedTowerToBuild(tower);
    }, []);
    // --- CHEAT/DEBUG FUNCTIONS ---
    const generateLayout = useCallback((towersToPlace: Tower[]) => {
        const mazePath: Node[] = [
            // Lange vertikale Linien
            ...Array.from({ length: 9 }, (_, i) => ({ row: i + 2, col: 2 })),
            ...Array.from({ length: 10 }, (_, i) => ({ row: 11 - i, col: 4 })),
            ...Array.from({ length: 10 }, (_, i) => ({ row: i + 2, col: 6 })),
            ...Array.from({ length: 10 }, (_, i) => ({ row: 11 - i, col: 8 })),
            ...Array.from({ length: 10 }, (_, i) => ({ row: i + 2, col: 10 })),
            
            // Konnektoren, um den Weg zu zwingen
            { row: 11, col: 3 },
            { row: 2, col: 5 },
            { row: 11, col: 7 },
            { row: 2, col: 9 },
            { row: 11, col: 11 },
        ];

        const newTowersByCell: Record<string, PlacedTower> = {};
        const blockedPositions: Node[] = [];
        let towerIndex = 0;

        for (const pos of mazePath) {
            if (towerIndex >= towersToPlace.length) break;

            const towerSpec = towersToPlace[towerIndex % towersToPlace.length];
            const cellKey = `${pos.row}_${pos.col}`;

            newTowersByCell[cellKey] = {
                ...towerSpec,
                id: `tower-${pos.row}-${pos.col}-${Date.now() + towerIndex}`,
                specId: towerSpec.id,
                position: pos,
                lastAttack: 0,
                health: towerSpec.maxHealth,
                ownerId: 'player1',
            };
            blockedPositions.push(pos);
            towerIndex++;
        }

        setTowersByCell(newTowersByCell);
        const newPath = findPath({ row: 1, col: 1 }, { row: GRID_ROWS, col: GRID_COLS }, blockedPositions, GRID_ROWS, GRID_COLS) ?? [];
        setCurrentPath(newPath);
    }, []);

    const handleLoadTestLayout = useCallback(() => {
        const testTowers = initialTowers.filter(t => t.tier === 1 && t.id.includes("neutral-1a"));
        generateLayout(testTowers);
        toast({ title: 'Test-Layout geladen!', description: 'Ein Labyrinth aus Basistürmen wurde erstellt.' });
    }, [generateLayout, toast]);

    const handleLoadAllTowersLayout = useCallback(() => {
        generateLayout(initialTowers);
        toast({ title: 'Alle Türme geladen!', description: 'Jeder Turm wurde einmal im Labyrinth platziert.' });
    }, [generateLayout, toast]);

    const handleUnlockAll = useCallback(() => {
        setPlayers(prev => [{
            ...prev[0],
            resources: prev[0].resources + 50000,
            unlockedElements: ['neutral', ...ALL_PICKABLE_ELEMENTS]
        }]);
        toast({ title: 'Chaos aktiviert!', description: 'Alle Elemente freigeschaltet und 50,000 Ressourcen erhalten.' });
    }, [toast]);


    useEffect(() => {
        const gameLoop = () => {
            gameLoopRef.current = requestAnimationFrame(gameLoop);
            const now = Date.now();
            const delta = now - lastTickRef.current;
            if (delta < 16) return;
            lastTickRef.current = now;

            if (gameStatusRef.current !== 'playing') return;

            if (isIntermissionRef.current) {
                setWaveStartCountdown(prevTime => {
                    const newTime = prevTime - delta / 1000;
                    if (newTime <= 0) {
                        handleStartNextWaveNow();
                        return 0;
                    }
                    return newTime;
                });
                return; // No game logic during intermission
            }

            let currentEnemies = [...enemiesRef.current];

            // --- Spawning Logic ---
            const timeSinceWaveStart = Date.now() - waveStartTimeRef.current;
            if (spawnQueueRef.current.length > 0) {
                const enemiesToSpawnNow = spawnQueueRef.current.filter(e => e._spawnTime <= timeSinceWaveStart);
                if(enemiesToSpawnNow.length > 0) {
                    spawnQueueRef.current = spawnQueueRef.current.filter(e => e._spawnTime > timeSinceWaveStart);
                    const nowEpoch = Date.now();
                    const newEnemiesThisFrame = enemiesToSpawnNow.map(e => ({...e, lastMove: nowEpoch, path: currentPathRef.current}));
                    currentEnemies.push(...newEnemiesThisFrame);
                }
            }


            let allNewAttacks: Attack[] = [];
            let allNewDamageNumbers: DamageNumber[] = [];
            let allNewSplashRings: SplashRing[] = [];
            let firingIds = new Set<string>();
            let resourcesGainedThisTick = 0;
            let livesGainedThisTick = 0;
            let killedThisTick = 0;

            const towers = Object.values(towersByCellRef.current);
            const auraTowers = towers.filter(t => t.effect?.type === 'aura');
            
            const currentBuffedTowerIds = new Set<string>();
            if (auraTowers.length > 0) {
                towers.forEach(tower => {
                  if (tower.effect?.type === 'aura') return;
                  for (const auraTower of auraTowers) {
                    const distSq = Math.pow(tower.position.col - auraTower.position.col, 2) + Math.pow(tower.position.row - auraTower.position.row, 2);
                    if (distSq <= Math.pow(auraTower.effect!.radius!, 2)) {
                      currentBuffedTowerIds.add(tower.id);
                      break;
                    }
                  }
                });
            }

            for (const tower of towers) {
                if (now - tower.lastAttack >= tower.attackSpeed) {
                    let target: Enemy | null = null;
                    let minDistanceSq = tower.range * tower.range;
                    
                    currentEnemies.forEach(enemy => {
                        const distSq = (tower.position.col - enemy.position.col) ** 2 + (tower.position.row - enemy.position.row) ** 2;
                        if (distSq <= minDistanceSq) {
                            minDistanceSq = distSq;
                            target = enemy;
                        }
                    });

                    if (target) {
                        tower.lastAttack = now;
                        firingIds.add(tower.id);
                        
                        const isBuffed = currentBuffedTowerIds.has(tower.id);
                        const attackResult = processAttack(tower, target, currentEnemies, now, isBuffed);
                        
                        currentEnemies = attackResult.updatedEnemies;
                        allNewAttacks.push(...attackResult.newAttacks);
                        allNewDamageNumbers.push(...attackResult.damageNumbers);
                        allNewSplashRings.push(...attackResult.splashRings);

                        if (attackResult.resourcesGained > 0) {
                           resourcesGainedThisTick += attackResult.resourcesGained;
                           killedThisTick += attackResult.killed;
                        }
                        if (attackResult.livesGained > 0) {
                           livesGainedThisTick += attackResult.livesGained;
                        }
                    }
                }
            }

            if (firingIds.size > 0) setFiringTowerIds(firingIds);
            if (allNewAttacks.length > 0) gameBoardRef.current?.queueAttacks(allNewAttacks);
            if (allNewDamageNumbers.length > 0) gameBoardRef.current?.queueDamageNumbers(allNewDamageNumbers);
            if (allNewSplashRings.length > 0) gameBoardRef.current?.queueSplashRings(allNewSplashRings);

            let livesLostThisTick = 0;
            const nextEnemies: Enemy[] = [];

            for (const enemy of currentEnemies) {
                 let updatedEnemy = { ...enemy, wasHit: false, effects: enemy.effects.filter(e => e.expires > now) };

                const stunEffect = updatedEnemy.effects.find(e => e.type === 'stun');
                if (stunEffect) {
                    nextEnemies.push(updatedEnemy);
                    continue;
                };
                
                const burnEffect = updatedEnemy.effects.find(e => e.type === 'burn');
                if (burnEffect && (!burnEffect.lastTick || now - burnEffect.lastTick >= 1000)) {
                    const damage = burnEffect.potency ?? 0;
                    updatedEnemy.health -= damage;
                    burnEffect.lastTick = now;
                    gameBoardRef.current?.queueDamageNumbers([{ id: crypto.randomUUID(), amount: damage, targetId: updatedEnemy.id, color: '#f97316' } as DamageNumber]);
                }

                if (updatedEnemy.health <= 0) {
                    continue;
                }

                const slowEffect = updatedEnemy.effects.find(e => e.type === 'slow');
                const speed = updatedEnemy.speed * (slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1);
                const stepMs = 1000 / Math.max(0.001, speed);

                if (now - updatedEnemy.lastMove >= stepMs) {
                    if (updatedEnemy.pathIndex < updatedEnemy.path.length - 1) {
                        updatedEnemy.pathIndex += 1;
                        updatedEnemy.position = updatedEnemy.path[updatedEnemy.pathIndex];
                        updatedEnemy.lastMove = now;
                    } else {
                        livesLostThisTick++;
                        continue; 
                    }
                }
                nextEnemies.push(updatedEnemy);
            }
            
            setEnemies(nextEnemies);

            if (livesLostThisTick > 0) {
                setTotalLeaked(prev => prev + livesLostThisTick);
                setGameState(prev => {
                    const newLives = prev.lives - livesLostThisTick;
                    if (newLives <= 0) handleGameEnd(false);
                    return { ...prev, lives: newLives };
                });
            }
             if (livesGainedThisTick > 0) {
                setGameState(prev => ({ ...prev, lives: prev.lives + livesGainedThisTick }));
            }
            if (resourcesGainedThisTick > 0) {
                setTotalKilled(prev => prev + killedThisTick);
                setPlayers(prev => [{ ...prev[0], resources: prev[0].resources + resourcesGainedThisTick }]);
            }
            
            if (nextEnemies.length === 0 && spawnQueueRef.current.length === 0 && !isIntermissionRef.current) {
                const nextWave = currentWaveRef.current + 1;
                
                if (waves[nextWave]) {
                  if ((nextWave) % 5 === 0 && localPlayerRef.current && localPlayerRef.current.unlockedElements.length < 8) {
                    setGameStatus('picking-element');
                  } else {
                    setCurrentWave(nextWave);
                    setIsIntermission(true);
                    setWaveStartCountdown(INTERMISSION_TIME);
                  }
                } else {
                    handleGameEnd(true);
                }
            }
        };

        gameLoopRef.current = requestAnimationFrame(gameLoop);
        return () => {
            if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
        }
    }, [handleStartNextWaveNow, handleGameEnd, user]);

    const toggleMute = () => {
      setIsMuted(current => {
        const newMuted = !current;
        if (newMuted) audioManager.mute();
        else audioManager.unmute();
        return newMuted;
      });
    };
    
    if (!localPlayer) return null;

    const interactionPrompt = selectedTowerToBuild ? `Wähle Bauplatz für: ${selectedTowerToBuild?.name}` : focusedTower ? `Fokus: ${focusedTower?.name}` : 'Wähle einen Turm zum Bauen';

    return (
        <div className="w-full h-full flex flex-col" onClick={() => { if(!hasInteracted) { audioManager.init(); setHasInteracted(true); }}}>
             <Header onExit={onExit} isMuted={isMuted} toggleMute={toggleMute} />
             <div className="flex-grow p-2">
                <LayoutComponent
                    players={players} 
                    setPlayers={setPlayers} 
                    gameState={gameState} 
                    localPlayer={localPlayer}
                    currentWave={currentWave} 
                    totalWaves={waves.length} 
                    difficulty={difficulty} 
                    handleGameControl={() => setGameStatus(prev => prev === 'playing' ? 'paused' : 'playing')} 
                    gameStatus={gameStatus} 
                    resetGame={onExit}
                    towers={initialTowers} 
                    setTowers={() => {}} 
                    placedTowers={placedTowers} 
                    enemies={enemies} 
                    damageNumbers={damageNumbers} 
                    splashRings={splashRings}
                    currentPath={currentPath} 
                    handlePlaceTower={handlePlaceTower}
                    onFocusTower={onFocusTower} 
                    selectedTowerToBuild={selectedTowerToBuild}
                    focusedTower={focusedTower}
                    gameBoardRef={gameBoardRef}
                    interactionPrompt={interactionPrompt} 
                    cancelInteractions={cancelInteractions}
                    onSelectTowerToBuild={onSelectTowerToBuild} 
                    handleUpgradeTower={handleUpgradeTower}
                    handleSellTower={handleSellTower}
                    setFocusedTower={setFocusedTower}
                    spawnedThisWave={isIntermission ? 0 : (waves[currentWave]?.enemies.count - spawnQueueRef.current.length)}
                    totalEnemiesInWave={waves[currentWave]?.enemies.count || 0}
                    totalKilled={totalKilled}
                    totalLeaked={totalLeaked}
                    isIntermission={isIntermission} 
                    waveStartCountdown={Math.ceil(waveStartCountdown)}
                    intermissionTime={INTERMISSION_TIME} 
                    handleStartNextWaveNow={handleStartNextWaveNow}
                    lastUpgradedTowerId={lastUpgradedTowerId}
                    justPlacedTowerId={justPlacedTowerId}
                    isCoop={false} 
                    playerRole="player1"
                    handleLoadTestLayout={handleLoadTestLayout}
                    handleLoadAllTowersLayout={handleLoadAllTowersLayout}
                    isCheating={isCheating} 
                    cheat_addResources={() => setPlayers(prev => [{...prev[0], resources: prev[0].resources + 10000}])} 
                    cheat_skipWaves={() => setCurrentWave(prev => prev + 5)}
                    cheat_heal={() => setGameState(prev => ({...prev, lives: difficultyModifiers[difficulty].startLives}))}
                    cheat_unlockAll={handleUnlockAll}
                    firingTowerIds={firingTowerIds} 
                    allTowers={initialTowers}
                    attacks={attacks}
                />
            </div>

            <AlertDialog open={gameStatus === 'gameover'}>
                <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{gameState.lives > 0 ? "Sieg!" : "Game Over"}</AlertDialogTitle>
                    <AlertDialogDescription>
                    {gameState.lives <= 0 ? "Du hast alle Leben verloren." : "Herzlichen Glückwunsch, du hast alle Wellen besiegt!"} Du hast Welle {currentWave + 1} erreicht.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {(finalGameResult)?.finalTowers && (
                    <div className="flex flex-col items-center gap-2"><p className="text-sm font-semibold text-muted-foreground">Dein finales Spielfeld:</p><ScoreboardMiniMap towersByCell={(finalGameResult)!.finalTowers!} /></div>
                )}
                <AlertDialogFooter><AlertDialogAction onClick={onExit}>Zum Hauptmenü</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            
            <ElementPickDialog
                isOpen={gameStatus === 'picking-element'}
                unlockedElements={new Set(localPlayer.unlockedElements)}
                onElementPick={handleElementPick}
                playerName={localPlayer.name}
                currentWave={currentWave}
            />
        </div>
    );
}
