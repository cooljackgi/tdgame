
"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import GameSession from './game-session';
import type { Tower, PlacedTower, Enemy, Node, Element, Difficulty, Attack, DamageNumber, SplashRing, GameSaveState, GameResult, GameDelta } from '@/lib/game-data/types';
import { DeltaType } from '@/lib/game-data/types';
import { useToast } from '@/hooks/use-toast';
import { difficultyModifiers, ALL_PICKABLE_ELEMENTS, INTERMISSION_TIME, GRID_ROWS, GRID_COLS } from '@/lib/game-data/constants';
import type { User } from 'firebase/auth';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { normalizePlayers } from '@/lib/player-utils';
import { Loader2 } from 'lucide-react';
import { audioManager } from '@/lib/audio/audio-manager';
import { findPath } from '@/lib/pathfinding';

import type { Player, GameState, GameStatus } from './game-session';
import { LOCAL_STORAGE_KEY } from './game-session';
import { towers as initialTowers } from '@/lib/game-data/towers';
import { waves } from '@/lib/game-data/enemies';

const TUTORIAL_COMPLETED_KEY = 'nexus-tutorial-completed';

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

    // --- Synced State (local for single player) ---
    const [players, setPlayers] = useState<Player[]>([]);
    const [gameState, setGameState] = useState<GameState>({ lives: 20 });
    const [towersByCell, setTowersByCell] = useState<Record<string, PlacedTower>>({});
    const [currentWave, setCurrentWave] = useState(0);
    const [gameStatus, setGameStatus] = useState<GameStatus>('playing');
    const [difficulty, setDifficulty] = useState<Difficulty>(initialDifficulty);
    const [isIntermission, setIsIntermission] = useState(true);
    const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);
    const [enemies, setEnemies] = useState<Enemy[]>([]);
    const [spawnedThisWave, setSpawnedThisWave] = useState(0);
    const [fps, setFps] = useState(0);
    
    // --- VFX State ---
    const [attacks, setAttacks] = useState<Attack[]>([]);
    const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
    const [splashRings, setSplashRings] = useState<SplashRing[]>([]);
    const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string|null>(null);
    const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());

    // --- Local State ---
    const [showTutorial, setShowTutorial] = useState(false);
    const [finalGameResult, setFinalGameResult] = useState<GameResult | null>(null);

    const spawnerRef = useRef<NodeJS.Timeout>();
    const countdownRef = useRef<NodeJS.Timeout>();
    const startWaveRef = useRef<() => void>();
    const waveInProgressRef = useRef(false);
    const doneSpawningRef = useRef(false);

    const enemyIdCounter = useRef(0);

    const START_NODE = { row: 1, col: 1 };
    const END_NODE = { row: GRID_ROWS, col: GRID_COLS };
  
    const currentPath = useMemo(() => {
      const blockedPositions = Object.values(towersByCell).map(t => t.position);
      return findPath(START_NODE, END_NODE, blockedPositions, GRID_ROWS, GRID_COLS) || [];
    }, [towersByCell]);

    const saveFinishedGameResult = useCallback(async (resultToSave: GameResult): Promise<GameResult | null> => {
        if (!user || isCheating) return null;

        try {
            const docData = { ...resultToSave, date: serverTimestamp() };
            await addDoc(collection(db, "scores"), docData);
            localStorage.removeItem(LOCAL_STORAGE_KEY);
            return { ...resultToSave, date: new Date().toISOString() };
        } catch(e) {
            console.error("Failed to save score to Firestore", e);
            localStorage.removeItem(LOCAL_STORAGE_KEY);
            return null;
        }
    }, [user, isCheating]);

    const handleGameEnd = useCallback(async (result: GameResult) => {
        if (gameStatus !== 'gameover') {
            const savedResult = await saveFinishedGameResult(result);
            setFinalGameResult(savedResult || result); // Use saved result with timestamp or fallback
            setGameStatus('gameover');
        }
    }, [gameStatus, saveFinishedGameResult]);

    const saveGameState = useCallback(() => {
        if (gameStatus === 'gameover' || isCheating) return;
        
        const stateToSave: GameSaveState = {
            players: { 
                player1: players.find(p => p.id === 'player1')!,
                player2: null,
            },
            gameState,
            towersByCell,
            enemies: [], // Always save without enemies to start in intermission
            currentWave,
            difficulty,
        };
        
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stateToSave));
        toast({ title: 'Spiel gespeichert!' });
    }, [gameStatus, players, gameState, towersByCell, currentWave, difficulty, toast, isCheating]);


    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
          if (gameStatus === 'playing') {
            saveGameState();
          }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [gameStatus, saveGameState]);

    useEffect(() => {
        const handleVisibilityChange = () => {
          if (document.visibilityState === 'hidden' && gameStatus === 'playing') {
            saveGameState();
            setGameStatus('paused');
          }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [gameStatus, saveGameState]);

    const applyDeltas = useCallback((deltas: GameDelta[]) => {
        deltas.forEach(delta => {
            const type = delta[0];
            switch(type) {
                case DeltaType.ENEMY_SPAWN: {
                    const newEnemy = { ...delta[1], path: currentPath };
                    setEnemies(prev => [...prev, newEnemy]);
                    break;
                }
                case DeltaType.ENEMY_MOVE: {
                    const [id, pathIndex, now] = delta.slice(1);
                    setEnemies(prev => prev.map(e => {
                        if (e.id === id) {
                            return { ...e, pathIndex, lastMove: now, position: currentPath[pathIndex] || e.position };
                        }
                        return e;
                    }));
                    break;
                }
                case DeltaType.ENEMY_DAMAGE: {
                    const [id, damage] = delta.slice(1);
                    setEnemies(prev => prev.map(e => e.id === id ? { ...e, health: e.health - (damage as number), wasHit: true } : e));
                    setTimeout(() => setEnemies(prev => prev.map(e => e.id === id ? { ...e, wasHit: false } : e)), 150);
                    break;
                }
                case DeltaType.ENEMY_DIE: {
                    const id = delta[1];
                    setEnemies(prev => prev.filter(e => e.id !== id));
                    break;
                }
                case DeltaType.ENEMY_REACH_END: {
                    const id = delta[1];
                    setEnemies(prev => prev.filter(e => e.id !== id));
                    setGameState(s => ({ ...s, lives: Math.max(0, s.lives - 1) }));
                    break;
                }
                case DeltaType.ENEMY_ADD_EFFECT: {
                    const [id, effect] = delta.slice(1);
                    setEnemies(prev => prev.map(e => {
                      if(e.id === id) {
                         const existingEffectIndex = e.effects.findIndex(ef => ef.type === effect.type);
                         const newEffects = [...e.effects];
                         if (existingEffectIndex !== -1) {
                            newEffects[existingEffectIndex] = effect;
                         } else {
                            newEffects.push(effect);
                         }
                         return {...e, effects: newEffects};
                      }
                      return e;
                    }));
                    break;
                }
                case DeltaType.ENEMY_REMOVE_EFFECT: {
                    const [id, effectType] = delta.slice(1);
                    setEnemies(prev => prev.map(e => e.id === id ? { ...e, effects: e.effects.filter(ef => ef.type !== effectType) } : e));
                    break;
                }
                case DeltaType.TOWER_ATTACK:
                    setAttacks(prev => [...prev.slice(-200), delta[1]]);
                    audioManager.playSfx('shoot', 0.3);
                    setFiringTowerIds(prev => new Set(prev).add((delta[1] as Attack).towerId));
                    setTimeout(() => setFiringTowerIds(prev => {
                        const s = new Set(prev);
                        s.delete((delta[1] as Attack).towerId);
                        return s;
                    }), 150);
                    break;
                case DeltaType.VFX_DAMAGE_NUMBER:
                    setDamageNumbers(prev => [...prev.slice(-100), delta[1]]);
                    break;
                case DeltaType.VFX_SPLASH:
                    setSplashRings(prev => [...prev.slice(-50), delta[1]]);
                    break;
                case DeltaType.GAME_STATE_UPDATE: {
                    const newState = delta[1] as Partial<GameState & { gameStatus: GameStatus, currentWave: number, isIntermission: boolean, waveStartCountdown: number, spawnedThisWave: number }>;
                    if (newState.gameStatus) setGameStatus(newState.gameStatus);
                    if (newState.currentWave !== undefined) setCurrentWave(newState.currentWave);
                    if (newState.isIntermission !== undefined) {
                        setIsIntermission(newState.isIntermission);
                        if(newState.isIntermission) saveGameState();
                    }
                    if (newState.waveStartCountdown !== undefined) setWaveStartCountdown(newState.waveStartCountdown);
                    if (newState.lives !== undefined) setGameState(s => ({...s, lives: newState.lives!}));
                    if (newState.spawnedThisWave !== undefined) setSpawnedThisWave(newState.spawnedThisWave);
                    break;
                }
                 case DeltaType.TOWERS_UPDATE:
                    setTowersByCell(delta[1]);
                    break;
                case DeltaType.PLAYER_UPDATE: {
                     const playerUpdates = delta[1] as Record<string, Partial<Player>>;
                     setPlayers(prev => prev.map(p => {
                        const update = playerUpdates[p.id];
                        if (update) {
                            return {...p, ...update};
                        }
                        return p;
                     }));
                    break;
                }
            }
        });
    }, [currentPath, saveGameState]);
    
      const handlePlaceTower = useCallback((row: number, col: number) => {
        const player = players.find(p => p.id === 'player1');
        const selectedTowerToBuild = initialTowers.find(t => t.isBase);

        if (!selectedTowerToBuild || !player) return;

        const cellKey = `${row}_${col}`;
        const cost = selectedTowerToBuild.cost;

        if (towersByCell[cellKey] || player.resources < cost) {
            toast({ title: "Bau nicht möglich", description: "Feld belegt oder nicht genug Ressourcen.", variant: "destructive" });
            return;
        }

        const newTower: PlacedTower = {
            ...selectedTowerToBuild,
            specId: selectedTowerToBuild.id,
            id: `tower-${row}-${col}`,
            position: { row, col },
            lastAttack: 0,
            health: selectedTowerToBuild.maxHealth,
            ownerId: player.id,
            isBase: true
        };

        const newTowers = { ...towersByCell, [cellKey]: newTower };
        const newPath = findPath(START_NODE, END_NODE, Object.values(newTowers).map(t => t.position), GRID_ROWS, GRID_COLS);

        if (!newPath) {
            toast({ title: "Bau fehlgeschlagen", description: "Der Weg darf nicht blockiert werden.", variant: 'destructive' });
            return;
        }

        const deltas: GameDelta[] = [
          [DeltaType.TOWERS_UPDATE, newTowers],
          [DeltaType.PLAYER_UPDATE, { [player.id]: { resources: player.resources - cost } }]
        ];

        applyDeltas(deltas);
        audioManager.playSfx('build_tower');
    }, [players, towersByCell, toast, applyDeltas]);

    useEffect(() => {
        const tutorialCompleted = localStorage.getItem(TUTORIAL_COMPLETED_KEY) === 'true';

        if (initialSavedGame && !isCheating) {
            const now = performance.now();
            const towersFromSave = Object.values(initialSavedGame.towersByCell || {});
            
            const rehydratedTowers = towersFromSave.reduce((acc, savedTower) => {
                const towerSpec = initialTowers.find(t => t.id === savedTower.specId);
                if (towerSpec) {
                    const rehydratedTower: PlacedTower = { ...towerSpec, ...savedTower, id: savedTower.id, lastAttack: now, isBase: savedTower.isBase };
                    acc[`${savedTower.position.row}_${savedTower.position.col}`] = rehydratedTower;
                }
                return acc;
            }, {} as Record<string, PlacedTower>);
            
            setPlayers(normalizePlayers(initialSavedGame.players));
            setGameState(initialSavedGame.gameState);
            setTowersByCell(rehydratedTowers);
            setEnemies([]);
            setCurrentWave(initialSavedGame.currentWave);
            setDifficulty(initialSavedGame.difficulty);
            if (startWithTutorial) setShowTutorial(true);
        } else { // New game
            const difficultyMod = difficultyModifiers[difficulty];
            const startLives = isCheating ? 999 : difficultyMod.startLives;
            const startRes = isCheating ? 99999 : difficultyMod.startResources;
            const startElements = isCheating ? ['neutral', ...ALL_PICKABLE_ELEMENTS] : ['neutral'] as Player['unlockedElements'];

            const player1: Player = { id: 'player1', name: isCheating ? 'Chaos-Meister' : (user?.displayName || 'Spieler 1'), resources: startRes, unlockedElements: startElements, avatarUrl: user?.photoURL || null };
            setPlayers([player1]);
            setGameState({ lives: startLives });
            setTowersByCell({});
            setEnemies([]);
            setCurrentWave(0);
            setDifficulty(initialDifficulty);

            if (!tutorialCompleted || startWithTutorial) {
                setShowTutorial(true);
            }
        }
        setIsIntermission(true);
        setGameStatus('playing');
        setWaveStartCountdown(INTERMISSION_TIME);

    }, [initialSavedGame, isCheating, startWithTutorial, initialDifficulty, user]);

    
    const startWave = useCallback(() => {
        if (currentWave >= waves.length) return;

        if (waveInProgressRef.current) return;
        waveInProgressRef.current = true;
        
        if (spawnerRef.current) clearTimeout(spawnerRef.current);
        spawnerRef.current = undefined;
        
        doneSpawningRef.current = false;
        
        setSpawnedThisWave(0);
        
        audioManager.playWaveMusic();
      
        const waveData = waves[currentWave];
        let spawnedCount = 0;
      
        const spawnEnemy = () => {
          if (gameStatus !== 'playing' || isIntermission) {
            if (spawnerRef.current) clearTimeout(spawnerRef.current);
            spawnerRef.current = undefined;
            return;
          }
          if (spawnedCount >= waveData.enemies.count) {
            if (spawnerRef.current) clearTimeout(spawnerRef.current);
            spawnerRef.current = undefined;
            doneSpawningRef.current = true;
            return;
          }
      
          const health = isCheating ? waveData.enemies.health : Math.round(waveData.enemies.health * difficultyModifiers[difficulty].enemyHealth);
          
          let movementPattern: Enemy['movementPattern'];
          switch(waveData.enemies.type) {
            case 'schnell': movementPattern = 'zigzag'; break;
            case 'gepanzert': case 'boss': movementPattern = 'straight'; break;
            default: movementPattern = 'wobble'; break;
          }
    
          const enemyId = `enemy-${enemyIdCounter.current++}`;
          const newEnemy: Enemy = {
            id: enemyId, ...waveData.enemies, health, maxHealth: health,
            pathIndex: 0, position: START_NODE, isBlocked: false, effects: [],
            lastMove: performance.now(), wasHit: false, targetNode: END_NODE,
            movementPattern: movementPattern, path: [], // Path is now added in applyDeltas
          };
          
          applyDeltas([[DeltaType.ENEMY_SPAWN, newEnemy]]);
          
          spawnedCount++;
          setSpawnedThisWave(c => c + 1);
          spawnerRef.current = setTimeout(spawnEnemy, waveData.enemies.spawnDelay);
        };
    
        spawnEnemy();
    }, [currentWave, gameStatus, difficulty, isCheating, applyDeltas, isIntermission]);
      
    useEffect(() => { startWaveRef.current = startWave; }, [startWave]);

    useEffect(() => {
        if (!isIntermission || gameStatus !== 'playing') {
            if (countdownRef.current) clearInterval(countdownRef.current);
            return;
        }

        countdownRef.current = setInterval(() => {
            setWaveStartCountdown(prev => {
                const newTime = prev - 1;
                
                if (newTime <= 0) {
                    if (countdownRef.current) clearInterval(countdownRef.current);
                    setIsIntermission(false);
                    return 0;
                }
                return newTime;
            });
        }, 1000);

        return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
    }, [isIntermission, gameStatus, setWaveStartCountdown, setIsIntermission]);

    useEffect(() => {
        if (gameStatus === 'playing' && !isIntermission && !waveInProgressRef.current) {
            startWaveRef.current?.();
        }
    }, [isIntermission, gameStatus]);


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
            broadcastGameData={applyDeltas}
            applyDeltas={applyDeltas}
            onGameEnd={handleGameEnd}
            onExit={onExit}
            handlePlaceTower={handlePlaceTower}
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
        />
    )
}

    