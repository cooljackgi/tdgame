
"use client";

import { useMemo, useState, useCallback } from 'react';
import { GameSession } from '@/components/game/game-session';
import type { Difficulty, GameSaveState, User, Player, GameState, PlacedTower, Tower } from '@/lib/game-data/types';
import { towers as initialTowers } from '@/lib/game-data/towers';
import { difficultyModifiers, GRID_COLS, GRID_ROWS } from '@/lib/game-data/constants';
import { findPath } from '@/lib/pathfinding';
import { useToast } from '@/hooks/use-toast';

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

    // The single-player component now manages its own state, just like the coop-loader.
    const [players, setPlayers] = useState<Player[]>([]);
    const [gameState, setGameState] = useState<GameState>({ lives: 20 });
    const [towersByCell, setTowersByCell] = useState<Record<string, PlacedTower>>({});
    const [currentWave, setCurrentWave] = useState(0);
    const [difficulty, setDifficulty] = useState(initialDifficulty);
    const [enemies, setEnemies] = useState<any[]>([]); // Let GameSession manage this internally for SP
    const [isIntermission, setIsIntermission] = useState(true);
    const [waveStartCountdown, setWaveStartCountdown] = useState(999);
    const [justPlacedTowerId, setJustPlacedTowerId] = useState<string | null>(null);

    // This useMemo block correctly sets up the initial state ONCE.
    useMemo(() => {
        if (initialSavedGame) {
            setPlayers([initialSavedGame.players.player1]);
            setGameState(initialSavedGame.gameState);
            setTowersByCell(initialSavedGame.towersByCell);
            setEnemies(initialSavedGame.enemies);
            setCurrentWave(initialSavedGame.currentWave);
            setDifficulty(initialSavedGame.difficulty);
            setIsIntermission(true);
            setWaveStartCountdown(15);
            return;
        }

        const difficultyMod = difficultyModifiers[initialDifficulty];
        const player1: Player = {
            id: 'player1',
            name: user?.displayName || 'Spieler 1',
            resources: difficultyMod.startResources,
            unlockedElements: ['neutral'],
            avatarUrl: user?.photoURL || null,
        };

        setPlayers([player1]);
        setGameState({ lives: difficultyMod.startLives });
        setTowersByCell({});
        setEnemies([]);
        setCurrentWave(0);
        setDifficulty(initialDifficulty);
        setIsIntermission(true);
        setWaveStartCountdown(999);
    }, [initialSavedGame, initialDifficulty, user]);


    // The local action handler for single-player. It modifies state directly.
    const onLocalAction = useCallback((action: 'build' | 'upgrade' | 'sell', payload: any) => {
        const player = players[0];
        if (!player) return;

        if (action === 'build') {
            const { row, col, towerId } = payload;
            const towerSpec = initialTowers.find(t => t.id === towerId);
            if (!towerSpec || player.resources < towerSpec.cost) return;

            const cellKey = `${row}_${col}`;
            if (towersByCell[cellKey]) return;
            
            const currentPlacedTowers = Object.values(towersByCell).map(t => t.position);
            const newPath = findPath({row:1, col:1}, {row:GRID_ROWS, col:GRID_COLS}, [...currentPlacedTowers, {row, col}], GRID_ROWS, GRID_COLS);
            
            if (!newPath) {
                toast({ title: 'Ungültiger Bauplatz', description: 'Der Weg für die Gegner darf nicht blockiert werden.', variant: 'destructive' });
                return;
            }

            const newTower: PlacedTower = JSON.parse(JSON.stringify({
                ...towerSpec, id: `tower-${row}-${col}-${Date.now()}`, specId: towerSpec.id,
                position: { row, col }, lastAttack: 0, health: towerSpec.maxHealth, ownerId: player.id,
            }));

            setTowersByCell(prev => ({ ...prev, [cellKey]: newTower }));
            setPlayers(prev => [{ ...prev[0], resources: prev[0].resources - newTower.cost }]);
            setJustPlacedTowerId(newTower.id);
            setTimeout(() => setJustPlacedTowerId(null), 500);

        } else if (action === 'upgrade') {
            const { row, col, upgradeId } = payload;
            const cellKey = `${row}_${col}`;
            const focusedTower = towersByCell[cellKey];
            if (!focusedTower) return;

            const upgradeTowerSpec = initialTowers.find(t => t.id === upgradeId);
            if (!upgradeTowerSpec) return;
            
            const refundPercentage = difficulty === 'Einfach' ? 1.0 : 0.75;
            const cost = Math.max(0, upgradeTowerSpec.cost - Math.floor(focusedTower.cost * refundPercentage));
            
            if (player.resources < cost) return;

            const newPlacedTower: PlacedTower = JSON.parse(JSON.stringify({ 
                ...focusedTower, ...upgradeTowerSpec, specId: upgradeTowerSpec.id, health: upgradeTowerSpec.maxHealth 
            }));
            
            setTowersByCell(prev => ({ ...prev, [cellKey]: newPlacedTower }));
            setPlayers(prev => [{ ...prev[0], resources: prev[0].resources - cost }]);

        } else if (action === 'sell') {
            const { row, col } = payload;
            const cellKey = `${row}_${col}`;
            const focusedTower = towersByCell[cellKey];
            if (!focusedTower) return;

            const refundPercentage = difficulty === 'Einfach' ? 1.0 : 0.75;
            const refund = Math.round(focusedTower.cost * refundPercentage);

            setTowersByCell(prev => {
                const newTowers = { ...prev };
                delete newTowers[cellKey];
                return newTowers;
            });
            setPlayers(prev => [{ ...prev[0], resources: prev[0].resources + refund }]);
        }
    }, [players, towersByCell, difficulty, toast]);


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
            initialPlayers={players}
            initialGameState={gameState}
            initialTowersByCell={towersByCell}
            initialEnemies={enemies}
            initialCurrentWave={currentWave}
            initialDifficulty={difficulty}
            initialIsIntermission={isIntermission}
            initialWaveStartCountdown={waveStartCountdown}
            justPlacedTowerIdFromParent={justPlacedTowerId}

            // Callbacks
            onExit={onExit}
            onLocalAction={onLocalAction}
        />
    )
}
