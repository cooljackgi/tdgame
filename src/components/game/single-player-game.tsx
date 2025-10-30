

'use client';

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import type { Difficulty, GameSaveState, User, Player, GameState, PlacedTower, Tower, Node, Element, Enemy, Attack, DamageNumber, SplashRing, MovementPattern, LifeGainVfx, GravityWell, PoisonCloud, DoTEffect, AuraBuffs, DamageApplicationResult } from '@/lib/game-data/types';
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
import { onGameEnd, processAttack, tickDots } from '@/lib/game-logic';
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import ScoreboardMiniMap from './ScoreboardMiniMap';
import Header from './header';
import TutorialOverlay from './tutorial-overlay';


export default function SinglePlayerGame({
    difficulty: initialDifficulty,
    onExit,
    initialSavedGame,
    startWithTutorial = false,
    user
}: {
    difficulty: Difficulty,
    onExit: () => void,
    initialSavedGame: GameSaveState | null,
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
    const [gameStatus, setGameStatus] = useState<"waiting" | "playing" | "paused" | "gameover" | "picking-element" | "tutorial">('waiting');
    const [currentPath, setCurrentPath] = useState<Node[]>([]);
    const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);
    const [isIntermission, setIsIntermission] = useState(true);
    const [gravityWells, setGravityWells] = useState<GravityWell[]>([]);
    const [poisonClouds, setPoisonClouds] = useState<PoisonCloud[]>([]);

    // --- UI/Interaction State ---
    const [selectedTowerToBuild, setSelectedTowerToBuild] = useState<Tower | null>(null);
    const [justPlacedTowerId, setJustPlacedTowerId] = useState<string | null>(null);
    const [focusedTower, setFocusedTower] = useState<PlacedTower | null>(null);
    const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string | null>(null);
    const [hasInteracted, setHasInteracted] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [finalGameResult, setFinalGameResult] = useState<any | null>(null);
    const [fps, setFps] = useState(0);
    const isCheating = useMemo(() => difficulty === 'Chaos', [difficulty]);


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
    const lastTickRef = useRef(Date.now());
    const enemyIdCounter = useRef(0);
    const gameBoardRef = useRef<GameBoardHandle>(null);
    const spawnQueueRef = useRef<any[]>([]);
    const waveStartTimeRef = useRef<number>(0);
    const frameCountRef = useRef(0);
    const lastFpsUpdateRef = useRef(Date.now());


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
    const gravityWellsRef = useRef(gravityWells);
    const poisonCloudsRef = useRef(poisonClouds);


    useEffect(() => { playersRef.current = players; localPlayerRef.current = players[0]; }, [players]);
    useEffect(() => { towersByCellRef.current = towersByCell; }, [towersByCell]);
    useEffect(() => { enemiesRef.current = enemies; }, [enemies]);
    useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
    useEffect(() => { currentWaveRef.current = currentWave; }, [currentWave]);
    useEffect(() => { difficultyRef.current = difficulty; }, [difficulty]);
    useEffect(() => { gameStatusRef.current = gameStatus; }, [gameStatus]);
    useEffect(() => { currentPathRef.current = currentPath; }, [currentPath]);
    useEffect(() => { isIntermissionRef.current = isIntermission; }, [isIntermission]);
    useEffect(() => { gravityWellsRef.current = gravityWells; }, [gravityWells]);
    useEffect(() => { poisonCloudsRef.current = poisonClouds; }, [poisonClouds]);

    useEffect(() => {
        const onFirstPointer = async () => {
            try {
                await audioManager.init(); // AudioContext unlock
                audioManager.primeHaptics(); // ab jetzt darf vibriert werden
            } catch {}
            window.removeEventListener('pointerdown', onFirstPointer);
            window.removeEventListener('touchstart', onFirstPointer);
        };
        window.addEventListener('pointerdown', onFirstPointer, { once: true });
        window.addEventListener('touchstart', onFirstPointer, { once: true });
        return () => {
            window.removeEventListener('pointerdown', onFirstPointer);
            window.removeEventListener('touchstart', onFirstPointer);
        };
    }, []);

    useEffect(() => {
        if (initialSavedGame) {
            const now = Date.now();
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
                incomePerSecond: 5,
            };

            setPlayers([player1]);
            setGameState({ lives: difficultyMod.startLives });
            setTowersByCell({});
            setEnemies([]);
            setCurrentWave(0);
            setDifficulty(initialDifficulty);
            setGameStatus(startWithTutorial ? 'tutorial' : 'waiting');
            setIsIntermission(true);
            setWaveStartCountdown(INTERMISSION_TIME);
            setCurrentPath(findPath({row:1,col:1},{row:GRID_ROWS,col:GRID_COLS}, [], GRID_ROWS, GRID_COLS) ?? []);
        }
    }, [initialSavedGame, initialDifficulty, user, startWithTutorial]);
    
    useEffect(() => {
      const saveGame = () => {
        if (gameStatusRef.current === 'tutorial' || gameStatusRef.current === 'gameover') return;

        const player1 = playersRef.current[0];
        if (!player1) return;

        const saveState: GameSaveState & { _v?: number; _savedAt?: number; } = {
          players: { player1, player2: null },
          gameState: gameStateRef.current,
          towersByCell: towersByCellRef.current,
          enemies: enemiesRef.current,
          currentWave: currentWaveRef.current,
          difficulty: difficultyRef.current,
          _v: 1,
          _savedAt: Date.now(),
        };

        try {
          const json = JSON.stringify(saveState);
          localStorage.setItem(LOCAL_STORAGE_KEY, json);
        } catch (e) {
          console.error('Save failed', e);
        }
      };

      const iv = setInterval(saveGame, 15000);
      const onVis = () => { if (document.visibilityState !== 'visible') saveGame(); };
      document.addEventListener('visibilitychange', onVis);
      window.addEventListener('beforeunload', saveGame);

      return () => {
        saveGame();
        clearInterval(iv);
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('beforeunload', saveGame);
      };
    }, []);


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
        
        localStorage.removeItem(LOCAL_STORAGE_KEY);
        if (user?.uid && !isCheating) {
             try {
                await onGameEnd(`sp-${user.uid}-${Date.now()}`, user, result.difficulty, result.wave, won, result.finalTowers);
            } catch(e) { console.error("Failed to save score", e); }
        }

        setFinalGameResult({ ...result, date: new Date().toISOString() });
    }, [user, isCheating]);

    const startWaveLogic = useCallback(() => {
        const waveData = waves[currentWaveRef.current];
        if (!waveData) return;
        
        audioManager.playSfx('wave_start', 0.6);
        audioManager.playWaveMusic();
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
                lastMove: 0,
                wasHit: false,
                targetNode: { row: GRID_ROWS, col: GRID_COLS },
                movementPattern: 'wobble',
                vx: 0,
                vy: 0,
                _spawnTime: i * waveData.enemies.spawnDelay,
            };
        });
        
        spawnQueueRef.current = enemiesToSpawn;
        waveStartTimeRef.current = Date.now();
        setIsIntermission(false);
        setWaveStartCountdown(0);
    }, []);

    const handleStartNextWaveNow = useCallback(() => {
        if(gameStatusRef.current === 'waiting' || gameStatusRef.current === 'tutorial') {
            setGameStatus('playing');
            setIsIntermission(true);
            setWaveStartCountdown(INTERMISSION_TIME);
        } else if (isIntermissionRef.current) {
            startWaveLogic();
        }
    }, [startWaveLogic]);
    
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
        
        audioManager.playSfx('build_tower', 0.6);
        const newTower: PlacedTower = {
            ...towerSpec,
            id: `tower-${row}-${col}-${Date.now()}`,
            specId: towerSpec.id,
            position: { row, col },
            lastAttack: Date.now() - 99999,
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

        audioManager.playSfx('upgrade_tower', 0.6);
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
        
        audioManager.playSfx('sell_tower', 0.5);
        const cellKey = `${focusedTower.position.row}_${focusedTower.position.col}`;
        const refundPercentage = difficultyRef.current === 'Einfach' ? 1.0 : 0.75;
        const refund = Math.round(focusedTower.cost * refundPercentage);
        
        setTowersByCell(prev => { const newTowers = { ...prev }; delete newTowers[cellKey]; return newTowers; });
        setPlayers(prev => [{ ...prev[0], resources: prev[0].resources + refund }]);
        setFocusedTower(null);
    }, [focusedTower]);
    
    const handleElementPick = useCallback((element: Element) => {
        audioManager.playSfx('upgrade_tower', 0.8);
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
        audioManager.playSfx('ui_click', 0.7);
    }, []);
    // --- CHEAT/DEBUG FUNCTIONS ---
    const generateLayout = useCallback((towersToPlace: Tower[]) => {
        const mazePath: Node[] = [
            ...Array.from({ length: 9 }, (_, i) => ({ row: i + 2, col: 2 })),
            ...Array.from({ length: 10 }, (_, i) => ({ row: 11 - i, col: 4 })),
            ...Array.from({ length: 10 }, (_, i) => ({ row: i + 2, col: 6 })),
            ...Array.from({ length: 10 }, (_, i) => ({ row: 11 - i, col: 8 })),
            ...Array.from({ length: 10 }, (_, i) => ({ row: i + 2, col: 10 })),
            
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

            // FPS Calculation
            frameCountRef.current++;
            if (now - lastFpsUpdateRef.current >= 1000) {
                setFps(frameCountRef.current);
                frameCountRef.current = 0;
                lastFpsUpdateRef.current = now;
            }

            if (gameStatusRef.current !== 'playing') return;

            setPlayers(prev => prev.map(p => ({
                ...p,
                resources: p.resources + (p.incomePerSecond * (delta / 1000)),
            })));

            if (isIntermissionRef.current) {
                setWaveStartCountdown(prevTime => {
                    const newTime = prevTime - delta / 1000;
                    if (newTime <= 0) {
                        startWaveLogic();
                        return 0;
                    }
                    return newTime;
                });
                return; // No game logic during intermission
            }

            let currentEnemies = enemiesRef.current.map(e => ({ ...e, wasHit: false }));


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
            let killedThisTick = 0;
            

            const towers = Object.values(towersByCellRef.current);
            
            for (const tower of towers) {
                if (now - tower.lastAttack >= tower.attackSpeed) {
                    let target: Enemy | null = null;
                    let minDistanceSq = tower.range * tower.range;
                    currentEnemies.forEach(enemy => {
                        if (enemy.deathTimestamp) return;
                        const distSq = (tower.position.col - enemy.position.col) ** 2 + (tower.position.row - enemy.position.row) ** 2;
                        if (distSq <= minDistanceSq) {
                            minDistanceSq = distSq;
                            target = enemy;
                        }
                    });
                    
                    if (target) {
                        tower.lastAttack = now;
                        firingIds.add(tower.id);
                        audioManager.playAttackSound(tower.elements[0] || 'neutral', tower.position);
                        
                        const attackContext: Attack = {
                            id: crypto.randomUUID(),
                            towerId: tower.id,
                            targetId: target.id,
                            targetPosition: target.position,
                            elements: tower.elements,
                            projectile: tower.specId.includes('-1a') || tower.specId.includes('-2a') ? 'arrow' : 'beam',
                            baseDamage: tower.damage,
                            critChance: tower.effect?.type === 'crit' ? tower.effect.chance : 0,
                            critMult: tower.effect?.type === 'crit' ? tower.effect.potency : 2,
                            dots: tower.effect?.type === 'burn' ? [{ id: `dot-${now}`, sourceId: tower.id, type: 'burn', startTime: now, durationMs: tower.effect.duration || 3000, remainingMs: tower.effect.duration || 3000, tickMs: 1000, flatPerTick: tower.effect.potency }] : undefined,
                        };
                        
                        allNewAttacks.push(attackContext);

                        const auras: AuraBuffs | null = null; // Simplified for SP
                        const result = processAttack(tower.id, target, attackContext, auras);

                        allNewDamageNumbers.push({
                            id: crypto.randomUUID(),
                            amount: result.immediateDamage,
                            targetId: target.id,
                            isCrit: result.crit,
                            color: result.crit ? '#facc15' : '#fff',
                        } as DamageNumber);
                        
                        const enemyIndex = currentEnemies.findIndex(e => e.id === target!.id);
                        if (enemyIndex !== -1) {
                           currentEnemies[enemyIndex] = {
                               ...currentEnemies[enemyIndex],
                               ...target // Health updated by processAttack
                           };
                           if(result.killed) {
                               resourcesGainedThisTick += currentEnemies[enemyIndex].bounty;
                               killedThisTick++;
                           }
                        }
                    }
                }
            }

            if (firingIds.size > 0) setFiringTowerIds(firingIds);
            gameBoardRef.current?.queueAttacks(allNewAttacks);
            gameBoardRef.current?.queueDamageNumbers(allNewDamageNumbers);
            
            let livesLostThisTick = 0;
            const nextEnemies: Enemy[] = [];
            
            for (let enemy of currentEnemies) {
              if (enemy.health <= 0 && !enemy.deathTimestamp) {
                  enemy.deathTimestamp = now;
              }
              if (enemy.deathTimestamp && now - enemy.deathTimestamp > 2500) {
                audioManager.playVibration('kill');
                audioManager.playSfx('enemy_die', 0.4);
                continue;
              }
              if (enemy.deathTimestamp) {
                nextEnemies.push(enemy);
                continue;
              }
              
              const dotResult = tickDots(enemy, delta);
              if (dotResult.totalDamage > 0) {
                gameBoardRef.current?.queueDamageNumbers([{id: crypto.randomUUID(), amount: dotResult.totalDamage, targetId: enemy.id, color: '#f97316'} as DamageNumber]);
              }
              if (dotResult.killed && !enemy.deathTimestamp) {
                enemy.deathTimestamp = now;
              }
              if (enemy.deathTimestamp) {
                nextEnemies.push(enemy);
                continue;
              }

              const stunEffect = enemy.effects.find(e => e.type === 'stun' && e.expires > now);
              if (stunEffect) {
                  nextEnemies.push(enemy);
                  continue;
              }
                
              const slowEffect = enemy.effects.find(e => e.type === 'slow' && e.expires > now);
              const speed = enemy.speed * (slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1);
              const stepMs = 1000 / Math.max(0.001, speed);
              
              let timeToMove = now - enemy.lastMove;
              
              while (timeToMove >= stepMs) {
                  if (enemy.pathIndex < enemy.path.length - 1) {
                      enemy.pathIndex += 1;
                      enemy.position = enemy.path[enemy.pathIndex];
                      timeToMove -= stepMs;
                      enemy.lastMove += stepMs;
                  } else {
                      livesLostThisTick++;
                      audioManager.playSfx('enemy_leak', 0.5);
                      enemy.health = -1; // Mark for removal
                      break;
                  }
              }
              if (enemy.health > 0) {
                nextEnemies.push(enemy);
              }
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
            
            if (resourcesGainedThisTick > 0) {
                setTotalKilled(prev => prev + killedThisTick);
                setPlayers(prev => [{ ...prev[0], resources: prev[0].resources + resourcesGainedThisTick }]);
            }
            
            if (nextEnemies.filter(e => !e.deathTimestamp).length === 0 && spawnQueueRef.current.length === 0 && !isIntermissionRef.current) {
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
    }, [startWaveLogic, handleGameEnd, user, isCheating]);

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
             {gameStatus === 'tutorial' && <TutorialOverlay onFinish={() => setGameStatus('waiting')} />}
             <Header onExit={onExit} isMuted={isMuted} toggleMute={toggleMute} fps={fps} />
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
                    poisonClouds={poisonClouds}
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
                    <AlertDialogTitle>{(finalGameResult)?.won ? "Sieg!" : "Game Over"}</AlertDialogTitle>
                    <AlertDialogDescription>
                    {(finalGameResult)?.won ? "Herzlichen Glückwunsch, du hast alle Wellen besiegt!" : "Du hast alle Leben verloren."} Du hast Welle {(finalGameResult)?.wave || currentWave + 1} erreicht.
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
