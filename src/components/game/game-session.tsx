

"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Header from '@/components/game/header';
import type { Tower, PlacedTower, Enemy, Node, Element, Difficulty, Attack, DamageNumber, SplashRing, TowerEffect, GameSaveState, GameResult, GameResultWithId, GameDelta } from '@/lib/game-data/types';
import { DeltaType } from '@/lib/game-data/types';
import { waves } from '@/lib/game-data/enemies';
import { towers as initialTowers } from '@/lib/game-data/towers';
import { difficultyModifiers, elementProjectileColors, ALL_PICKABLE_ELEMENTS, INTERMISSION_TIME, GRID_ROWS, GRID_COLS } from '@/lib/game-data/constants';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { DesktopLayout } from '@/components/layouts/desktop-layout';
import { MobileLayout } from '@/components/layouts/mobile-layout';
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ElementPickDialog } from '@/components/game/element-pick-dialog';
import { audioManager } from '@/lib/audio/audio-manager';
import { findPath } from '@/lib/pathfinding';
import ScoreboardMiniMap from './ScoreboardMiniMap';

export type Player = {
  id: 'player1' | 'player2';
  name: string;
  avatarUrl: string | null;
  resources: number;
  unlockedElements: Element[];
};

export type GameState = {
  lives: number;
}

export type GameStatus = 'waiting' | 'playing' | 'paused' | 'gameover' | 'picking-element' | 'archived';


const TUTORIAL_COMPLETED_KEY = 'nexus-tutorial-completed';

type GameSessionProps = {
    // --- Injected State ---
    players: Player[];
    setPlayers: React.Dispatch<React.SetStateAction<Player[]>>;
    gameState: GameState;
    setGameState: React.Dispatch<React.SetStateAction<GameState>>;
    towersByCell: Record<string, PlacedTower>;
    setTowersByCell: React.Dispatch<React.SetStateAction<Record<string, PlacedTower>>>;
    currentWave: number;
    setCurrentWave: React.Dispatch<React.SetStateAction<number>>;
    gameStatus: GameStatus;
    setGameStatus: React.Dispatch<React.SetStateAction<GameStatus>>;
    difficulty: Difficulty;
    setDifficulty: React.Dispatch<React.SetStateAction<Difficulty>>;
    isIntermission: boolean;
    setIsIntermission: React.Dispatch<React.SetStateAction<boolean>>;
    waveStartCountdown: number;
    setWaveStartCountdown: React.Dispatch<React.SetStateAction<number>>;
    currentPath: Node[];
    enemies: Enemy[];
    setEnemies: React.Dispatch<React.SetStateAction<Enemy[]>>;
    spawnedThisWave: number;
    setSpawnedThisWave: React.Dispatch<React.SetStateAction<number>>;

    // --- Contolling Props ---
    isCoop: boolean;
    isGameHost: boolean;
    localPlayerId: Player['id'] | 'spectator' | null;
    broadcastGameData: (deltas: GameDelta[]) => void;
    applyDeltas: (deltas: GameDelta[]) => void;
    onGameEnd: (result: GameResult) => void;
    onWaveComplete?: () => void;
    onExit: () => void;
    
    // --- VFX ---
    attacks: Attack[];
    damageNumbers: DamageNumber[];
    splashRings: SplashRing[];
    lastUpgradedTowerId: string | null;
    setLastUpgradedTowerId: (id: string | null) => void;
    setFiringTowerIds: React.Dispatch<React.SetStateAction<Set<string>>>;
    firingTowerIds: Set<string>;
    
    // --- Single Player Passthrough ---
    handleSelectTowerToBuild?: (tower: Tower | null) => void;
    selectedTowerToBuild?: Tower | null;
    focusedTower?: PlacedTower | null;
    setFocusedTower?: (tower: PlacedTower | null) => void;
    handleUpgradeTower?: (upgradeId: string) => void;

    // --- Debug / Cheats ---
    isCheating?: boolean;

    // --- Stats ---
    fps: number;
    setFps: (fps: number) => void;
    isWsConnected?: boolean;
    hostPacketsPerSecond?: number;
    hostBytesSentPerSecond?: number;
    clientPacketsPerSecond?: number;
    clientBytesReceivedPerSecond?: number;
    averagePacketSize?: number;
    finalGameResult?: GameResult | null;
}

const towersToArray = (towersByCell: Record<string, PlacedTower> | undefined): PlacedTower[] => {
    if (!towersByCell) return [];
    return Object.values(towersByCell);
}

// Function to find the closest path node to a given position
function findClosestPathIndex(path: Node[], position: Node): number {
    if (!path || path.length === 0) return 0;
    let closestIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < path.length; i++) {
        const node = path[i];
        const distSq = Math.pow(node.col - position.col, 2) + Math.pow(node.row - position.row, 2);
        if (distSq < minDistance) {
            minDistance = distSq;
            closestIndex = i;
        }
    }
    return closestIndex;
}


export default function GameSession({ 
    // Injected State
    players, setPlayers,
    gameState, setGameState,
    towersByCell, setTowersByCell,
    currentWave, setCurrentWave,
    gameStatus, setGameStatus,
    difficulty, setDifficulty,
    isIntermission, setIsIntermission,
    waveStartCountdown, setWaveStartCountdown,
    currentPath,
    enemies, setEnemies,
    spawnedThisWave, setSpawnedThisWave,
    
    // Control
    isCoop, isGameHost, localPlayerId,
    broadcastGameData, applyDeltas, onGameEnd, onWaveComplete, onExit,

    // Single Player Passthrough
    handleSelectTowerToBuild: spHandleSelectTowerToBuild,
    selectedTowerToBuild: spSelectedTowerToBuild,
    focusedTower: spFocusedTower,
    setFocusedTower: spSetFocusedTower,
    handleUpgradeTower: spHandleUpgradeTower,

    // VFX
    attacks, damageNumbers, splashRings, lastUpgradedTowerId, setLastUpgradedTowerId, firingTowerIds, setFiringTowerIds,

    // Cheats
    isCheating = false,

    // Stats
    fps, setFps,
    isWsConnected, hostPacketsPerSecond, hostBytesSentPerSecond, clientPacketsPerSecond, clientBytesReceivedPerSecond, averagePacketSize,
    finalGameResult
}: GameSessionProps) {
  
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  // --- Global Static Data ---
  const [towers, setTowers] = useState<Tower[]>(() => initialTowers.map(t => ({...t})));
  const placedTowers = useMemo(() => towersToArray(towersByCell), [towersByCell]);

  // --- Local State (Client-side only) ---
  // If in SP, use the state from the parent. If in MP, manage state locally.
  const [selectedTowerToBuild, setSelectedTowerToBuild] = useState<Tower | null>(spSelectedTowerToBuild ?? null);
  const [focusedTower, setFocusedTower] = useState<PlacedTower | null>(spFocusedTower ?? null);
  
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [justPlacedTowerId, setJustPlacedTowerId] = useState<string|null>(null);
  
  const [totalKilled, setTotalKilled] = useState(0);
  const [totalLeaked, setTotalLeaked] = useState(0);

  // Simulation
  const gameLoopRef = useRef<number | NodeJS.Timeout>();
  const lastRafTimeRef = useRef(performance.now());
  const simAccumulatorRef = useRef(0);
  
  const difficultyMod = difficultyModifiers[difficulty];
  const localPlayer = players.find(p => p.id === localPlayerId);

  const START_NODE = { row: 1, col: 1 };
  const END_NODE = { row: GRID_ROWS, col: GRID_COLS };
  
  // This effect runs on the host when the path changes. It tells all enemies to update their path.
  useEffect(() => {
    if (!isGameHost || enemies.length === 0) return;

    const deltas: GameDelta[] = [];
    const newPath = findPath(START_NODE, END_NODE, placedTowers.map(t => t.position), GRID_ROWS, GRID_COLS);
    
    if (newPath) {
        enemies.forEach(enemy => {
            const newPathIndex = findClosestPathIndex(newPath, enemy.position);
            deltas.push([DeltaType.ENEMY_PATH_UPDATE, enemy.id, newPath, newPathIndex]);
        });
    }

    if (deltas.length > 0) {
      broadcastGameData(deltas);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placedTowers, isGameHost, broadcastGameData, START_NODE.row, START_NODE.col, END_NODE.row, END_NODE.col]);


  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
        const newMutedState = !prev;
        if (newMutedState) {
            audioManager.mute();
        } else {
            audioManager.unmute();
            if (gameStatus === 'playing' && !isIntermission) {
                audioManager.playWaveMusic();
            }
        }
        return newMutedState;
    });
  }, [gameStatus, isIntermission]);

  const handleInteraction = async () => {
    if (!hasInteracted) {
      await audioManager.init();
      setHasInteracted(true);
    }
  };
  
  const resetGame = useCallback(async () => {
    audioManager.stopMusic();
    onExit();
  }, [onExit]);
  
  const handleGameControl = useCallback(() => {
    if (localPlayerId === 'spectator') return;
    audioManager.playSfx('build_tower');

    let newStatus: GameStatus = gameStatus;
    if (gameStatus === 'playing') newStatus = 'paused';
    else if (gameStatus === 'waiting' || gameStatus === 'paused') newStatus = 'playing';

    if (isCoop && !isGameHost && (gameStatus === 'paused' || gameStatus === 'waiting')) {
      toast({ title: 'Nur der Host kann das Spiel starten oder fortsetzen.' });
      return;
    }
    
    broadcastGameData([[DeltaType.GAME_STATE_UPDATE, { gameStatus: newStatus }]]);

  }, [gameStatus, isCoop, isGameHost, toast, localPlayerId, broadcastGameData]);

  const onFocusTower = useCallback((tower: PlacedTower) => {
    if (isCoop) {
        setSelectedTowerToBuild(null);
        setFocusedTower(tower);
    } else if (spSetFocusedTower) {
        spSetFocusedTower(tower);
    }
    audioManager.playSfx('build_tower');
  }, [isCoop, spSetFocusedTower]);

  const cancelInteractions = useCallback(() => {
    if (localPlayerId === 'spectator') return;

    const spIsActive = spSelectedTowerToBuild || spFocusedTower;
    const mpIsActive = selectedTowerToBuild || focusedTower;

    if (isCoop ? mpIsActive : spIsActive) {
      audioManager.playSfx('build_tower');
    }

    if (isCoop) {
        setSelectedTowerToBuild(null);
        setFocusedTower(null);
    } else {
        if(spHandleSelectTowerToBuild) spHandleSelectTowerToBuild(null);
        if(spSetFocusedTower) spSetFocusedTower(null);
    }
  }, [localPlayerId, selectedTowerToBuild, focusedTower, isCoop, spSelectedTowerToBuild, spFocusedTower, spHandleSelectTowerToBuild, spSetFocusedTower]);

  const handlePlaceTower = useCallback((row: number, col: number) => {
    const towerToBuild = isCoop ? selectedTowerToBuild : spSelectedTowerToBuild;
    const localPlayer = players.find(p => p.id === localPlayerId);

    if (!towerToBuild || !localPlayer || localPlayerId === 'spectator') return;
    const cellKey = `${row}_${col}`;
    if (towersByCell[cellKey]) {
        toast({ title: "Bau nicht möglich", description: "Feld ist bereits belegt.", variant: "destructive" });
        return;
    }

    // Optimistic path check
    const currentPlacedTowers = Object.values(towersByCell).map(t => t.position);
    const newPath = findPath(START_NODE, END_NODE, [...currentPlacedTowers, { row, col }], GRID_ROWS, GRID_COLS);
    if (!newPath) {
        toast({ title: "Bau fehlgeschlagen", description: "Der Weg für die Gegner darf nicht blockiert werden.", variant: 'destructive' });
        return;
    }
    if (localPlayer.resources < towerToBuild.cost) {
        toast({ title: "Bau fehlgeschlagen", description: "Nicht genügend Ressourcen.", variant: 'destructive' });
        return;
    }

    const newTower: PlacedTower = {
      ...towerToBuild,
      id: `tower-${row}-${col}-${Date.now()}-${Math.random()}`,
      specId: towerToBuild.id,
      position: { row, col },
      lastAttack: 0,
      health: towerToBuild.maxHealth,
      ownerId: localPlayer.id,
    };

    const newTowersByCell = { ...towersByCell, [cellKey]: newTower };
    const playerUpdates = { [localPlayer.id]: { resources: localPlayer.resources - towerToBuild.cost } };
    
    broadcastGameData([
        [DeltaType.TOWERS_UPDATE, newTowersByCell],
        [DeltaType.PLAYER_UPDATE, playerUpdates]
    ]);
    
    setJustPlacedTowerId(newTower.id);
    setTimeout(() => setJustPlacedTowerId(null), 1000);
    
    audioManager.playSfx('build_tower');
  }, [players, localPlayerId, towersByCell, isCoop, selectedTowerToBuild, spSelectedTowerToBuild, broadcastGameData, toast, START_NODE, END_NODE]);
  
  const handleUpgradeTower = useCallback(async (upgradeId: string) => {
    const currentFocusedTower = isCoop ? focusedTower : spFocusedTower;
    const currentLocalPlayer = players.find(p => p.id === localPlayerId);
    if (!currentFocusedTower || !currentLocalPlayer || localPlayerId === 'spectator') return;

    if (!isCoop && spHandleUpgradeTower) {
        spHandleUpgradeTower(upgradeId);
        return;
    }

    const upgradeTowerSpec = towers.find(t => t.id === upgradeId);
    if (!upgradeTowerSpec) {
        toast({ title: "Upgrade-Fehler", variant: 'destructive' });
        return;
    }

    const refundPercentage = difficulty === 'Einfach' ? 1.0 : 0.75;
    const cost = upgradeTowerSpec.cost - Math.floor(currentFocusedTower.cost * refundPercentage);
    
    if (currentLocalPlayer.resources < cost) {
        toast({ title: "Upgrade fehlgeschlagen", description: "Nicht genügend Ressourcen.", variant: 'destructive' });
        return;
    }
    
    const cellKey = `${currentFocusedTower.position.row}_${currentFocusedTower.position.col}`;
    const newTowersByCell = { ...towersByCell };
    
    const upgradedTower: PlacedTower = {
        ...currentFocusedTower,
        ...upgradeTowerSpec,
        id: `tower-${currentFocusedTower.position.row}-${currentFocusedTower.position.col}-${Date.now()}`, // Ensure unique ID on upgrade
        specId: upgradeTowerSpec.id,
    };
    newTowersByCell[cellKey] = upgradedTower;
    
    const playerUpdates = { [currentLocalPlayer.id]: { resources: currentLocalPlayer.resources - cost } };
    
    broadcastGameData([
      [DeltaType.PLAYER_UPDATE, playerUpdates],
      [DeltaType.TOWERS_UPDATE, newTowersByCell],
      [DeltaType.TOWER_UPGRADE_VFX, { towerId: upgradedTower.id, position: upgradedTower.position }]
    ]);
    
    if (isCoop) setFocusedTower(null);
    else if(spSetFocusedTower) spSetFocusedTower(null);
    
    audioManager.playSfx('build_tower');
  }, [players, localPlayerId, isCoop, focusedTower, spFocusedTower, spHandleUpgradeTower, towers, toast, difficulty, broadcastGameData, towersByCell, spSetFocusedTower]);
  
  const handleSellTower = useCallback(async () => {
    const currentFocusedTower = isCoop ? focusedTower : spFocusedTower;
    const currentLocalPlayer = players.find(p => p.id === localPlayerId);
    if (!currentFocusedTower || !currentLocalPlayer || localPlayerId === 'spectator' || currentFocusedTower.ownerId !== currentLocalPlayer.id) return;

    const refundPercentage = difficulty === 'Einfach' ? 1.0 : 0.75;
    const refund = Math.round(currentFocusedTower.cost * refundPercentage);
    const cellKey = `${currentFocusedTower.position.row}_${currentFocusedTower.position.col}`;
    
    const newTowersByCell = { ...towersByCell };
    delete newTowersByCell[cellKey];

    const playerUpdates = { [currentLocalPlayer.id]: { resources: currentLocalPlayer.resources + refund } };

    broadcastGameData([
        [DeltaType.TOWERS_UPDATE, newTowersByCell],
        [DeltaType.PLAYER_UPDATE, playerUpdates]
    ]);
    
    if (isCoop) setFocusedTower(null);
    else if(spSetFocusedTower) spSetFocusedTower(null);

    audioManager.playSfx('build_tower');
  }, [players, localPlayerId, isCoop, focusedTower, spFocusedTower, difficulty, broadcastGameData, towersByCell, spSetFocusedTower]);

  const handleSelectTowerToBuild = useCallback((tower: Tower | null) => {
    if (!isCoop && spHandleSelectTowerToBuild) {
        spHandleSelectTowerToBuild(tower);
        return;
    }
    
    const currentLocalPlayer = players.find(p => p.id === localPlayerId);
    if (!currentLocalPlayer || (tower && currentLocalPlayer.resources < tower.cost)) {
      if(tower) toast({ title: 'Nicht genügend Ressourcen', variant: 'destructive'});
      if (tower === null) setSelectedTowerToBuild(null);
      return;
    }
    if (selectedTowerToBuild?.id === tower?.id) {
        setSelectedTowerToBuild(null);
        return;
    }
    setSelectedTowerToBuild(tower);
    setFocusedTower(null);
  }, [isCoop, spHandleSelectTowerToBuild, players, localPlayerId, toast, selectedTowerToBuild]);
  
  const cheat_addResources = () => {
    if (!isCheating) return;
    const playerUpdates: Record<string, Partial<Player>> = {};
    for (const p of players) {
        playerUpdates[p.id] = { resources: (p.resources || 0) + 10000 };
    }
    broadcastGameData([[DeltaType.PLAYER_UPDATE, playerUpdates]]);
    toast({ title: 'Cheat Aktiviert', description: '+10,000 Ressourcen hinzugefügt.' });
  };

  const cheat_skipWaves = () => {
    if (!isCheating) return;
    const nextWave = Math.min(currentWave + 5, waves.length - 1);
    broadcastGameData([[DeltaType.GAME_STATE_UPDATE, { currentWave: nextWave, isIntermission: true, waveStartCountdown: 3 }]]);
    toast({ title: 'Cheat Aktiviert', description: `Zu Welle ${nextWave + 1} gesprungen.` });
  };

  const cheat_heal = () => {
    if (!isCheating) return;
    broadcastGameData([[DeltaType.GAME_STATE_UPDATE, { lives: difficultyMod.startLives }]]);
    toast({ title: 'Cheat Aktiviert', description: 'Leben vollständig wiederhergestellt.' });
  };

  const cheat_unlockAll = useCallback(() => {
    const playerUpdates: Record<string, Partial<Player>> = {};
    for (const p of players) {
        playerUpdates[p.id] = {
            resources: 99999,
            unlockedElements: ['neutral', ...ALL_PICKABLE_ELEMENTS]
        };
    }
    broadcastGameData([[DeltaType.PLAYER_UPDATE, playerUpdates]]);
    toast({ title: "Cheat Aktiviert", description: "Alle Elemente und massig Ressourcen freigeschaltet." });
  }, [players, broadcastGameData, toast]);

 const handleLoadTestLayout = useCallback(() => {
    const testTowers: Record<string, PlacedTower> = {};
    const baseTower = towers.find(t => t.id === 'neutral-0');
    if (!baseTower) {
        toast({ title: "Fehler: Standard-Turm nicht gefunden." });
        return;
    }

    const layout: Node[] = [
      { row: 2, col: 1 }, { row: 2, col: 2 }, { row: 2, col: 3 }, { row: 2, col: 4 }, { row: 2, col: 5 }, { row: 2, col: 6 }, { row: 2, col: 7 }, { row: 2, col: 8 }, { row: 2, col: 9 }, { row: 2, col: 10 }, { row: 2, col: 11 },
      { row: 4, col: 2 }, { row: 4, col: 3 }, { row: 4, col: 4 }, { row: 4, col: 5 }, { row: 4, col: 6 }, { row: 4, col: 7 }, { row: 4, col: 8 }, { row: 4, col: 9 }, { row: 4, col: 10 }, { row: 4, col: 11 }, { row: 4, col: 12 },
      { row: 6, col: 1 }, { row: 6, col: 2 }, { row: 6, col: 3 }, { row: 6, col: 4 }, { row: 6, col: 5 }, { row: 6, col: 7 }, { row: 6, col: 8 }, { row: 6, col: 9 }, { row: 6, col: 10 }, { row: 6, col: 11 },
      { row: 8, col: 2 }, { row: 8, col: 3 }, { row: 8, col: 4 }, { row: 8, col: 5 }, { row: 8, col: 6 }, { row: 8, col: 7 }, { row: 8, col: 8 }, { row: 8, col: 9 }, { row: 8, col: 10 }, { row: 8, col: 11 }, { row: 8, col: 12 },
      { row: 10, col: 1 }, { row: 10, col: 2 }, { row: 10, col: 3 }, { row: 10, col: 4 }, { row: 10, col: 5 }, { row: 10, col: 6 }, { row: 10, col: 7 }, { row: 10, col: 8 }, { row: 10, col: 9 }, { row: 10, col: 10 }, { row: 10, col: 11 },
    ];
    
    layout.forEach(pos => {
        const { row, col } = pos;
        const newTower: PlacedTower = {
            ...baseTower,
            specId: baseTower.id,
            id: `test-${baseTower.id}-${row}-${col}`,
            position: { row, col },
            lastAttack: 0,
            health: baseTower.maxHealth,
            ownerId: 'player1',
            isBase: true,
        };
        testTowers[`${row}_${col}`] = newTower;
    });
    
    broadcastGameData([[DeltaType.TOWERS_UPDATE, testTowers]]);
    cheat_unlockAll();
    toast({ title: "Maximales Labyrinth-Layout geladen!", description: "Der Pfad für die Gegner ist nun so lang wie möglich." });
}, [toast, towers, cheat_unlockAll, broadcastGameData]);

const handleLoadAllTowersLayout = useCallback(() => {
    const testTowers: Record<string, PlacedTower> = {};
    const layout: Node[] = [
      { row: 2, col: 1 }, { row: 2, col: 2 }, { row: 2, col: 3 }, { row: 2, col: 4 }, { row: 2, col: 5 }, { row: 2, col: 6 }, { row: 2, col: 7 }, { row: 2, col: 8 }, { row: 2, col: 9 }, { row: 2, col: 10 }, { row: 2, col: 11 },
      { row: 4, col: 2 }, { row: 4, col: 3 }, { row: 4, col: 5 }, { row: 4, col: 5 }, { row: 4, col: 6 }, { row: 4, col: 7 }, { row: 4, col: 8 }, { row: 4, col: 9 }, { row: 4, col: 10 }, { row: 4, col: 11 }, { row: 4, col: 12 },
      { row: 6, col: 1 }, { row: 6, col: 2 }, { row: 6, col: 3 }, { row: 6, col: 4 }, { row: 6, col: 5 }, { row: 6, col: 6 }, { row: 6, col: 7 }, { row: 6, col: 8 }, { row: 6, col: 9 }, { row: 6, col: 10 }, { row: 6, col: 11 },
      { row: 8, col: 2 }, { row: 8, col: 3 }, { row: 8, col: 4 }, { row: 8, col: 5 }, { row: 8, col: 6 }, { row: 8, col: 7 }, { row: 8, col: 8 }, { row: 8, col: 9 }, { row: 8, col: 10 }, { row: 8, col: 11 }, { row: 8, col: 12 },
      { row: 10, col: 1 }, { row: 10, col: 2 }, { row: 10, col: 3 }, { row: 10, col: 4 }, { row: 10, col: 5 }, { row: 10, col: 6 }, { row: 10, col: 7 }, { row: 10, col: 8 }, { row: 10, col: 9 }, { row: 10, col: 10 }, { row: 10, col: 11 },
    ];

    layout.forEach((pos, index) => {
        const { row, col } = pos;
        const towerSpec = towers[index % towers.length]; // Cycle through all towers
        const newTower: PlacedTower = {
            ...towerSpec,
            specId: towerSpec.id,
            id: `test-all-${towerSpec.id}-${row}-${col}`,
            position: { row, col },
            lastAttack: 0,
            health: towerSpec.maxHealth,
            ownerId: 'player1',
            isBase: towerSpec.isBase,
        };
        testTowers[`${row}_${col}`] = newTower;
    });

    broadcastGameData([[DeltaType.TOWERS_UPDATE, testTowers]]);
    cheat_unlockAll();
    toast({ title: "Alle Türme platziert!", description: "Ein Exemplar jedes Turms wurde auf der Karte platziert." });
  }, [toast, towers, cheat_unlockAll, broadcastGameData]);

  const handleElementPick = (element: Element) => {
    if (localPlayerId === 'spectator' || !localPlayer) return;
      
    const playerUpdate = { [localPlayer.id]: { unlockedElements: [...localPlayer.unlockedElements, element] }};
    const nextWave = currentWave + 1;

    // Reset for the next wave
    const stateUpdate = {
        gameStatus: 'playing',
        isIntermission: true,
        waveStartCountdown: INTERMISSION_TIME,
        currentWave: nextWave,
        spawnedThisWave: 0, // Reset for the actual next wave
    };

    broadcastGameData([
        [DeltaType.PLAYER_UPDATE, playerUpdate],
        [DeltaType.GAME_STATE_UPDATE, stateUpdate]
    ]);
  };
  
 const simulate = useCallback(async () => {
    const now = performance.now();
    const deltas: GameDelta[] = [];
    let enemiesMap = new Map(enemies.map(e => [e.id, e]));
    
    if (isGameHost) {
      // Tower attacks
      Object.values(towersByCell).forEach(tower => {
        if ((now - (tower.lastAttack || 0) <= tower.attackSpeed) || tower.effect?.type === 'aura') return;

        const enemiesInRange = enemies.filter(enemy => {
          if (!enemy) return false;
          const dx = enemy.position.row - tower.position.row;
          const dy = enemy.position.col - tower.position.col;
          return (dx * dx + dy * dy) <= (tower.range * tower.range);
        });

        if (enemiesInRange.length > 0) {
          const mainTarget = enemiesInRange[0]; 
          
          const mainAttack: Attack = {
              id: `attack-${now}-${Math.random()}`,
              towerId: tower.id,
              targetId: mainTarget.id,
              elements: tower.elements,
              projectile: tower.id.includes('1a') || tower.id.includes('2a') ? 'arrow' : 'beam',
          };
          deltas.push([DeltaType.TOWER_ATTACK, mainAttack]);
          
          tower.lastAttack = now; // Direct mutation, will be part of the final update


          if (tower.effect?.type === 'chain' && tower.effect.bounces) {
              let currentTarget = mainTarget;
              let bounced = 0;
              const hitTargets = new Set([mainTarget.id]);
              
              while (bounced < tower.effect.bounces) {
                  const nextTarget = enemiesInRange.find(e => 
                      !hitTargets.has(e.id) && 
                      Math.hypot(e.position.row - currentTarget.position.row, e.position.col - currentTarget.position.col) < 3
                  );
                  if (!nextTarget) break;
                  
                  const chainAttack: Attack = {
                      id: `attack-chain-${now}-${Math.random()}`,
                      towerId: tower.id,
                      targetId: nextTarget.id,
                      elements: tower.elements,
                      projectile: 'chain',
                      isChain: true,
                      chainSourceId: currentTarget.id,
                  };
                  deltas.push([DeltaType.TOWER_ATTACK, chainAttack]);
                  
                  hitTargets.add(nextTarget.id);
                  currentTarget = nextTarget;
                  bounced++;
              }
          }
        }
      });
      if(Object.values(towersByCell).some(t => t.lastAttack === now)) {
          deltas.push([DeltaType.TOWERS_UPDATE, towersByCell]);
      }
      
      const damageToApply: Map<string, { totalDamage: number; sources: PlacedTower[] }> = new Map();
      deltas.forEach(delta => {
          if (delta[0] !== DeltaType.TOWER_ATTACK) return;
          const attack = delta[1] as Attack;

          const tower = Object.values(towersByCell).find(t => t.id === attack.towerId);
          const enemy = enemiesMap.get(attack.targetId);
          if (!tower || !enemy) return;

          let damage = tower.damage;
          let isCrit = false;

          if (attack.isChain) damage *= (tower.effect?.potency ?? 0.5);
          if (tower.effect?.type === 'crit' && Math.random() < (tower.effect.chance ?? 0)) {
              damage *= (tower.effect.potency ?? 1); isCrit = true;
          }

          if (!damageToApply.has(enemy.id)) damageToApply.set(enemy.id, { totalDamage: 0, sources: [] });
          const damageData = damageToApply.get(enemy.id)!;
          damageData.totalDamage += damage;
          damageData.sources.push(tower);
          
          if (isCrit) deltas.push([DeltaType.VFX_DAMAGE_NUMBER, { id: `dn-crit-${now}`, amount: damage, position: enemy.position, color: '#fde047', isCrit: true }]);
          
          if (tower.effect?.type === 'splash' && tower.effect.radius) {
              deltas.push([DeltaType.VFX_SPLASH, { id: `sr-${now}`, x: enemy.position.col, y: enemy.position.row, r: tower.effect.radius, color: elementProjectileColors[tower.elements[0]] || '#fff' }]);
              enemies.forEach(otherEnemy => {
                  if (otherEnemy.id === enemy.id) return;
                  const dx = otherEnemy.position.col - enemy.position.col;
                  const dy = otherEnemy.position.row - enemy.position.row;
                  if (dx * dx + dy * dy <= (tower.effect!.radius! * tower.effect!.radius!)) {
                      if (!damageToApply.has(otherEnemy.id)) damageToApply.set(otherEnemy.id, { totalDamage: 0, sources: [] });
                      damageToApply.get(otherEnemy.id)!.totalDamage += damage * (tower.effect.potency ?? 1);
                  }
              });
          }
        }
      );

      const resourcesGainedThisTick: Record<string, number> = {};
      let killedThisTick = 0;
      let leakedThisTick = 0;
      damageToApply.forEach(({ totalDamage, sources }, enemyId) => {
          const enemy = enemiesMap.get(enemyId);
          if (!enemy || enemy.health <= 0) return;
          
          let modifiedEnemy = { ...enemy };
          sources.forEach(tower => {
              if (tower.effect) {
                  const [newEnemy, effectDelta] = applyEffectToEnemy(modifiedEnemy, tower.effect, now);
                  modifiedEnemy = newEnemy;
                  if(effectDelta) deltas.push(effectDelta);
              }
          });
          
          const vulnerabilityEffect = modifiedEnemy.effects.find(e => e.type === 'vulnerability');
          const damageMultiplier = 1 + (vulnerabilityEffect ? vulnerabilityEffect.potency : 0);
          const armorShredEffect = modifiedEnemy.effects.find(e => e.type === 'armor_shred');
          const armorReduction = armorShredEffect ? armorShredEffect.potency! : 0;
          const effectiveArmor = Math.max(0, (modifiedEnemy.armor || 0) * (1 - armorReduction));
          const damageReduction = effectiveArmor / (effectiveArmor + 400);
          const finalDamage = totalDamage * damageMultiplier * (1 - damageReduction);
          
          if (finalDamage > 0) {
              deltas.push([DeltaType.ENEMY_DAMAGE, enemy.id, finalDamage, sources[0]?.elements[0] ?? 'neutral']);
              
              if (modifiedEnemy.health - finalDamage <= 0) {
                  killedThisTick++;
                  deltas.push([DeltaType.ENEMY_DIE, enemy.id]);
                  const killingBlowTower = sources[sources.length - 1];
                  if (killingBlowTower) {
                      const playerToRewardId = killingBlowTower.ownerId;
                      resourcesGainedThisTick[playerToRewardId] = (resourcesGainedThisTick[playerToRewardId] || 0) + enemy.bounty;
                      if (killingBlowTower.effect?.type === 'lifesteal' && Math.random() < (killingBlowTower.effect.chance ?? 0)) {
                          resourcesGainedThisTick[playerToRewardId] += Math.round(finalDamage * (killingBlowTower.effect.potency ?? 0));
                      }
                  }
              }
          }
      });

      
      if (!isIntermission) {
        enemiesMap.forEach(enemy => {
            if(enemy.health <= 0) return;
            
            const newEffects: EnemyStatusEffect[] = [];
            let isStunned = false;
            
            enemy.effects.forEach(effect => {
                if (effect.expires > now) {
                    newEffects.push(effect);
                    if (effect.type === 'stun') isStunned = true;
                    if (effect.type === 'burn' && now - (effect.lastTick || 0) > 1000) {
                        effect.lastTick = now;
                        const burnPotency = effect.potency || 0;
                        const burnDamage = burnPotency <= 1 ? enemy.maxHealth * burnPotency : burnPotency;
                        const armor = enemy.armor || 0;
                        const damageReduction = armor / (armor + 400);
                        const finalBurnDamage = burnDamage * (1 - damageReduction);
                        if(finalBurnDamage > 0) deltas.push([DeltaType.ENEMY_DAMAGE, enemy.id, finalBurnDamage, 'fire']);
                    }
                } else {
                    deltas.push([DeltaType.ENEMY_REMOVE_EFFECT, enemy.id, effect.type]);
                }
            });

            if (!isStunned) {
                const slowEffect = newEffects.find(e => e.type === 'slow');
                const effectiveSpeed = enemy.speed * (slowEffect ? (1 - slowEffect.potency!) : 1);
                const stepMs = 1000 / Math.max(0.001, effectiveSpeed);

                if (now - enemy.lastMove > stepMs) {
                    if(enemy.pathIndex < (enemy.path || currentPath).length - 1) {
                        deltas.push([DeltaType.ENEMY_MOVE, enemy.id, enemy.pathIndex + 1, now]);
                    }
                }
                if (enemy.position.row === END_NODE.row && enemy.position.col === END_NODE.col) {
                    leakedThisTick++;
                    deltas.push([DeltaType.ENEMY_REACH_END, enemy.id]);
                }
            }
        });
      }
      
      if (Object.keys(resourcesGainedThisTick).length > 0) {
        const playerUpdates: Record<string, Partial<Player>> = {};
        players.forEach(p => {
            const resourcesToAdd = resourcesGainedThisTick[p.id];
            if (resourcesToAdd) {
                playerUpdates[p.id] = { resources: p.resources + resourcesToAdd };
            }
        });
        deltas.push([DeltaType.PLAYER_UPDATE, playerUpdates]);
      }

      if (killedThisTick > 0) setTotalKilled(k => k + killedThisTick);
      if (leakedThisTick > 0) {
          setTotalLeaked(l => l + leakedThisTick);
          if (gameState.lives - leakedThisTick <= 0 && gameStatus !== 'gameover') {
              const result: GameResult = {
                  playerName: localPlayer?.name || 'Anonymer Spieler',
                  playerUid: 'local',
                  date: new Date().toISOString(),
                  difficulty: difficulty,
                  wave: currentWave + 1,
                  won: false,
                  finalTowers: towersByCell
              };
              onGameEnd(result);
              deltas.push([DeltaType.GAME_STATE_UPDATE, { gameStatus: 'gameover' }]);
          }
      }
      
      const liveEnemyCount = Array.from(enemiesMap.values()).filter(e => e.health > 0).length;
      const waveData = waves[currentWave];
      const allSpawned = spawnedThisWave >= (waveData?.enemies.count || 0);

      if (!isIntermission && allSpawned && liveEnemyCount === 0 && gameStatus !== 'gameover') {
          audioManager.stopMusic();
          onWaveComplete?.();

          const nextWave = currentWave + 1;
          
          let stateUpdate: GameDelta | null = null;

          if (nextWave >= waves.length) {
              const result: GameResult = {
                  playerName: localPlayer?.name || 'Anonymer Spieler',
                  playerUid: 'local',
                  date: new Date().toISOString(),
                  difficulty: difficulty,
                  wave: currentWave + 1,
                  won: true,
                  finalTowers: towersByCell
              };
              onGameEnd(result);
              stateUpdate = [DeltaType.GAME_STATE_UPDATE, { gameStatus: 'gameover' }];
          } else {
              const canPickElement = nextWave > 0 && nextWave % 5 === 0;
              const hasAllElements = localPlayer && ALL_PICKABLE_ELEMENTS.every(el => localPlayer.unlockedElements.includes(el));

              if (canPickElement && !hasAllElements) {
                  stateUpdate = [DeltaType.GAME_STATE_UPDATE, { gameStatus: 'picking-element' }];
              } else {
                   stateUpdate = [DeltaType.GAME_STATE_UPDATE, {
                      currentWave: nextWave,
                      isIntermission: true,
                      waveStartCountdown: INTERMISSION_TIME,
                      spawnedThisWave: 0,
                  }];
              }
          }
          
          if (stateUpdate) {
              deltas.push(stateUpdate);
          }
      }
    }

    if (deltas.length > 0) {
      broadcastGameData(deltas);
    }
  }, [placedTowers, isGameHost, gameState.lives, gameStatus, players, localPlayerId, currentWave, END_NODE, broadcastGameData, currentPath, isIntermission, localPlayer, difficulty, onGameEnd, onWaveComplete, towersByCell, enemies, spawnedThisWave, setPlayers, towers]);

  useEffect(() => {
    if (hasInteracted) {
      // Music logic handled by start/stop wave
    }
  }, [hasInteracted]);
  
  const frameCountRef = useRef(0);
  const lastFpsUpdateTimeRef = useRef(performance.now());
  
  // MAIN GAME LOOP (HOST ONLY)
  useEffect(() => {
    let isTabVisible = true;

    if (!isGameHost || gameStatus !== 'playing') {
      if (gameLoopRef.current) {
        if (typeof gameLoopRef.current === 'number') cancelAnimationFrame(gameLoopRef.current);
        else clearInterval(gameLoopRef.current);
        gameLoopRef.current = undefined;
      }
      return;
    }

    const FIXED_DT_MS = 50; 
    const MAX_SIM_STEPS = 5; 

    const rafLoop = (now: number) => {
        if (!isTabVisible) {
          gameLoopRef.current = requestAnimationFrame(rafLoop);
          return;
        };
        let frameTime = now - lastRafTimeRef.current;
        lastRafTimeRef.current = now;
        simAccumulatorRef.current += frameTime;

        let steps = 0;
        while (simAccumulatorRef.current >= FIXED_DT_MS && steps < MAX_SIM_STEPS) {
            simulate();
            simAccumulatorRef.current -= FIXED_DT_MS;
            steps++;
        }

        frameCountRef.current++;
        if (now - lastFpsUpdateTimeRef.current >= 1000) {
            setFps(frameCountRef.current);
            frameCountRef.current = 0;
            lastFpsUpdateTimeRef.current = now;
        }
        
        gameLoopRef.current = requestAnimationFrame(rafLoop);
    };
    
    const intervalLoop = () => {
        const now = performance.now();
        const frameTime = Math.min(now - lastRafTimeRef.current, FIXED_DT_MS * MAX_SIM_STEPS * 2);
        lastRafTimeRef.current = now;
        simAccumulatorRef.current += frameTime;
        
        while(simAccumulatorRef.current >= FIXED_DT_MS) {
            simulate();
            simAccumulatorRef.current -= FIXED_DT_MS;
        }
    };
    
    const handleVisibilityChange = () => {
      const isVisible = document.visibilityState === 'visible';
      if (isVisible === isTabVisible) return;
      isTabVisible = isVisible;
      
      if (isCoop) {
        if (gameLoopRef.current) {
            if (typeof gameLoopRef.current === 'number') cancelAnimationFrame(gameLoopRef.current);
            else clearInterval(gameLoopRef.current);
        }

        if (isVisible) {
            lastRafTimeRef.current = performance.now();
            gameLoopRef.current = requestAnimationFrame(rafLoop);
        } else {
            gameLoopRef.current = setInterval(intervalLoop, FIXED_DT_MS);
        }
      }
    };

    lastRafTimeRef.current = performance.now();
    gameLoopRef.current = requestAnimationFrame(rafLoop);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        if (gameLoopRef.current) {
            if (typeof gameLoopRef.current === 'number') cancelAnimationFrame(gameLoopRef.current);
            else clearInterval(gameLoopRef.current);
        }
    }
  }, [gameStatus, isGameHost, simulate, isCoop, setFps]);

  const applyEffectToEnemy = (enemy: Enemy, effect: TowerEffect, now: number): [Enemy, GameDelta | null] => {
    const newEffects = [...enemy.effects];
    const { type, duration, potency } = effect;

    let delta: GameDelta | null = null;
    const existingEffectIndex = newEffects.findIndex(e => e.type === type);
    if (existingEffectIndex !== -1) {
        if ((potency ?? 0) >= (newEffects[existingEffectIndex].potency ?? 0)) {
            newEffects[existingEffectIndex] = { type, expires: now + (duration ?? 0), potency: potency ?? 0 };
            delta = [DeltaType.ENEMY_ADD_EFFECT, enemy.id, newEffects[existingEffectIndex]];
        }
    } else {
        const newEffect = { type, expires: now + (duration ?? 0), potency: potency ?? 0 };
        newEffects.push(newEffect);
        delta = [DeltaType.ENEMY_ADD_EFFECT, enemy.id, newEffect];
    }
    
    return [{ ...enemy, effects: newEffects }, delta];
  };

  const interactionPrompt = localPlayerId === 'spectator'
    ? 'Du schaust zu.'
    : (isCoop ? selectedTowerToBuild : spSelectedTowerToBuild)
    ? `Wähle Bauplatz für ${localPlayer?.name}: ${(isCoop ? selectedTowerToBuild : spSelectedTowerToBuild)?.name}`
    : (isCoop ? focusedTower : spFocusedTower)
    ? `Fokus: ${(isCoop ? focusedTower : spFocusedTower)?.name} (Besitzer: ${players.find(p => p.id === (isCoop ? focusedTower : spFocusedTower)?.ownerId)?.name})`
    : (isCoop && localPlayerId ? `Du bist ${players.find(p=> p.id === localPlayerId)?.name}` : 'Wähle einen Turm zum Bauen');
    
  const LayoutComponent = isMobile ? MobileLayout : DesktopLayout;
  
  const currentFocusedTower = isCoop ? focusedTower : spFocusedTower;
  const currentSelectedTower = isCoop ? selectedTowerToBuild : spSelectedTowerToBuild;

  return (
    <div className="flex flex-col h-full bg-background text-foreground font-body" onClick={handleInteraction}>
      <Header 
        isMobile={isMobile} 
        onExit={resetGame} 
        fps={fps}
        isMuted={isMuted}
        toggleMute={toggleMute}
       />
      <main className="flex-grow md:p-6 h-[calc(100%-69px)]">
        <LayoutComponent
            players={players}
            setPlayers={setPlayers}
            gameState={gameState}
            localPlayer={localPlayer!}
            currentWave={currentWave}
            totalWaves={waves.length}
            difficulty={difficulty}
            handleGameControl={handleGameControl}
            gameStatus={gameStatus}
            resetGame={resetGame}
            towers={towers}
            setTowers={setTowers}
            placedTowers={placedTowers}
            enemies={enemies}
            attacks={attacks}
            damageNumbers={damageNumbers}
            splashRings={splashRings}
            currentPath={currentPath}
            handlePlaceTower={handlePlaceTower}
            onFocusTower={onFocusTower}
            selectedTowerToBuild={currentSelectedTower}
            focusedTower={currentFocusedTower}
            rows={GRID_ROWS}
            cols={GRID_COLS}
            startNode={START_NODE}
            endNode={END_NODE}
            interactionPrompt={interactionPrompt}
            cancelInteractions={cancelInteractions}
            onSelectTowerToBuild={handleSelectTowerToBuild}
            handleUpgradeTower={handleUpgradeTower}
            handleSellTower={handleSellTower}
            setFocusedTower={isCoop ? setFocusedTower : spSetFocusedTower!}
            spawnedThisWave={spawnedThisWave}
            totalEnemiesInWave={waves[currentWave]?.enemies.count || 0}
            totalKilled={totalKilled}
            totalLeaked={totalLeaked}
            isIntermission={isIntermission}
            waveStartCountdown={waveStartCountdown}
            intermissionTime={INTERMISSION_TIME}
            handleStartNextWaveNow={() => {
                const canStart = !isCoop || isGameHost;
                if (!isIntermission || !canStart || localPlayerId === 'spectator') return;
                broadcastGameData([[DeltaType.GAME_STATE_UPDATE, { isIntermission: false, waveStartCountdown: 0 }]]);
            }}
            lastUpgradedTowerId={lastUpgradedTowerId}
            justPlacedTowerId={justPlacedTowerId}
            isCoop={isCoop}
            playerRole={localPlayerId}
            handleLoadTestLayout={handleLoadTestLayout}
            handleLoadAllTowersLayout={handleLoadAllTowersLayout}
            isCheating={isCheating}
            cheat_addResources={cheat_addResources}
            cheat_skipWaves={cheat_skipWaves}
            cheat_heal={cheat_heal}
            cheat_unlockAll={cheat_unlockAll}
            // Network Stats
            isWsConnected={isWsConnected}
            clientPacketsPerSecond={clientPacketsPerSecond}
            clientBytesReceivedPerSecond={clientBytesReceivedPerSecond}
            hostPacketsPerSecond={hostPacketsPerSecond}
            hostBytesSentPerSecond={hostBytesSentPerSecond}
            averagePacketSize={averagePacketSize}
            firingTowerIds={firingTowerIds}
            // Props for TowerContextMenu
            allTowers={towers}
          />
      </main>
      
      <AlertDialog open={gameStatus === 'gameover'}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{gameState.lives > 0 ? "Sieg!" : "Game Over"}</AlertDialogTitle>
            <AlertDialogDescription>
              {gameState.lives <= 0 ? "Du hast alle Leben verloren." : "Herzlichen Glückwunsch, du hast alle Wellen besiegt!"} Du hast Welle {currentWave + 1} erreicht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {finalGameResult?.finalTowers && (
             <div className="flex flex-col items-center gap-2">
                <p className="text-sm font-semibold text-muted-foreground">Dein finales Spielfeld:</p>
                <ScoreboardMiniMap towersByCell={finalGameResult.finalTowers} />
             </div>
          )}
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => resetGame()}>Zum Hauptmenü</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {localPlayer && localPlayerId !== 'spectator' && <ElementPickDialog
        isOpen={gameStatus === 'picking-element'}
        unlockedElements={new Set(localPlayer.unlockedElements)}
        onElementPick={handleElementPick}
        playerName={localPlayer.name}
        currentWave={currentWave}
      />}
    </div>
  );
}

    