
"use client";

import { useMemo } from 'react';
import { GameSession } from '@/components/game/game-session';
import type { Difficulty, GameSaveState, User, Player, GameState, PlacedTower } from '@/lib/game-data/types';
import { towers as initialTowers } from '@/lib/game-data/towers';
import { difficultyModifiers } from '@/lib/game-data/constants';

export default function SinglePlayerGame({
    difficulty,
    onExit,
    initialSavedGame,
    isCheating = false,
    startWithTutorial = false, // This prop is for future use, GameSession doesn't use it directly yet
    user
}: {
    difficulty: Difficulty,
    onExit: () => void,
    initialSavedGame: GameSaveState | null,
    isCheating?: boolean,
    startWithTutorial?: boolean,
    user: User | null
}) {
    // This logic generates the initial state for the game session.
    // It was missing, causing the 'find of undefined' error.
    const initialState = useMemo(() => {
        if (initialSavedGame) {
            return {
                players: [initialSavedGame.players.player1],
                gameState: initialSavedGame.gameState,
                towersByCell: initialSavedGame.towersByCell,
                enemies: initialSavedGame.enemies,
                currentWave: initialSavedGame.currentWave,
                difficulty: initialSavedGame.difficulty,
                isIntermission: true, // Always start in intermission from a save
                waveStartCountdown: 15,
            };
        }

        const difficultyMod = difficultyModifiers[difficulty];
        const player1: Player = {
            id: 'player1',
            name: user?.displayName || 'Spieler 1',
            resources: difficultyMod.startResources,
            unlockedElements: ['neutral'],
            avatarUrl: user?.photoURL || null,
        };

        return {
            players: [player1],
            gameState: { lives: difficultyMod.startLives },
            towersByCell: {} as Record<string, PlacedTower>,
            enemies: [],
            currentWave: 0,
            difficulty: difficulty,
            isIntermission: true,
            waveStartCountdown: 999, // Long countdown for the very first wave
        };
    }, [initialSavedGame, difficulty, user]);


    return (
        <GameSession
            // Config
            isCoop={false}
            isGameHost={true}
            localPlayerId="player1"
            isCheating={isCheating}
            user={user}
            allTowers={initialTowers}
            
            // Initial State
            initialPlayers={initialState.players}
            initialGameState={initialState.gameState}
            initialTowersByCell={initialState.towersByCell}
            initialEnemies={initialState.enemies}
            initialCurrentWave={initialState.currentWave}
            initialDifficulty={initialState.difficulty}
            initialIsIntermission={initialState.isIntermission}
            initialWaveStartCountdown={initialState.waveStartCountdown}

            // Callbacks
            onExit={onExit}
        />
    )
}
