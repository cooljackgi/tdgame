

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
import GameSession from './game-session';
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
    const [gameStatus, setGameStatus] = useState<GameStatus>('playing');
    const [finalGameResult, setFinalGameResult] = useState<GameResult | null>(null);
    
    // --- Refs for game state data (to prevent re-renders in the loop) ---
    const playersRef = useRef<Player[]>([]);
    const gameStateRef = useRef<GameState>({ lives: 20 });
    const difficultyRef = useRef<Difficulty>(initialDifficulty);
    const isIntermissionRef = useRef(true);
    const waveStartCountdownRef = useRef(INTERMISSION_TIME);
    const currentWaveRef = useRef(0);
    const towersByCellRef = useRef<Record<string, PlacedTower>>({});
    const enemiesRef = useRef<Enemy[]>([]);
    const spawnedThisWaveRef = useRef(0);

    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (initialSavedGame) {
            playersRef.current = normalizePlayers(initialSavedGame.players);
            gameStateRef.current = initialSavedGame.gameState;
            towersByCellRef.current = initialSavedGame.towersByCell;
            enemiesRef.current = initialSavedGame.enemies;
            currentWaveRef.current = initialSavedGame.currentWave;
            difficultyRef.current = initialSavedGame.difficulty;
        } else {
            const difficultyMod = difficultyModifiers[initialDifficulty];
            const startLives = isCheating ? 999 : difficultyMod.startLives;
            const startRes = isCheating ? 99999 : difficultyMod.startResources;
            const startElements = isCheating ? ['neutral', ...ALL_PICKABLE_ELEMENTS] as Element[] : ['neutral'] as Element[];

            const player1: Player = { id: 'player1', name: isCheating ? 'Chaos-Meister' : (user?.displayName || 'Spieler 1'), resources: startRes, unlockedElements: startElements, avatarUrl: user?.photoURL || null };
            playersRef.current = [player1];
            gameStateRef.current = { lives: startLives };
        }
        isIntermissionRef.current = true;
        setGameStatus('playing');
        waveStartCountdownRef.current = INTERMISSION_TIME;

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
          if (gameStatus !== 'gameover' && !isCheating) {
            saveGameState();
          }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        
        const interval = setInterval(() => setTick(t => t + 1), 1000);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            clearInterval(interval);
        }

    }, [initialSavedGame, isCheating, startWithTutorial, initialDifficulty, user]);
    

    const saveGameState = useCallback(() => {
        if (gameStatus === 'gameover' || isCheating) return;
        const stateToSave: GameSaveState = {
            players: { player1: playersRef.current[0], player2: null },
            gameState: gameStateRef.current, 
            towersByCell: towersByCellRef.current, 
            enemies: enemiesRef.current, 
            currentWave: currentWaveRef.current, 
            difficulty: difficultyRef.current
        };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stateToSave));
        toast({ title: 'Spiel gespeichert!' });
    }, [gameStatus, isCheating, toast]);
    
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
    
    const localPlayer = playersRef.current[0];

    return (
        <GameSession
            players={playersRef.current}
            setPlayers={(updater) => {
                if (typeof updater === 'function') playersRef.current = updater(playersRef.current);
                else playersRef.current = updater;
            }}
            gameState={gameStateRef.current}
            setGameState={(updater) => {
                if (typeof updater === 'function') gameStateRef.current = updater(gameStateRef.current);
                else gameStateRef.current = updater;
            }}
            towersByCell={towersByCellRef.current}
            setTowersByCell={(updater) => {
                 if (typeof updater === 'function') towersByCellRef.current = updater(towersByCellRef.current);
                 else towersByCellRef.current = updater;
            }}
            currentWave={currentWaveRef.current}
            setCurrentWave={(updater) => {
                if (typeof updater === 'function') currentWaveRef.current = updater(currentWaveRef.current);
                else currentWaveRef.current = updater;
            }}
            gameStatus={gameStatus}
            setGameStatus={setGameStatus}
            difficulty={difficultyRef.current}
            setDifficulty={(d) => difficultyRef.current = d}
            isIntermission={isIntermissionRef.current}
            setIsIntermission={(val) => isIntermissionRef.current = val}
            waveStartCountdown={waveStartCountdownRef.current}
            setWaveStartCountdown={(val) => waveStartCountdownRef.current = typeof val === 'function' ? val(waveStartCountdownRef.current) : val}
            enemies={enemiesRef.current}
            setEnemies={(updater) => {
                 if (typeof updater === 'function') enemiesRef.current = updater(enemiesRef.current);
                 else enemiesRef.current = updater;
            }}
            spawnedThisWave={spawnedThisWaveRef.current}
            setSpawnedThisWave={(val) => spawnedThisWaveRef.current = typeof val === 'function' ? val(spawnedThisWaveRef.current) : val}
            onGameEnd={handleGameEnd}
            onExit={onExit}
            localPlayerId="player1"
            isCoop={false}
            isGameHost={true}
            broadcastGameData={() => {}}
            applyDeltas={() => {}}
            onLocalAction={() => {}}
            // Non-state versions for session
            currentPath={findPath( { row: 1, col: 1 }, { row: GRID_ROWS, col: GRID_COLS }, Object.values(towersByCellRef.current), GRID_ROWS, GRID_COLS) || []}
            attacks={[]}
            damageNumbers={[]}
            splashRings={[]}
            lastUpgradedTowerId={null}
            setLastUpgradedTowerId={() => {}}
            firingTowerIds={new Set()}
            setFiringTowerIds={() => {}}
            fps={0}
            setFps={() => {}}
            totalKilled={0}
            setTotalKilled={()=>{}}
            totalLeaked={0}
            setTotalLeaked={()=>{}}
            finalGameResult={finalGameResult}
            allTowers={initialTowers}
        />
    )
}

