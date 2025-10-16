
"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Header from '@/components/game/header';
import type { Tower, PlacedTower, Enemy, Node, Element, Difficulty, Attack, DamageNumber, SplashRing, GameSaveState, GameResult, GameResultWithId, GameDelta, EnemyStatusEffect } from '@/lib/game-data/types';
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
import { interpolatedEnemyPositions } from './game-board';

export type Player = {
  id: 'player1' | 'player2' | 'spectator';
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
    setEnemies: (val: Enemy[] | ((prev: Enemy[]) => Enemy[])) => void;
    spawnedThisWave: number;
    setSpawnedThisWave: (val: number | ((prev: number) => number)) => void;

    // --- Contolling Props ---
    isCoop: boolean;
    isGameHost: boolean;
    localPlayerId: Player['id'] | null;
    broadcastGameData: (deltas: GameDelta[], reliable?: boolean) => void;
    sendActionRequest?: (type: string, payload: any) => void;
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
    setFiringTowerIds: (val: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
    firingTowerIds: Set<string>;
    
    // --- Single Player Passthrough ---
    handleSelectTowerToBuild?: (tower: Tower | null) => void;
    selectedTowerToBuild?: Tower | null;
    focusedTower?: PlacedTower | null;
    setFocusedTower?: (tower: PlacedTower | null) => void;
    handleUpgradeTower?: (upgradeId: string) => void;
    handleSellTower?: () => void;
    handleGameControl?: () => void;
    handleStartNextWaveNow?: () => void;
    handlePlaceTower?: (row: number, col: number) => void;
    allTowers?: Tower[];
    cancelInteractions?: () => void;
    handleElementPick?: (element: Element) => void;


    // --- Debug / Cheats ---
    isCheating?: boolean;
    handleLoadTestLayout?: () => void;
    handleLoadAllTowersLayout?: () => void;
    cheat_addResources?: () => void;
    cheat_skipWaves?: () => void;
    cheat_heal?: () => void;
    cheat_unlockAll?: () => void;

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
    totalKilled: number;
    setTotalKilled: (value: number | ((prev: number) => number)) => void;
    totalLeaked: number;
    setTotalLeaked: (value: number | ((prev: number) => number)) => void;
}

const towersToArray = (towersByCell: Record<string, PlacedTower> | undefined): PlacedTower[] => {
    if (!towersByCell) return [];
    return Object.values(towersByCell);
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
    broadcastGameData, sendActionRequest, applyDeltas, onGameEnd, onWaveComplete, onExit,

    // Single Player Passthrough
    handleSelectTowerToBuild: spHandleSelectTowerToBuild,
    selectedTowerToBuild: spSelectedTowerToBuild,
    focusedTower: spFocusedTower,
    setFocusedTower: spSetFocusedTower,
    handleUpgradeTower: spHandleUpgradeTower,
    handleSellTower: spHandleSellTower,
    handleGameControl: spHandleGameControl,
    handleStartNextWaveNow: spHandleStartNextWaveNow,
    handlePlaceTower: spHandlePlaceTower,
    allTowers: spAllTowers,
    cancelInteractions: spCancelInteractions,
    handleElementPick: spHandleElementPick,

    // VFX
    attacks, damageNumbers, splashRings, lastUpgradedTowerId, setLastUpgradedTowerId, firingTowerIds, setFiringTowerIds,

    // Cheats
    isCheating = false,
    handleLoadTestLayout: spHandleLoadTestLayout,
    handleLoadAllTowersLayout: spHandleLoadAllTowersLayout,
    cheat_addResources: spCheatAddResources,
    cheat_skipWaves: spCheatSkipWaves,
    cheat_heal: spCheatHeal,
    cheat_unlockAll: spCheatUnlockAll,

    // Stats
    fps, setFps,
    isWsConnected, hostPacketsPerSecond, hostBytesSentPerSecond, clientPacketsPerSecond, clientBytesReceivedPerSecond, averagePacketSize,
    finalGameResult,
    totalKilled, setTotalKilled,
    totalLeaked, setTotalLeaked,
}: GameSessionProps) {
  
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  // --- Global Static Data ---
  const allTowers = useMemo(() => spAllTowers ?? initialTowers.map(t => ({...t})), [spAllTowers]);
  const placedTowers = useMemo(() => towersToArray(towersByCell), [towersByCell]);

  // --- Local State (Client-side only) ---
  const [selectedTowerToBuild, setSelectedTowerToBuild] = useState<Tower | null>(spSelectedTowerToBuild ?? null);
  const [focusedTower, setFocusedTower] = useState<PlacedTower | null>(spFocusedTower ?? null);
  
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [justPlacedTowerId, setJustPlacedTowerId] = useState<string|null>(null);
  
  // Simulation
  const gameLoopRef = useRef<number>();
  const lastTickRef = useRef(performance.now());
  const enemyIdCounter = useRef(0);
  const spawnerStateRef = useRef<{ count: number; timer: number; waveData: any } | null>(null);

  const difficultyMod = difficultyModifiers[difficulty];
  const localPlayer = useMemo(() => players.find(p => p.id === localPlayerId), [players, localPlayerId]);

  const START_NODE = { row: 1, col: 1 };
  const END_NODE = { row: GRID_ROWS, col: GRID_COLS };
  
  // Refs for stable access in game loop
  const enemiesRef = useRef(enemies);
  const playersRef = useRef(players);
  const towersByCellRef = useRef(towersByCell);
  const gameStateRef = useRef(gameState);
  const currentPathRef = useRef(currentPath);
  const currentWaveRef = useRef(currentWave);
  const difficultyRef = useRef(difficulty);


  useEffect(() => { setEnemies(enemiesRef.current) }, [enemiesRef.current, setEnemies]);
  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { towersByCellRef.current = towersByCell; }, [towersByCell]);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  useEffect(() => { currentPathRef.current = currentPath; }, [currentPath]);
  useEffect(() => { currentWaveRef.current = currentWave; }, [currentWave]);
  useEffect(() => { difficultyRef.current = difficulty; }, [difficulty]);



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
    if (!isCoop) {
        spHandleGameControl?.();
        return;
    }
    if (localPlayerId === 'spectator') return;
    audioManager.playSfx('build_tower');

    if (!isGameHost) {
      toast({ title: 'Nur der Host kann das Spiel pausieren.' });
      return;
    }
    
    let stateUpdate: Partial<GameState & { gameStatus: GameStatus, isIntermission: boolean, waveStartCountdown: number }> = {};
    
    if (gameStatus === 'playing') {
      stateUpdate = { gameStatus: 'paused' };
    } else if (gameStatus === 'paused' || gameStatus === 'waiting') {
       stateUpdate = {
        gameStatus: 'playing',
        isIntermission: false,
        waveStartCountdown: 0,
      };
    } else {
      return;
    }
    
    broadcastGameData([[DeltaType.GAME_STATE_UPDATE, stateUpdate]]);

  }, [gameStatus, isCoop, isGameHost, toast, localPlayerId, broadcastGameData, spHandleGameControl]);

  const handleStartNextWaveNow = useCallback(() => {
    if(!isCoop) {
        spHandleStartNextWaveNow?.();
        return;
    }
    if (isIntermission && gameStatus === 'playing' && (!isCoop || isGameHost)) {
        broadcastGameData([[DeltaType.GAME_STATE_UPDATE, { isIntermission: false, waveStartCountdown: 0 }]]);
    }
  }, [isIntermission, gameStatus, isCoop, isGameHost, broadcastGameData, spHandleStartNextWaveNow]);


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
    if(spCancelInteractions) {
        spCancelInteractions();
        return;
    }

    const mpIsActive = selectedTowerToBuild || focusedTower;

    if (mpIsActive) {
      audioManager.playSfx('build_tower');
    }
    setSelectedTowerToBuild(null);
    setFocusedTower(null);
    
  }, [localPlayerId, selectedTowerToBuild, focusedTower, spCancelInteractions]);

 const handlePlaceTower = useCallback((row: number, col: number, requestedByPlayerId?: Player['id'], requestedTowerId?: string) => {
    if(!isCoop && spHandlePlaceTower) {
        spHandlePlaceTower(row, col);
        return;
    }

    const builderId = requestedByPlayerId || localPlayerId;
    if (builderId === 'spectator') return;

    if (!isGameHost) {
        const towerToBuild = selectedTowerToBuild;
        if (towerToBuild && sendActionRequest) {
            sendActionRequest(DeltaType.BUILD_TOWER_REQUEST.toString(), { towerId: towerToBuild.id, row, col, playerId: builderId });
        }
        return;
    }
    
    let towerToBuild: Tower | undefined | null = requestedTowerId ? allTowers.find(t => t.id === requestedTowerId) : selectedTowerToBuild;
    
    const cellKey = `${row}_${col}`;
    const existingTower = towersByCellRef.current[cellKey];

    if (existingTower) {
        if (builderId === localPlayerId) onFocusTower(existingTower);
        return;
    }

    const builderPlayer = playersRef.current.find(p => p.id === builderId);
    
    if (!towerToBuild || !builderPlayer) {
       if(builderId === localPlayerId) toast({ title: "Bau nicht möglich", variant: "destructive" });
       return;
    }

    const currentPlacedTowers = Object.values(towersByCellRef.current).map(t => t.position);
    const newPath = findPath(START_NODE, END_NODE, [...currentPlacedTowers, { row, col }], GRID_ROWS, GRID_COLS);
    if (!newPath) {
        if(builderId === localPlayerId) toast({ title: "Bau fehlgeschlagen", description: "Der Weg für die Gegner darf nicht blockiert werden.", variant: 'destructive' });
        return;
    }

    if (builderPlayer.resources < towerToBuild.cost) {
        if(builderId === localPlayerId) toast({ title: "Bau fehlgeschlagen", description: "Nicht genügend Ressourcen.", variant: 'destructive' });
        return;
    }

    const newTower: PlacedTower = {
      ...towerToBuild,
      id: `tower-${row}-${col}-${Date.now()}-${Math.random()}`,
      specId: towerToBuild.id,
      position: { row, col },
      lastAttack: 0,
      health: towerToBuild.maxHealth,
      ownerId: builderPlayer.id,
    };

    const newTowersByCell = { ...towersByCellRef.current, [cellKey]: newTower };
    const playerUpdates = { [builderPlayer.id]: { resources: builderPlayer.resources - towerToBuild.cost } };
    
    broadcastGameData([
        [DeltaType.TOWERS_UPDATE, newTowersByCell],
        [DeltaType.PLAYER_UPDATE, playerUpdates]
    ]);
    
    if(builderId === localPlayerId) {
        setJustPlacedTowerId(newTower.id);
        setTimeout(() => setJustPlacedTowerId(null), 1000);
        audioManager.playSfx('build_tower');
    }
}, [localPlayerId, isCoop, isGameHost, selectedTowerToBuild, broadcastGameData, toast, START_NODE, END_NODE, onFocusTower, sendActionRequest, allTowers, spHandlePlaceTower]);

  
  const handleUpgradeTower = useCallback(async (upgradeId: string, requestedByPlayerId?: Player['id']) => {
    if(!isCoop && spHandleUpgradeTower) {
        spHandleUpgradeTower(upgradeId);
        return;
    }

    const builderId = requestedByPlayerId || localPlayerId;
    if (builderId === 'spectator' || !focusedTower) return;
    
    const builderPlayer = playersRef.current.find(p => p.id === builderId);
    if (!builderPlayer) return;
    
    if (focusedTower.ownerId !== builderPlayer.id) {
        if(builderId === localPlayerId) toast({ title: "Upgrade nicht möglich", description: "Du kannst nur deine eigenen Türme upgraden.", variant: "destructive" });
        return;
    }

    if (!isGameHost) {
        if (sendActionRequest) {
            sendActionRequest(DeltaType.UPGRADE_TOWER_REQUEST.toString(), { row: focusedTower.position.row, col: focusedTower.position.col, upgradeId: upgradeId, playerId: builderId });
            cancelInteractions();
        }
        return;
    }
    
    const upgradeTowerSpec = allTowers.find(t => t.id === upgradeId);
    if (!upgradeTowerSpec) {
        if(builderId === localPlayerId) toast({ title: "Upgrade-Fehler", variant: 'destructive' });
        return;
    }
    
    const refundPercentage = difficulty === 'Einfach' ? 1.0 : 0.75;
    const cost = Math.max(0, upgradeTowerSpec.cost - Math.floor(focusedTower.cost * refundPercentage));
    
    if (builderPlayer.resources < cost) {
        if(builderId === localPlayerId) toast({ title: "Upgrade fehlgeschlagen", description: "Nicht genügend Ressourcen.", variant: 'destructive' });
        return;
    }
    
    const cellKey = `${focusedTower.position.row}_${focusedTower.position.col}`;
    const newTowersByCell = { ...towersByCellRef.current };
    
    const upgradedTower: PlacedTower = {
      ...newTowersByCell[cellKey],
      specId: upgradeTowerSpec.id,
      name: upgradeTowerSpec.name,
      damage: upgradeTowerSpec.damage,
      range: upgradeTowerSpec.range,
      attackSpeed: upgradeTowerSpec.attackSpeed,
      maxHealth: upgradeTowerSpec.maxHealth,
      health: upgradeTowerSpec.maxHealth,
      elements: upgradeTowerSpec.elements,
      effect: upgradeTowerSpec.effect,
      cost: upgradeTowerSpec.cost,
      tier: upgradeTowerSpec.tier,
      upgradesTo: upgradeTowerSpec.upgradesTo,
      isBase: upgradeTowerSpec.isBase,
    };
    newTowersByCell[cellKey] = upgradedTower;
    
    const playerUpdates = { [builderPlayer.id]: { resources: builderPlayer.resources - cost } };
    
    broadcastGameData([
      [DeltaType.PLAYER_UPDATE, playerUpdates],
      [DeltaType.TOWERS_UPDATE, newTowersByCell],
      [DeltaType.TOWER_UPGRADE_VFX, { towerId: upgradedTower.id, position: upgradedTower.position }]
    ]);
    
    setFocusedTower(null);
    if(builderId === localPlayerId) audioManager.playSfx('build_tower');
  }, [localPlayerId, isCoop, isGameHost, focusedTower, allTowers, toast, difficulty, broadcastGameData, spHandleUpgradeTower, cancelInteractions, sendActionRequest]);
  
  const handleSellTower = useCallback(async (requestedByPlayerId?: Player['id']) => {
     if(!isCoop && spHandleSellTower) {
        spHandleSellTower();
        return;
    }
    const builderId = requestedByPlayerId || localPlayerId;
    if (builderId === 'spectator' || !focusedTower) return;
    
    const builderPlayer = playersRef.current.find(p => p.id === builderId);
    if (!builderPlayer) return;

    if (focusedTower.ownerId !== builderPlayer.id) {
        if(builderId === localPlayerId) toast({ title: "Verkauf nicht möglich", description: "Du kannst nur deine eigenen Türme verkaufen.", variant: "destructive" });
        return;
    }
  
    if (!isGameHost) {
        if(sendActionRequest) {
            sendActionRequest(DeltaType.SELL_TOWER_REQUEST.toString(), { row: focusedTower.position.row, col: focusedTower.position.col, playerId: builderId });
            cancelInteractions();
        }
        return;
    }
  
    const refundPercentage = difficulty === 'Einfach' ? 1.0 : 0.75;
    const refund = Math.round(focusedTower.cost * refundPercentage);
    const cellKey = `${focusedTower.position.row}_${focusedTower.position.col}`;
  
    const newTowersByCell = { ...towersByCellRef.current };
    delete newTowersByCell[cellKey];
  
    const playerUpdates = { [builderPlayer.id]: { resources: builderPlayer.resources + refund } };
  
    broadcastGameData([
        [DeltaType.TOWERS_UPDATE, newTowersByCell],
        [DeltaType.PLAYER_UPDATE, playerUpdates]
    ]);
  
    setFocusedTower(null);
    if(builderId === localPlayerId) audioManager.playSfx('build_tower');
  }, [isCoop, isGameHost, focusedTower, localPlayerId, broadcastGameData, cancelInteractions, difficulty, toast, sendActionRequest, spHandleSellTower]);

  const handleSelectTowerToBuild = useCallback((tower: Tower | null) => {
    if(!isCoop && spHandleSelectTowerToBuild) {
        spHandleSelectTowerToBuild(tower);
        return;
    }
    
    const currentLocalPlayer = playersRef.current.find(p => p.id === localPlayerId);
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
  }, [isCoop, spHandleSelectTowerToBuild, localPlayerId, toast, selectedTowerToBuild]);
  

  const handleElementPick = (element: Element) => {
    if (isCoop) {
        if (localPlayerId === 'spectator' || !localPlayer) return;
        
        const playerUpdate = { [localPlayer.id]: { unlockedElements: [...localPlayer.unlockedElements, element] }};
        const nextWave = currentWave + 1;

        const stateUpdate = {
            gameStatus: 'playing',
            isIntermission: true,
            waveStartCountdown: INTERMISSION_TIME,
            currentWave: nextWave,
            spawnedThisWave: 0,
        };

        broadcastGameData([
            [DeltaType.PLAYER_UPDATE, playerUpdate],
            [DeltaType.GAME_STATE_UPDATE, stateUpdate]
        ]);
    } else if (spHandleElementPick) {
        spHandleElementPick(element);
    }
  };
  
    useEffect(() => {
        let isTabVisible = true;
        const handleVisibilityChange = () => { isTabVisible = document.visibilityState === 'visible'; };
        document.addEventListener("visibilitychange", handleVisibilityChange);

        let countdownInterval: ReturnType<typeof setInterval>;
        
        if (isGameHost) {
            countdownInterval = setInterval(() => {
                if (gameStatus !== 'playing' || !isIntermission || !isTabVisible) return;
                
                const newTime = Math.max(0, waveStartCountdown - 1);
                const stateUpdate: Partial<any> = { waveStartCountdown: newTime };
                if (newTime <= 0) {
                   stateUpdate.isIntermission = false;
                }
                broadcastGameData([[DeltaType.GAME_STATE_UPDATE, stateUpdate]]);
            }, 1000);
        }
        
        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            if (countdownInterval) clearInterval(countdownInterval);
        };
    }, [isGameHost, gameStatus, isIntermission, broadcastGameData, waveStartCountdown]);

  useEffect(() => {
    if (gameState.lives <= 0 && isGameHost) {
        onGameEnd({ playerName: players[0].name, playerUid: players[0].id, date: new Date().toISOString(), difficulty, wave: currentWave, won: false, finalTowers: towersByCell });
    }
  }, [gameState.lives, players, onGameEnd, difficulty, currentWave, towersByCell, isGameHost]);

  useEffect(() => {
      if (isGameHost && gameStatus === 'playing' && !isIntermission) {
          audioManager.playWaveMusic();
      }
  }, [isGameHost, gameStatus, isIntermission]);
  
    // Main Game Loop - only runs on host
    useEffect(() => {
        if (!isGameHost || !gameStatus) return;

        const gameLoop = (now: number) => {
            gameLoopRef.current = requestAnimationFrame(gameLoop);
            
            if (gameStatus !== 'playing' || isIntermission) {
                lastTickRef.current = now;
                return;
            }
            
            const delta = now - lastTickRef.current;
            if (delta < 1000 / 65) return;
            lastTickRef.current = now;
            setFps(Math.round(1000 / delta));
            
            const deltas: GameDelta[] = [];
            const localEnemies = enemiesRef.current;
            const localPath = currentPathRef.current;
            const localDifficulty = difficultyRef.current;

            // 1. Enemy Spawning
            if (!spawnerStateRef.current) {
                const waveData = waves[currentWaveRef.current];
                if (waveData) {
                    spawnerStateRef.current = { count: 0, timer: 0, waveData: waveData.enemies };
                    deltas.push([DeltaType.GAME_STATE_UPDATE, { spawnedThisWave: 0 }]);
                }
            }
            
            if (spawnerStateRef.current && localPath.length > 0) {
                spawnerStateRef.current.timer += delta;
                if (spawnerStateRef.current.timer >= spawnerStateRef.current.waveData.spawnDelay) {
                    if (spawnerStateRef.current.count < spawnerStateRef.current.waveData.count) {
                        spawnerStateRef.current.timer = 0;
                        const difficultyMod = difficultyModifiers[localDifficulty];
                        const health = isCheating ? spawnerStateRef.current.waveData.health : Math.round(spawnerStateRef.current.waveData.health * difficultyMod.enemyHealth);
                        const movementPattern: Enemy['movementPattern'] = spawnerStateRef.current.waveData.type === 'schnell' ? 'zigzag' : ((spawnerStateRef.current.waveData.type === 'gepanzert' || spawnerStateRef.current.waveData.type === 'boss') ? 'straight' : 'wobble');
                        
                        const newEnemy: Enemy = {
                            id: `enemy-${currentWaveRef.current}-${enemyIdCounter.current++}`, ...spawnerStateRef.current.waveData, health, maxHealth: health,
                            path: localPath, pathIndex: 0, position: START_NODE, isBlocked: false, effects: [],
                            lastMove: now, wasHit: false, targetNode: END_NODE, movementPattern
                        };
                        deltas.push([DeltaType.ENEMY_SPAWN, newEnemy]);
                        deltas.push([DeltaType.GAME_STATE_UPDATE, { spawnedThisWave: spawnerStateRef.current.count + 1 }]);
                        spawnerStateRef.current.count++;
                    }
                }
            }

            // 2. Tower Attacks
            const placedTowers = Object.values(towersByCellRef.current);
            placedTowers.forEach(tower => {
                if (now - tower.lastAttack >= tower.attackSpeed) {
                    const targets = localEnemies.filter(e => {
                        const towerPos = { x: tower.position.col, y: tower.position.row };
                        const enemyPos = { x: e.position.col, y: e.position.row };
                        const distSq = (towerPos.x - enemyPos.x) ** 2 + (towerPos.y - enemyPos.y) ** 2;
                        return distSq <= tower.range ** 2;
                    });

                    if (targets.length > 0) {
                        const mainTarget = targets.sort((a,b) => b.pathIndex - a.pathIndex)[0];
                        deltas.push([DeltaType.TOWER_ATTACK, {
                            id: `attack-${now}-${Math.random()}`,
                            towerId: tower.id,
                            targetId: mainTarget.id,
                            elements: tower.elements,
                            projectile: 'beam'
                        }]);
                        // Update tower's lastAttack time LOCALLY for the host to control firing rate
                        const updatedTower = { ...tower, lastAttack: now };
                        const cellKey = `${tower.position.row}_${tower.position.col}`;
                        towersByCellRef.current = { ...towersByCellRef.current, [cellKey]: updatedTower };
                    }
                }
            });
            
            // 3. Enemy Damage & Effects
            const newDamageDeltas: GameDelta[] = [];
            const newEnemyEffectDeltas: GameDelta[] = [];
            const deadEnemyIds = new Set<string>();

            localEnemies.forEach(enemy => {
                deltas.forEach(delta => {
                    if (delta[0] === DeltaType.TOWER_ATTACK && delta[1].targetId === enemy.id) {
                        const attack = delta[1];
                        const tower = placedTowers.find(t => t.id === attack.towerId);
                        if (tower) {
                            newDamageDeltas.push([DeltaType.ENEMY_DAMAGE, enemy.id, tower.damage]);
                            newDamageDeltas.push([DeltaType.VFX_DAMAGE_NUMBER, {
                                id: `dmg-${now}-${Math.random()}`,
                                targetId: enemy.id,
                                amount: tower.damage,
                                color: elementProjectileColors[tower.elements[0]] || 'white',
                                position: enemy.position,
                            }]);

                            if (enemy.health - tower.damage <= 0) {
                                deadEnemyIds.add(enemy.id);
                            }
                        }
                    }
                });
            });

            deltas.push(...newDamageDeltas);
            
            // 4. Enemy Movement & End of Path
            localEnemies.forEach(enemy => {
                 if (deadEnemyIds.has(enemy.id)) return;
                 const isStunned = enemy.effects.some(e => e.type === 'stun' && e.expires > now);
                 if (!isStunned) {
                    const slowEffect = enemy.effects.find(e => e.type === 'slow' && e.expires > now);
                    const effectiveSpeed = enemy.speed * (slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1);
                    const timeSinceMove = now - enemy.lastMove;
                    
                    if (timeSinceMove / (1000 / effectiveSpeed) >= 1) {
                         if (enemy.pathIndex < localPath.length - 1) {
                            deltas.push([DeltaType.ENEMY_MOVE, enemy.id, enemy.pathIndex + 1, now]);
                        } else {
                            deltas.push([DeltaType.ENEMY_REACH_END, enemy.id]);
                            deltas.push([DeltaType.GAME_STATE_UPDATE, { lives: gameStateRef.current.lives - 1 }]);
                        }
                    }
                 }
            });

            // 5. Handle dead enemies
            let resourcesFromKills = 0;
            deadEnemyIds.forEach(id => {
                const enemy = localEnemies.find(e => e.id === id);
                if (enemy) {
                    resourcesFromKills += enemy.bounty;
                    deltas.push([DeltaType.ENEMY_DIE, id]);
                }
            });

            if (resourcesFromKills > 0) {
                const p1 = playersRef.current.find(p => p.id === 'player1');
                const p2 = playersRef.current.find(p => p.id === 'player2');
                const playerUpdates: Record<string, Partial<Player>> = {};
                if(p1) playerUpdates.player1 = { resources: p1.resources + resourcesFromKills };
                if(p2) playerUpdates.player2 = { resources: p2.resources + resourcesFromKills };
                deltas.push([DeltaType.PLAYER_UPDATE, playerUpdates]);
            }
            
            // Wave Completion Check
            if (spawnerStateRef.current && spawnerStateRef.current.count >= spawnerStateRef.current.waveData.count && localEnemies.filter(e => !deadEnemyIds.has(e.id)).length === 0) {
                spawnerStateRef.current = null;
                const nextWave = currentWaveRef.current + 1;
                
                if (nextWave >= waves.length) {
                    // Game Won
                    onGameEnd({ playerName: players[0].name, playerUid: players[0].id, date: new Date().toISOString(), difficulty: difficultyRef.current, wave: waves.length, won: true, finalTowers: towersByCellRef.current });

                } else {
                     let shouldPickElement = false;
                     if(nextWave > 0 && nextWave % 5 === 0) {
                        shouldPickElement = playersRef.current.some(p => ALL_PICKABLE_ELEMENTS.some(e => !p.unlockedElements.includes(e)));
                     }
                    
                    if(shouldPickElement) {
                       deltas.push([DeltaType.GAME_STATE_UPDATE, { gameStatus: 'picking-element' }]);
                    } else {
                        deltas.push([DeltaType.GAME_STATE_UPDATE, {
                            currentWave: nextWave,
                            isIntermission: true,
                            waveStartCountdown: INTERMISSION_TIME,
                            spawnedThisWave: 0
                        }]);
                    }
                }
            }


            if (deltas.length > 0) {
              broadcastGameData(deltas);
            }
        };
        
        gameLoopRef.current = requestAnimationFrame(gameLoop);
        return () => {
            if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
        };
    }, [isGameHost, gameStatus, isIntermission, setFps, broadcastGameData, onGameEnd, players, isCheating]);
    
    // This effect runs on the host to handle client action requests.
    useEffect(() => {
        if (!isGameHost) return;

        const handleAction = (e: Event) => {
            const { type, payload } = (e as CustomEvent).detail;
            
            switch (Number(type)) {
                case DeltaType.BUILD_TOWER_REQUEST:
                    handlePlaceTower(payload.row, payload.col, payload.playerId, payload.towerId);
                    break;
                case DeltaType.UPGRADE_TOWER_REQUEST:
                    const towerToUpgrade = Object.values(towersByCellRef.current).find(t => t.position.row === payload.row && t.position.col === payload.col);
                    if (towerToUpgrade) {
                        setFocusedTower(towerToUpgrade); // Temporarily set focus to perform action
                        setTimeout(() => handleUpgradeTower(payload.upgradeId, payload.playerId), 0);
                    }
                    break;
                case DeltaType.SELL_TOWER_REQUEST:
                     const towerToSell = Object.values(towersByCellRef.current).find(t => t.position.row === payload.row && t.position.col === payload.col);
                     if (towerToSell) {
                        setFocusedTower(towerToSell); // Temporarily set focus
                        setTimeout(() => handleSellTower(payload.playerId), 0);
                     }
                    break;
            }
        };
        
        document.addEventListener('hostActionRequest', handleAction);
        return () => document.removeEventListener('hostActionRequest', handleAction);

    }, [isGameHost, handlePlaceTower, handleUpgradeTower, handleSellTower]);

  if (!localPlayer && !isCoop) return null; // Wait for player init in SP

  const isSpectator = localPlayerId === 'spectator';
  const currentFocusedTower = isCoop ? focusedTower : spFocusedTower;
  const currentSelectedTower = isCoop ? selectedTowerToBuild : spSelectedTowerToBuild;

  const interactionPrompt = isSpectator
    ? 'Du schaust zu.'
    : currentSelectedTower
    ? `Wähle Bauplatz für ${localPlayer?.name}: ${currentSelectedTower?.name}`
    : currentFocusedTower
    ? `Fokus: ${currentFocusedTower?.name} (Besitzer: ${players.find(p => p.id === currentFocusedTower?.ownerId)?.name})`
    : (isCoop && localPlayerId ? `Du bist ${players.find(p=> p.id === localPlayerId)?.name}` : 'Wähle einen Turm zum Bauen');
    
  const LayoutComponent = isMobile ? MobileLayout : DesktopLayout;

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
            towers={allTowers}
            setTowers={() => {}} // SP manages its own tower data
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
            handleStartNextWaveNow={handleStartNextWaveNow}
            lastUpgradedTowerId={lastUpgradedTowerId}
            justPlacedTowerId={justPlacedTowerId}
            isCoop={isCoop}
            playerRole={localPlayerId}
            handleLoadTestLayout={spHandleLoadTestLayout!}
            handleLoadAllTowersLayout={spHandleLoadAllTowersLayout!}
            isCheating={isCheating}
            cheat_addResources={spCheatAddResources}
            cheat_skipWaves={spCheatSkipWaves}
            cheat_heal={spCheatHeal}
            cheat_unlockAll={spCheatUnlockAll!}
            firingTowerIds={firingTowerIds}
            allTowers={allTowers}
            isWsConnected={isWsConnected}
            hostPacketsPerSecond={hostPacketsPerSecond}
            clientPacketsPerSecond={clientPacketsPerSecond}
            averagePacketSize={averagePacketSize}
            hostBytesSentPerSecond={hostBytesSentPerSecond}
            clientBytesReceivedPerSecond={clientBytesReceivedPerSecond}
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
    
