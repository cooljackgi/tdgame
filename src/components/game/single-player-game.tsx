
"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { GameSession } from '@/components/game/game-session';
import type { Difficulty, GameSaveState, User, Player, GameState, PlacedTower, Tower, Node, Element, Enemy, Attack, DamageNumber, SplashRing } from '@/lib/game-data/types';
import { towers as initialTowers } from '@/lib/game-data/towers';
import { waves } from '@/lib/game-data/enemies';
import { difficultyModifiers, GRID_COLS, GRID_ROWS, LOCAL_STORAGE_KEY, INTERMISSION_TIME } from '@/lib/game-data/constants';
import { findPath } from '@/lib/pathfinding';
import { useToast } from '@/hooks/use-toast';
import { audioManager } from '@/lib/audio/audio-manager';
import type { GameBoardHandle } from './game-board';

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
    const [currentWave, setCurrentWave] = useState(0);
    const [difficulty, setDifficulty] = useState(initialDifficulty);
    const [enemies, setEnemies] = useState<Enemy[]>([]);
    const [gameStatus, setGameStatus] = useState<"waiting" | "playing" | "paused" | "gameover" | "picking-element">('playing');
    
    // --- UI/Interaction State ---
    const [selectedTowerToBuild, setSelectedTowerToBuild] = useState<Tower | null>(null);
    const [justPlacedTowerId, setJustPlacedTowerId] = useState<string | null>(null);
    const [focusedTower, setFocusedTower] = useState<PlacedTower | null>(null);
    const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string | null>(null);

    // --- VFX State ---
    const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
    const [splashRings, setSplashRings] = useState<SplashRing[]>([]);
    const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());
    
    // --- Game Loop Refs ---
    const gameLoopRef = useRef<number>();
    const lastTickRef = useRef(performance.now());
    const spawnerStateRef = useRef<{ count: number; timer: number; waveData: any } | null>(null);
    const enemyIdCounter = useRef(0);
    const gameBoardRef = useRef<GameBoardHandle>(null);

    const isIntermission = useMemo(() => enemies.length === 0 && !spawnerStateRef.current, [enemies]);
    const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);

    // --- Refs for stable access in game loop ---
    const playersRef = useRef(players);
    const towersByCellRef = useRef(towersByCell);
    const enemiesRef = useRef(enemies);
    const gameStateRef = useRef(gameState);
    const currentWaveRef = useRef(currentWave);
    const difficultyRef = useRef(difficulty);
    const gameStatusRef = useRef(gameStatus);
    const localPlayerRef = useRef<Player | undefined>(undefined);

    useEffect(() => { playersRef.current = players; localPlayerRef.current = players[0]; }, [players]);
    useEffect(() => { towersByCellRef.current = towersByCell; }, [towersByCell]);
    useEffect(() => { enemiesRef.current = enemies; }, [enemies]);
    useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
    useEffect(() => { currentWaveRef.current = currentWave; }, [currentWave]);
    useEffect(() => { difficultyRef.current = difficulty; }, [difficulty]);
    useEffect(() => { gameStatusRef.current = gameStatus; }, [gameStatus]);

    useMemo(() => {
        if (initialSavedGame) {
            setPlayers([initialSavedGame.players.player1]);
            setGameState(initialSavedGame.gameState);
            setTowersByCell(initialSavedGame.towersByCell);
            setEnemies(initialSavedGame.enemies);
            setCurrentWave(initialSavedGame.currentWave);
            setDifficulty(initialSavedGame.difficulty);
            setGameStatus('playing');
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
        setGameStatus('playing');
    }, [initialSavedGame, initialDifficulty, user]);
    
    const localPlayer = useMemo(() => players.find(p => p.id === 'player1'), [players]);

    const handlePlaceTower = useCallback((row: number, col: number) => {
        if (!selectedTowerToBuild || !localPlayerRef.current) return;
        
        const cellIsBlocked = Object.values(towersByCellRef.current).some(t => t.position.row === row && t.position.col === col);
        if (cellIsBlocked) return;
        
        const isStartOrEnd = (row === 1 && col === 1) || (row === GRID_ROWS && col === GRID_COLS);
        if (isStartOrEnd) return;

        if (localPlayerRef.current.resources < selectedTowerToBuild.cost) {
            toast({ title: 'Nicht genügend Ressourcen', variant: 'destructive' });
            return;
        }

        const newBlockedPositions = [...Object.values(towersByCellRef.current).map(t => t.position), { row, col }];
        if (!findPath({ row: 1, col: 1 }, { row: GRID_ROWS, col: GRID_COLS }, newBlockedPositions, GRID_ROWS, GRID_COLS)) {
            toast({ title: 'Ungültiger Bauplatz', description: 'Der Weg für die Gegner darf nicht blockiert werden.', variant: 'destructive' });
            return;
        }
        
        const newTower: PlacedTower = {
            ...selectedTowerToBuild,
            id: `tower-${row}-${col}-${Date.now()}`,
            specId: selectedTowerToBuild.id,
            position: { row, col },
            lastAttack: performance.now() - 99999,
            health: selectedTowerToBuild.maxHealth,
            ownerId: localPlayerRef.current.id,
        };

        setTowersByCell(prev => ({ ...prev, [`${row}_${col}`]: newTower }));
        setPlayers(prev => [{ ...prev[0], resources: prev[0].resources - newTower.cost }]);
        setJustPlacedTowerId(newTower.id);
        setFocusedTower(newTower);
        setSelectedTowerToBuild(null);
        setTimeout(() => setJustPlacedTowerId(null), 500);

    }, [selectedTowerToBuild, toast]);

    const handleUpgradeTower = useCallback((upgradeId: string) => {
        if (!focusedTower) return;
        const player = localPlayerRef.current;
        if(!player) return;
        
        const upgradeTowerSpec = initialTowers.find(t => t.id === upgradeId);
        if (!upgradeTowerSpec) return;
        
        const refundPercentage = difficultyRef.current === 'Einfach' ? 1.0 : 0.75;
        const cost = Math.max(0, upgradeTowerSpec.cost - Math.floor(focusedTower.cost * refundPercentage));
        
        if (player.resources < cost) {
            toast({ title: 'Nicht genügend Ressourcen für das Upgrade.', variant: 'destructive' });
            return;
        }

        const newPlacedTower: PlacedTower = { 
            ...focusedTower, ...upgradeTowerSpec, id: focusedTower.id, specId: upgradeTowerSpec.id, health: upgradeTowerSpec.maxHealth 
        };
        
        const cellKey = `${focusedTower.position.row}_${focusedTower.position.col}`;
        setTowersByCell(prev => ({ ...prev, [cellKey]: newPlacedTower }));
        setPlayers(prev => [{ ...prev[0], resources: prev[0].resources - cost }]);
        setFocusedTower(newPlacedTower);
        setLastUpgradedTowerId(newPlacedTower.id);
        setTimeout(() => setLastUpgradedTowerId(null), 500);
    }, [focusedTower, toast]);

    const handleSellTower = useCallback(() => {
        if (!focusedTower) return;
        const player = localPlayerRef.current;
        if(!player) return;

        const refundPercentage = difficultyRef.current === 'Einfach' ? 1.0 : 0.75;
        const refund = Math.round(focusedTower.cost * refundPercentage);
        
        const cellKey = `${focusedTower.position.row}_${focusedTower.position.col}`;
        setTowersByCell(prev => { const newTowers = { ...prev }; delete newTowers[cellKey]; return newTowers; });
        setPlayers(prev => [{ ...prev[0], resources: prev[0].resources + refund }]);
        setFocusedTower(null);
    }, [focusedTower]);
    
    const handleElementPick = useCallback((element: Element) => {
        setPlayers(prev => [{ ...prev[0], unlockedElements: [...prev[0].unlockedElements, element] }]);
        setCurrentWave(prev => prev + 1);
        setGameStatus('playing');
        setWaveStartCountdown(INTERMISSION_TIME);
    }, []);

    const onGameEnd = useCallback(async (result: any) => {
        if(gameStatusRef.current === 'gameover') return;
        setGameStatus('gameover');
        if (!isCheating) {
            localStorage.removeItem(LOCAL_STORAGE_KEY);
            if(user) {
                try {
                    await addDoc(collection(db, "scores"), { ...result, date: serverTimestamp() });
                } catch(e) { console.error("Failed to save score", e); }
            }
        }
    }, [isCheating, user]);

    const handleStartNextWaveNow = useCallback(() => {
      if (spawnerStateRef.current || enemiesRef.current.length > 0) return;

      const waveData = waves[currentWaveRef.current];
      if (!waveData) return;

      spawnerStateRef.current = {
        count: 0,
        timer: 0,
        waveData: waveData.enemies,
      };
      
      setWaveStartCountdown(0);
      audioManager.playWaveMusic();
    }, []);

    return (
        <GameSession
            // Config
            isCoop={false}
            isGameHost={true}
            localPlayerId="player1"
            isCheating={isCheating}
            user={user}
            allTowers={initialTowers}
            
            // State (passing them down)
            players={players}
            setPlayers={setPlayers}
            gameState={gameState}
            setGameState={setGameState}
            towersByCell={towersByCell}
            setTowersByCell={setTowersByCell}
            enemies={enemies}
            setEnemies={setEnemies}
            currentWave={currentWave}
            setCurrentWave={setCurrentWave}
            difficulty={difficulty}
            gameStatus={gameStatus}
            setGameStatus={setGameStatus}
            
            // Direct state for children
            initialEnemies={enemies}

            // Callbacks
            onExit={onExit}
            onPlaceTower={handlePlaceTower}
            onUpgradeTower={handleUpgradeTower}
            onSellTower={handleSellTower}
            onFocusTower={setFocusedTower}
            cancelInteractions={() => {
                setSelectedTowerToBuild(null);
                setFocusedTower(null);
            }}
            onSelectTowerToBuild={setSelectedTowerToBuild}
            onElementPick={handleElementPick}
            onStartNextWaveNow={handleStartNextWaveNow}
            waveStartCountdown={Math.ceil(waveStartCountdown)}
            
            // VFX State
            justPlacedTowerId={justPlacedTowerId}
            lastUpgradedTowerId={lastUpgradedTowerId}
            selectedTowerToBuild={selectedTowerToBuild}
            focusedTower={focusedTower}
        />
    );
}

    
