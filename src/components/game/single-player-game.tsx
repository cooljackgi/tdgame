"use client";

import { GameSession } from '@/components/game/game-session';
import type { Difficulty, GameSaveState, User } from '@/lib/game-data/types';
import { towers as initialTowers } from '@/lib/game-data/towers';

export default function SinglePlayerGame({
    difficulty,
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

    return (
        <GameSession
            // Config
            difficulty={difficulty}
            isCoop={false}
            isGameHost={true}
            localPlayerId="player1"
            isCheating={isCheating}
            startWithTutorial={startWithTutorial}
            user={user}
            allTowers={initialTowers}
            
            // Initial State
            initialSavedGame={initialSavedGame}

            // Callbacks
            onExit={onExit}
        />
    )
}
