

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
import { DeltaType, GameDelta } from '@/lib/game-data/types';

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
    }, [saveGameState, user, isCheating, difficulty, gameStatus]);

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
    
    const localApplyDeltas = useCallback((deltas: GameDelta[]) => {
      deltas.forEach(delta => {
        const type = delta[0];
        const payload = delta[1];
        switch (type) {
          case DeltaType.ENEMY_SPAWN: setEnemies(prev => [...prev, payload]); break;
          case DeltaType.ENEMY_MOVE:
            const [id, pathIndex, now] = delta.slice(1);
            setEnemies(prev => prev.map(e => e.id === id ? { ...e, pathIndex, lastMove: now } : e));
            break;
          case DeltaType.ENEMY_REACH_END:
            setEnemies(prev => prev.filter(e => e.id !== payload));
            break;
          case DeltaType.GAME_STATE_UPDATE:
            if(payload.lives !== undefined) setGameState(g => ({...g, lives: payload.lives}));
            if(payload.spawnedThisWave !== undefined) setSpawnedThisWave(payload.spawnedThisWave);
            break;
          // Other delta types for single player can be added here if needed
        }
      });
    }, []);

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
            broadcastGameData={localApplyDeltas}
            applyDeltas={localApplyDeltas}
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
