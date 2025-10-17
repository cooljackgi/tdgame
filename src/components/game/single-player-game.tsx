

"use client";

import { useState, useEffect } from 'react';
import type { Tower, PlacedTower, Enemy, Element, Difficulty, GameSaveState } from '@/lib/game-data/types';
import { difficultyModifiers, ALL_PICKABLE_ELEMENTS, INTERMISSION_TIME } from '@/lib/game-data/constants';
import type { User } from 'firebase/auth';
import GameSession from './game-session';
import type { Player, GameState } from './game-session';

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
    
    const [initialState] = useState(() => {
        if (initialSavedGame) {
            return {
                players: [initialSavedGame.players.player1],
                gameState: initialSavedGame.gameState,
                towersByCell: initialSavedGame.towersByCell,
                enemies: initialSavedGame.enemies,
                currentWave: initialSavedGame.currentWave,
                difficulty: initialSavedGame.difficulty,
                isIntermission: true, // Always start in intermission when loading
                waveStartCountdown: INTERMISSION_TIME
            };
        } else {
            const difficultyMod = difficultyModifiers[initialDifficulty];
            const startLives = isCheating ? 999 : difficultyMod.startLives;
            const startRes = isCheating ? 99999 : difficultyMod.startResources;
            const startElements = isCheating ? ['neutral', ...ALL_PICKABLE_ELEMENTS] as Element[] : ['neutral'] as Element[];

            const player1: Player = { 
                id: 'player1', 
                name: isCheating ? 'Chaos-Meister' : (user?.displayName || 'Spieler 1'), 
                resources: startRes, 
                unlockedElements: startElements, 
                avatarUrl: user?.photoURL || null 
            };
            
            return {
                players: [player1],
                gameState: { lives: startLives },
                towersByCell: {},
                enemies: [],
                currentWave: 0,
                difficulty: initialDifficulty,
                isIntermission: true,
                waveStartCountdown: INTERMISSION_TIME
            };
        }
    });

    if (!initialState.players.length) {
        // Should not happen, but as a fallback
        return <div>Lade Spielerdaten...</div>;
    }

    return (
        <GameSession
            // --- Initial State & Config ---
            initialPlayers={initialState.players}
            initialGameState={initialState.gameState}
            initialTowersByCell={initialState.towersByCell}
            initialEnemies={initialState.enemies}
            initialCurrentWave={initialState.currentWave}
            initialDifficulty={initialState.difficulty}
            initialIsIntermission={initialState.isIntermission}
            initialWaveStartCountdown={initialState.waveStartCountdown}
            isCoop={false}
            isGameHost={true}
            localPlayerId="player1"
            isCheating={isCheating}
            user={user}

            // --- Control Functions ---
            onExit={onExit}
        />
    );
}
