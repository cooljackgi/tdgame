

'use client';

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import type { Difficulty, GameSaveState, User, Player, GameState, PlacedTower, Tower, Node, Element, Enemy, Attack, DamageNumber, SplashRing, MovementPattern, LifeGainVfx, GravityWell, PersistentCloud, Worker, GhostFoundation, GameSessionState, Portal } from '@/lib/game-data/types';
import { difficultyModifiers, GRID_COLS, GRID_ROWS, LOCAL_STORAGE_KEY, INTERMISSION_TIME, ALL_PICKABLE_ELEMENTS } from '@/lib/game-data/constants';
import { findPath } from '@/lib/pathfinding';
import { useToast } from '@/hooks/use-toast';
import { audioManager } from '@/lib/audio/audio-manager';
import type { GameBoardHandle } from './game-board';
import { useIsMobile } from '@/hooks/use-mobile';
import { DesktopLayout } from '@/components/layouts/desktop-layout';
import { MobileLayout } from '@/components/layouts/mobile-layout';
import { ElementPickDialog } from './element-pick-dialog';
import { onGameEnd } from '@/lib/game-end';
import { processAttack, tickDots, tickWorkers } from '@/lib/game-logic';
import { enqueueBuildOrder, enqueueMoveOrder, enqueuePlacePortalOrder } from '@/lib/commands';
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import ScoreboardMiniMap from './ScoreboardMiniMap';
import Header from './header';
import TutorialOverlay from './tutorial-overlay';
import { loadGameConfig, type GameConfig } from '@/lib/game-config-loader';
import { Loader2 } from 'lucide-react';


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
    
    // --- Config Loading State ---
    const [gameConfig, setGameConfig] = useState<GameConfig | null>(null);
    const [configLoading, setConfigLoading] = useState(true);

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
    const [persistentClouds, setPersistentClouds] = useState<PersistentCloud[]>([]);
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [ghosts, setGhosts] = useState<GhostFoundation[]>([]);
    const [portals, setPortals] = useState<Portal[]>([]);

    // --- UI/Interaction State ---
    const [selectedTowerToBuild, setSelectedTowerToBuild] = useState<Tower | null>(null);
    const [portalPhase, setPortalPhase] = useState<'idle' | 'entrance' | 'exit'>('idle');
    const [portalEntrance, setPortalEntrance] = useState<Node | null>(null);
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
    const persistentCloudsRef = useRef(persistentClouds);
    const workersRef = useRef(workers);
    const ghostsRef = useRef(ghosts);
    const portalsRef = useRef(portals);


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
    useEffect(() => { persistentCloudsRef.current = persistentClouds; }, [persistentClouds]);
    useEffect(() => { workersRef.current = workers; }, [workers]);
    useEffect(() => { ghostsRef.current = ghosts; }, [ghosts]);
    useEffect(() => { portalsRef.current = portals; }, [portals]);
    
    // --- Load Game Configuration ---
    useEffect(() => {
        async function fetchConfig() {
            try {
                const config = await loadGameConfig();
                setGameConfig(config);
            } catch (error) {
                console.error("Failed to load game config, using defaults:", error);
                toast({ title: 'Fehler beim Laden der Konfiguration', description: 'Standardwerte werden verwendet.', variant: 'destructive' });
                // Fallback is handled within loadGameConfig, but we could explicitly set it here too.
            } finally {
                setConfigLoading(false);
            }
        }
        fetchConfig();
    }, [toast]);


    useEffect(() => {
        if (configLoading) return; // Wait for config to load

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
            setWorkers(initialSavedGame.workers || [{
                id: "worker-1", x: 64, y: 64, speed: 260,
                state: "idle", queue: [], moveTarget: null,
            }]);
            setGhosts(initialSavedGame.ghosts || []);
            setPortals(initialSavedGame.portals || []);
            setGameStatus('playing');
            if (initialSavedGame.enemies.length === 0) {
                 setIsIntermission(true);
                 setWaveStartCountdown(INTERMISSION_TIME);
            }
        } else {
            const difficultyMod = difficultyModifiers[initialDifficulty];
            const player1: Player = {
                id: 'player1',
                name: user?.displayName || 'Spieler 1',
                avatarUrl: user?.photoURL || null,
                resources: difficultyMod.startResources,
                unlockedElements: ['neutral'],
                incomePerSecond: 5,
                portalCooldownUntilWave: 0,
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
             setWorkers([{
                id: "worker-1",
                x: 64, y: 64, speed: 260,
                state: "idle",
                queue: [],
                moveTarget: null,
            }]);
            setGhosts([]);
            setPortals([]);
        }
    }, [initialSavedGame, initialDifficulty, user, startWithTutorial, configLoading]);
    
    useEffect(() => {
      const newPath = findPath({row:1,col:1},{row:GRID_ROWS,col:GRID_COLS}, Object.values(towersByCell).map(t => t.position), GRID_ROWS, GRID_COLS) ?? [];
      setCurrentPath(newPath);
    }, [towersByCell]);


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
      const saveGame = () => {
        if (gameStatusRef.current === 'tutorial' || gameStatusRef.current === 'gameover' || !gameConfig) return;

        const player1 = playersRef.current[0];
        if (!player1) return;

        const saveState: GameSaveState & { _v?: number; _savedAt?: number; } = {
          players: { player1, player2: null },
          gameState: gameStateRef.current,
          towersByCell: towersByCellRef.current,
          enemies: enemiesRef.current,
          currentWave: currentWaveRef.current,
          difficulty: difficultyRef.current,
          workers: workersRef.current,
          ghosts: ghostsRef.current,
          portals: portalsRef.current,
          _v: 2, // Bump version to indicate new structure
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
    }, [gameConfig]);


    const placedTowers = useMemo(() => Object.values(towersByCell), [towersByCell]);
    const localPlayer = useMemo(() => players.find(p => p.id === 'player1'), [players]);
    const LayoutComponent = useMemo(() => isMobile ? MobileLayout : DesktopLayout, [isMobile]);
    
    const buffedTowerIds = useMemo(() => {
        const ids = new Set<string>();
        const auraTowers = placedTowers.filter(t => t.effects?.some(e => e.type === 'aura'));
        if (auraTowers.length === 0) return ids;

        placedTowers.forEach(tower => {
          if (tower.effects?.some(e => e.type === 'aura')) return;
          for (const auraTower of auraTowers) {
            const distSq = Math.pow(tower.position.col - auraTower.position.col, 2) + Math.pow(tower.position.row - auraTower.position.row, 2);
            if (distSq <= Math.pow(auraTower.range, 2)) {
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
        if (!gameConfig) return;
        const waveData = gameConfig.waves[currentWaveRef.current];
        if (!waveData) return;
        
        audioManager.play({ kind: 'sfx', name: 'wave_start' });
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
    }, [gameConfig]);

    const handleStartNextWaveNow = useCallback(() => {
        if(gameStatusRef.current === 'waiting' || gameStatusRef.current === 'tutorial') {
            setGameStatus('playing');
            setIsIntermission(true);
            setWaveStartCountdown(INTERMISSION_TIME);
        } else if (isIntermissionRef.current) {
            startWaveLogic();
        }
    }, [startWaveLogic]);
    
    const cancelInteractions = useCallback(() => {
        setSelectedTowerToBuild(null);
        setFocusedTower(null);
        setPortalPhase('idle');
        setPortalEntrance(null);
    }, []);

    const handlePlaceTower = useCallback((row: number, col: number) => {
        const state: GameSessionState = { players: playersRef.current, gameState: gameStateRef.current, towersByCell: towersByCellRef.current, enemies: enemiesRef.current, currentWave: currentWaveRef.current, difficulty: difficultyRef.current, gameStatus: gameStatusRef.current, currentPath: currentPathRef.current, waveStartCountdown: 0, isIntermission: isIntermissionRef.current, workers: workersRef.current, ghosts: ghostsRef.current, portals: portalsRef.current };
        if (portalPhase !== 'idle') {
            if (portalPhase === 'entrance') {
                setPortalEntrance({ row, col });
                setPortalPhase('exit');
                return;
            } else if (portalPhase === 'exit' && portalEntrance) {
                const newState = enqueuePlacePortalOrder(state, "worker-1", portalEntrance, { row, col }, Date.now());
                setPlayers(newState.players);
                setWorkers(newState.workers);
                cancelInteractions();
                return;
            }
        } else if (selectedTowerToBuild) {
            const newState = enqueueBuildOrder(state, "worker-1", row, col, selectedTowerToBuild.id, Date.now());
            setPlayers(newState.players);
            setGhosts(newState.ghosts);
            setWorkers(newState.workers);
        } else {
            const newState = enqueueMoveOrder(state, 'worker-1', row, col);
            setWorkers(newState.workers);
        }
    }, [selectedTowerToBuild, portalPhase, portalEntrance, cancelInteractions]);

    const handleUpgradeTower = useCallback((upgradeId: string) => {
        const player = localPlayerRef.current;
        if (!player || !focusedTower || !gameConfig) return;
        
        const cellKey = `${focusedTower.position.row}_${focusedTower.position.col}`;
        const upgradeTowerSpec = gameConfig.towers.find(t => t.id === upgradeId);
        if (!upgradeTowerSpec) return;
        
        const refundPercentage = difficultyRef.current === 'Einfach' ? 1.0 : 0.75;
        const cost = Math.max(0, upgradeTowerSpec.cost - Math.floor(focusedTower.cost * refundPercentage));
        
        if (player.resources < cost) {
            toast({ title: 'Nicht genügend Ressourcen für das Upgrade.', variant: 'destructive' });
            return;
        }

        audioManager.play({ kind: 'sfx', name: 'upgrade_tower' });
        const newPlacedTower: PlacedTower = { 
            ...focusedTower, ...upgradeTowerSpec, specId: upgradeTowerSpec.id, health: upgradeTowerSpec.maxHealth, id: focusedTower.id 
        };
        
        setTowersByCell(prev => ({ ...prev, [cellKey]: newPlacedTower }));
        setPlayers(prev => [{ ...prev[0], resources: prev[0].resources - cost }]);
        setFocusedTower(newPlacedTower);
        setLastUpgradedTowerId(newPlacedTower.id);
        setTimeout(() => setLastUpgradedTowerId(null), 500);
    }, [toast, focusedTower, gameConfig]);

    const handleSellTower = useCallback(() => {
        const player = localPlayerRef.current;
        if (!player || !focusedTower) return;
        
        audioManager.play({ kind: 'sfx', name: 'sell_tower' });
        const cellKey = `${focusedTower.position.row}_${focusedTower.position.col}`;
        const refundPercentage = difficultyRef.current === 'Einfach' ? 1.0 : 0.75;
        const refund = Math.round(focusedTower.cost * refundPercentage);
        
        setTowersByCell(prev => { const newTowers = { ...prev }; delete newTowers[cellKey]; return newTowers; });
        setPlayers(prev => [{ ...prev[0], resources: prev[0].resources + refund }]);
        setFocusedTower(null);
    }, [focusedTower]);
    
    const handleElementPick = useCallback((element: Element) => {
        audioManager.play({ kind: 'sfx', name: 'upgrade_tower' });
        setPlayers(prev => [{ ...prev[0], unlockedElements: Array.from(new Set([...prev[0].unlockedElements, element])) }]);
        setCurrentWave(prev => prev + 1);
        setIsIntermission(true);
        setWaveStartCountdown(INTERMISSION_TIME);
        setGameStatus('playing');
    }, []);

    const onFocusTower = useCallback((tower: PlacedTower) => {
        setSelectedTowerToBuild(null);
        setPortalPhase('idle');
        setPortalEntrance(null);
        setFocusedTower(tower);
    }, []);
    
    const onSelectTowerToBuild = useCallback((tower: Tower | null) => {
        cancelInteractions();
        setSelectedTowerToBuild(tower);
        audioManager.play({ kind: 'sfx', name: 'ui_click' });
    }, [cancelInteractions]);
    
    const onEnterPortalMode = useCallback(() => {
        cancelInteractions();
        setPortalPhase('entrance');
        audioManager.play({ kind: 'sfx', name: 'ui_click' });
    }, [cancelInteractions]);

    // --- CHEAT/DEBUG FUNCTIONS ---
    const generateLayout = useCallback((towersToPlace: Tower[]) => {
        if (!gameConfig) return;
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
            towerIndex++;
        }

        setTowersByCell(newTowersByCell);
    }, [gameConfig]);

    const handleLoadTestLayout = useCallback(() => {
        if (!gameConfig) return;
        const testTowers = gameConfig.towers.filter(t => t.tier === 1 && t.id.includes("neutral-1a"));
        generateLayout(testTowers);
        toast({ title: 'Test-Layout geladen!', description: 'Ein Labyrinth aus Basistürmen wurde erstellt.' });
    }, [generateLayout, toast, gameConfig]);

    const handleLoadAllTowersLayout = useCallback(() => {
        if (!gameConfig) return;
        generateLayout(gameConfig.towers);
        toast({ title: 'Alle Türme geladen!', description: 'Jeder Turm wurde einmal im Labyrinth platziert.' });
    }, [generateLayout, toast, gameConfig]);

    const handleUnlockAll = useCallback(() => {
        setPlayers(prev => [{
            ...prev[0],
            resources: prev[0].resources + 50000,
            unlockedElements: ['neutral', ...ALL_PICKABLE_ELEMENTS]
        }]);
        toast({ title: 'Chaos aktiviert!', description: 'Alle Elemente freigeschaltet und 50,000 Ressourcen erhalten.' });
    }, [toast]);


    useEffect(() => {
        if (!gameConfig) return;
        let gameLoopRefValue: number;

        const gameLoop = () => {
            gameLoopRefValue = requestAnimationFrame(gameLoop);
            const now = Date.now();
            const delta = now - lastTickRef.current;
            if (delta < 16) return; // Cap at ~60fps
            lastTickRef.current = now;
            
            // FPS Calculation
            frameCountRef.current++;
            if (now - lastFpsUpdateRef.current >= 1000) {
                setFps(frameCountRef.current);
                frameCountRef.current = 0;
                lastFpsUpdateRef.current = now;
            }

            const currentStatus = gameStatusRef.current;
            
            const state: GameSessionState = { players: playersRef.current, gameState: gameStateRef.current, towersByCell: towersByCellRef.current, enemies: enemiesRef.current, currentWave: currentWaveRef.current, difficulty: difficultyRef.current, gameStatus: currentStatus, currentPath: currentPathRef.current, waveStartCountdown: 0, isIntermission: isIntermissionRef.current, workers: workersRef.current, ghosts: ghostsRef.current, portals: portalsRef.current };
            
            const workerState = tickWorkers(state, delta * (currentStatus === 'paused' ? 0.1 : 1), now, gameConfig.towers);
            setWorkers(workerState.workers);
            setGhosts(workerState.ghosts);
            setPortals(workerState.portals ?? portalsRef.current);
            if (Object.keys(workerState.towersByCell).length !== Object.keys(towersByCellRef.current).length) {
              setTowersByCell(workerState.towersByCell);
            }

            if (currentStatus !== 'playing') {
                return;
            }

            // Income
            setPlayers(prev => [{ ...prev[0], resources: prev[0].resources + (prev[0].incomePerSecond * (delta / 1000)) }]);

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
            let allNewLifeGainVfx: LifeGainVfx[] = [];
            let newPersistentClouds: PersistentCloud[] = [];
            let firingIds = new Set<string>();
            let resourcesGainedThisTick = 0;
            let livesGainedThisTick = 0;
            let killedThisTick = 0;
            let newGravityWells: GravityWell[] = [];

            Object.values(towersByCellRef.current).forEach(tower => {
                if (now - tower.lastAttack >= tower.attackSpeed) {
                    const isBuffed = buffedTowerIds.has(tower.id);
                    let target: Enemy | null = null;
                    let minDistanceSq = tower.range * tower.range;

                    currentEnemies.forEach(enemy => {
                        if (enemy.deathTimestamp) return;
                        const distSq = (tower.position.col - enemy.position.col)**2 + (tower.position.row - enemy.position.row)**2;
                        if (distSq <= minDistanceSq) {
                            minDistanceSq = distSq;
                            target = enemy;
                        }
                    });
                    
                    if (target) {
                        setTowersByCell(prev => ({
                            ...prev,
                            [`${tower.position.row}_${tower.position.col}`]: {
                                ...tower,
                                lastAttack: now,
                            }
                        }));

                        firingIds.add(tower.id);
                        
                        const result = processAttack(tower, target, currentEnemies, now, isBuffed);
                        
                        currentEnemies = result.updatedEnemies;
                        allNewAttacks.push(...result.newAttacks);
                        allNewDamageNumbers.push(...result.damageNumbers);
                        allNewSplashRings.push(...result.splashRings);
                        allNewLifeGainVfx.push(...result.lifeGainVfx);
                        result.soundEvents.forEach(ev => audioManager.play(ev));
                        if (result.newPersistentClouds.length > 0) newPersistentClouds.push(...result.newPersistentClouds);
                        if (result.newGravityWells.length > 0) newGravityWells.push(...result.newGravityWells);

                        if (result.resourcesGained > 0) resourcesGainedThisTick += result.resourcesGained;
                        if (result.killed > 0) killedThisTick += result.killed;
                        if (result.livesGained > 0) livesGainedThisTick += result.livesGained;
                    }
                }
            });

            if (firingIds.size > 0) setFiringTowerIds(firingIds);
            if (allNewAttacks.length > 0) setAttacks(prev => [...prev, ...allNewAttacks]);
            if (allNewDamageNumbers.length > 0) setDamageNumbers(prev => [...prev, ...allNewDamageNumbers]);
            if (allNewSplashRings.length > 0) setSplashRings(prev => [...prev, ...allNewSplashRings]);
            if (allNewLifeGainVfx.length > 0) gameBoardRef.current?.queueLifeGainVfx(allNewLifeGainVfx);

            let livesLostThisTick = 0;
            const nextEnemies: Enemy[] = [];
            const activeGravityWells = [...gravityWellsRef.current.filter(w => w.expires > now), ...newGravityWells];
            const activePersistentClouds = [...persistentCloudsRef.current.filter(w => w.expires > now), ...newPersistentClouds];
            
            for (let enemy of currentEnemies) {
              if (enemy.deathTimestamp && now - enemy.deathTimestamp > 2500) {
                continue;
              }
              if (enemy.deathTimestamp) {
                nextEnemies.push(enemy);
                continue;
              }
              let updatedEnemy: Enemy | null = { ...enemy, wasHit: false, vx: 0, vy: 0, effects: enemy.effects.filter(e => e.expires > now) };

              for (const cloud of activePersistentClouds) {
                const distSq = (cloud.x - updatedEnemy.position.col) ** 2 + (cloud.y - updatedEnemy.position.row) ** 2;
                if (distSq <= cloud.radius ** 2) {
                    const existingEffect = updatedEnemy.effects.find(e => e.type === cloud.effectType);
                    if (!existingEffect) {
                        updatedEnemy.effects.push({
                            type: cloud.effectType,
                            expires: now + cloud.duration,
                            potency: cloud.potency,
                            duration: cloud.duration,
                            lastTick: now,
                        });
                    }
                }
              }
              
              const dotResult = tickDots(updatedEnemy, delta);
              if (dotResult.totalDamage > 0) {
                 setDamageNumbers(prev => [...prev, { id: crypto.randomUUID(), amount: dotResult.totalDamage, targetId: updatedEnemy!.id, color: '#f97316' }]);
              }
              if (dotResult.killed && !updatedEnemy.deathTimestamp) {
                updatedEnemy.deathTimestamp = now;
              }
              if(updatedEnemy.deathTimestamp) {
                nextEnemies.push(updatedEnemy);
                continue;
              }
              const stunEffect = updatedEnemy.effects.find(e => e.type === 'stun');
              if (stunEffect) {
                  nextEnemies.push(updatedEnemy);
                  continue;
              }
              let teleported = false;
              if(portalsRef.current) {
                for (const portal of portalsRef.current) {
                    if (!portal.active) continue;
                    const entranceDistSq = (updatedEnemy.position.col - portal.entrance.col) ** 2 + (updatedEnemy.position.row - portal.entrance.row) ** 2;
                    if (entranceDistSq < 0.5 && now - (updatedEnemy.lastTeleportAt || 0) > portal.perEnemyCooldownMs) {
                        updatedEnemy.position = { ...portal.exit };
                        updatedEnemy.lastTeleportAt = now;
                        updatedEnemy.teleportsUsed = (updatedEnemy.teleportsUsed || 0) + 1;
                        updatedEnemy.path = findPath(portal.exit, {row: GRID_ROWS, col: GRID_COLS}, Object.values(towersByCellRef.current).map(t => t.position), GRID_ROWS, GRID_COLS) ?? [];
                        updatedEnemy.pathIndex = 0;
                        updatedEnemy.lastMove = now;
                        teleported = true;
                        break; 
                    }
                }
              }
              if (teleported) {
                  nextEnemies.push(updatedEnemy);
                  continue;
              }
              for (const well of activeGravityWells) {
                  const dx = well.x - updatedEnemy.position.col;
                  const dy = well.y - updatedEnemy.position.row;
                  const distSq = dx * dx + dy * dy;
                  if (distSq <= well.radius * well.radius) {
                      const dist = Math.sqrt(distSq);
                      if (dist > 0.1) {
                          const pullStrength = well.potency;
                          updatedEnemy.vx += (dx / dist) * pullStrength * (delta / 1000);
                          updatedEnemy.vy += (dy / dist) * pullStrength * (delta / 1000);
                      }
                  }
              }
              const slowEffect = updatedEnemy.effects.find(e => e.type === 'slow');
              const speed = updatedEnemy.speed * (slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1);
              const stepMs = 1000 / Math.max(0.001, speed);
              let timeToMove = now - updatedEnemy.lastMove;
              while (timeToMove >= stepMs) {
                  if (updatedEnemy.pathIndex < updatedEnemy.path.length - 1) {
                      updatedEnemy.pathIndex += 1;
                      updatedEnemy.position = updatedEnemy.path[updatedEnemy.pathIndex];
                      timeToMove -= stepMs;
                      updatedEnemy.lastMove += stepMs;
                  } else {
                      livesLostThisTick++;
                      audioManager.play({ kind: 'sfx', name: 'enemy_leak' });
                      updatedEnemy = null;
                      break;
                  }
              }
               if (updatedEnemy) {
                 if (updatedEnemy.health <= 0 && !updatedEnemy.deathTimestamp) {
                      updatedEnemy.deathTimestamp = now;
                 }
                 nextEnemies.push(updatedEnemy);
               }
            }
            
            setEnemies(nextEnemies);
            setGravityWells(activeGravityWells);
            setPersistentClouds(activePersistentClouds);
            setTotalKilled(prev => prev + killedThisTick);
            setTotalLeaked(prev => prev + livesLostThisTick);
            
            if (livesGainedThisTick > 0) {
                setGameState(prev => ({...prev, lives: prev.lives + livesGainedThisTick}));
            }
            if (resourcesGainedThisTick > 0) {
                setPlayers(prev => [{...prev[0], resources: prev[0].resources + resourcesGainedThisTick}]);
            }
            if (livesLostThisTick > 0) {
                setGameState(prev => {
                    const newLives = prev.lives - livesLostThisTick;
                    if (newLives <= 0) handleGameEnd(false);
                    return { ...prev, lives: newLives };
                });
            }
            
            if (nextEnemies.filter(e => !e.deathTimestamp).length === 0 && spawnQueueRef.current.length === 0 && !isIntermissionRef.current) {
                const nextWave = currentWaveRef.current + 1;
                
                if (gameConfig.waves[nextWave]) {
                  setPortals([]); // Portale am Ende der Welle entfernen
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
    }, [startWaveLogic, handleGameEnd, user, isCheating, gameConfig, buffedTowerIds]);

    const toggleMute = () => {
      setIsMuted(current => {
        const newMuted = !current;
        if (newMuted) audioManager.mute();
        else audioManager.unmute();
        return newMuted;
      });
    };
    
    if (configLoading || !gameConfig || !localPlayer) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
                <p className="text-muted-foreground">Lade Spielkonfiguration...</p>
            </div>
        );
    }

    const interactionPrompt = portalPhase !== 'idle'
      ? (portalPhase === 'entrance' ? 'Wähle den Eingang des Portals' : 'Wähle den Ausgang des Portals')
      : selectedTowerToBuild
      ? `Wähle Bauplatz für: ${selectedTowerToBuild?.name}`
      : focusedTower
      ? `Fokus: ${focusedTower?.name}`
      : 'Wähle einen Turm zum Bauen oder einen Arbeiter';

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
                    totalWaves={gameConfig.waves.length} 
                    difficulty={difficulty} 
                    handleGameControl={() => setGameStatus(prev => prev === 'playing' ? 'paused' : 'playing')} 
                    gameStatus={gameStatus} 
                    resetGame={onExit}
                    towers={gameConfig.towers} 
                    setTowers={() => {}} 
                    placedTowers={placedTowers} 
                    enemies={enemies}
                    workers={workers}
                    ghosts={ghosts}
                    portals={portals}
                    damageNumbers={damageNumbers} 
                    splashRings={splashRings}
                    persistentClouds={persistentClouds}
                    currentPath={currentPath} 
                    handlePlaceTower={handlePlaceTower}
                    onFocusTower={onFocusTower} 
                    selectedTowerToBuild={selectedTowerToBuild}
                    portalEntrance={portalEntrance}
                    focusedTower={focusedTower}
                    gameBoardRef={gameBoardRef}
                    interactionPrompt={interactionPrompt} 
                    cancelInteractions={cancelInteractions}
                    onSelectTowerToBuild={onSelectTowerToBuild}
                    onEnterPortalMode={onEnterPortalMode}
                    handleUpgradeTower={handleUpgradeTower}
                    handleSellTower={handleSellTower}
                    setFocusedTower={setFocusedTower}
                    spawnedThisWave={isIntermission ? 0 : (gameConfig.waves[currentWave]?.enemies.count - spawnQueueRef.current.length)}
                    totalEnemiesInWave={gameConfig.waves[currentWave]?.enemies.count || 0}
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
                    allTowers={gameConfig.towers}
                    attacks={attacks}
                    isPlacingPortalEntrance={portalPhase !== 'idle'}
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
