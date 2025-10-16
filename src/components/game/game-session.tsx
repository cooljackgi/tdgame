

"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Header from '@/components/game/header';
import type { Tower, PlacedTower, Enemy, Node, Element, Difficulty, Attack, DamageNumber, SplashRing, TowerEffect, GameSaveState, GameResult, GameResultWithId, GameDelta, EnemyStatusEffect } from '@/lib/game-data/types';
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
    setEnemies: React.Dispatch<React.SetStateAction<Enemy[]>>;
    spawnedThisWave: number;
    setSpawnedThisWave: React.Dispatch<React.SetStateAction<number>>;

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
    setFiringTowerIds: React.Dispatch<React.SetStateAction<Set<string>>>;
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
    finalGameResult
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
  
  const [totalKilled, setTotalKilled] = useState(0);
  const [totalLeaked, setTotalLeaked] = useState(0);

  // Simulation
  const countdownRef = useRef<ReturnType<typeof setInterval> | undefined>();
  
  const difficultyMod = difficultyModifiers[difficulty];
  const localPlayer = useMemo(() => players.find(p => p.id === localPlayerId), [players, localPlayerId]);

  const START_NODE = { row: 1, col: 1 };
  const END_NODE = { row: GRID_ROWS, col: GRID_COLS };
  
  useEffect(() => {
    if (isGameHost && gameStatus === 'waiting' && players.length === 2 && players.every(p => p.id !== 'spectator')) {
        broadcastGameData([[DeltaType.GAME_STATE_UPDATE, {
          gameStatus: 'playing',
          isIntermission: true,
          waveStartCountdown: INTERMISSION_TIME 
        }]]);
    }
  }, [isGameHost, gameStatus, players, broadcastGameData]);


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
        if(countdownRef.current) clearInterval(countdownRef.current);
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
    const existingTower = towersByCell[cellKey];

    if (existingTower) {
        if (builderId === localPlayerId) onFocusTower(existingTower);
        return;
    }

    const builderPlayer = players.find(p => p.id === builderId);
    
    if (!towerToBuild || !builderPlayer) {
       if(builderId === localPlayerId) toast({ title: "Bau nicht möglich", variant: "destructive" });
       return;
    }

    const currentPlacedTowers = Object.values(towersByCell).map(t => t.position);
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

    const newTowersByCell = { ...towersByCell, [cellKey]: newTower };
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
}, [localPlayerId, isCoop, isGameHost, selectedTowerToBuild, broadcastGameData, players, towersByCell, toast, START_NODE, END_NODE, onFocusTower, sendActionRequest, allTowers, spHandlePlaceTower]);

  
  const handleUpgradeTower = useCallback(async (upgradeId: string, requestedByPlayerId?: Player['id']) => {
    if(!isCoop && spHandleUpgradeTower) {
        spHandleUpgradeTower(upgradeId);
        return;
    }

    const builderId = requestedByPlayerId || localPlayerId;
    if (builderId === 'spectator' || !focusedTower) return;
    
    const builderPlayer = players.find(p => p.id === builderId);
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
    const newTowersByCell = { ...towersByCell };
    
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
  }, [players, localPlayerId, isCoop, isGameHost, focusedTower, allTowers, toast, difficulty, broadcastGameData, towersByCell, spHandleUpgradeTower, cancelInteractions, sendActionRequest]);
  
  const handleSellTower = useCallback(async (requestedByPlayerId?: Player['id']) => {
     if(!isCoop && spHandleSellTower) {
        spHandleSellTower();
        return;
    }
    const builderId = requestedByPlayerId || localPlayerId;
    if (builderId === 'spectator' || !focusedTower) return;
    
    const builderPlayer = players.find(p => p.id === builderId);
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
  
    const newTowersByCell = { ...towersByCell };
    delete newTowersByCell[cellKey];
  
    const playerUpdates = { [builderPlayer.id]: { resources: builderPlayer.resources + refund } };
  
    broadcastGameData([
        [DeltaType.TOWERS_UPDATE, newTowersByCell],
        [DeltaType.PLAYER_UPDATE, playerUpdates]
    ]);
  
    setFocusedTower(null);
    if(builderId === localPlayerId) audioManager.playSfx('build_tower');
  }, [isCoop, isGameHost, focusedTower, players, localPlayerId, broadcastGameData, cancelInteractions, difficulty, towersByCell, toast, sendActionRequest, spHandleSellTower]);

  const handleSelectTowerToBuild = useCallback((tower: Tower | null) => {
    if(!isCoop && spHandleSelectTowerToBuild) {
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
  

  const handleElementPick = (element: Element) => {
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
  };
  
  const isSpectator = localPlayerId === 'spectator';
  const canStartWave = !isSpectator && (!isCoop || isGameHost);

  const interactionPrompt = isSpectator
    ? 'Du schaust zu.'
    : (isCoop ? selectedTowerToBuild : spSelectedTowerToBuild)
    ? `Wähle Bauplatz für ${localPlayer?.name}: ${(isCoop ? selectedTowerToBuild : spSelectedTowerToBuild)?.name}`
    : (isCoop ? focusedTower : spFocusedTower)
    ? `Fokus: ${(isCoop ? focusedTower : spFocusedTower)?.name} (Besitzer: ${players.find(p => p.id === (isCoop ? focusedTower : spFocusedTower)?.ownerId)?.name})`
    : (isCoop && localPlayerId ? `Du bist ${players.find(p=> p.id === localPlayerId)?.name}` : 'Wähle einen Turm zum Bauen');
    
  const LayoutComponent = isMobile ? MobileLayout : DesktopLayout;
  
  const currentFocusedTower = isCoop ? focusedTower : spFocusedTower;
  const currentSelectedTower = isCoop ? selectedTowerToBuild : spSelectedTowerToBuild;

  // Listen for client actions if we are the host
  useEffect(() => {
    if (!isGameHost) return;

    const handleAction = (e: Event) => {
        const { type, payload } = (e as CustomEvent).detail;
        
        switch (Number(type)) {
            case DeltaType.BUILD_TOWER_REQUEST:
                handlePlaceTower(payload.row, payload.col, payload.playerId, payload.towerId);
                break;
            case DeltaType.UPGRADE_TOWER_REQUEST:
                const towerToUpgrade = Object.values(towersByCell).find(t => t.position.row === payload.row && t.position.col === payload.col);
                if (towerToUpgrade) {
                    setFocusedTower(towerToUpgrade);
                    setTimeout(() => handleUpgradeTower(payload.upgradeId, payload.playerId), 0);
                }
                break;
            case DeltaType.SELL_TOWER_REQUEST:
                 const towerToSell = Object.values(towersByCell).find(t => t.position.row === payload.row && t.position.col === payload.col);
                 if (towerToSell) {
                    setFocusedTower(towerToSell);
                    setTimeout(() => handleSellTower(payload.playerId), 0);
                 }
                break;
        }
    };
    
    document.addEventListener('hostActionRequest', handleAction);
    return () => document.removeEventListener('hostActionRequest', handleAction);

  }, [isGameHost, handlePlaceTower, handleUpgradeTower, handleSellTower, towersByCell]);

  if (!localPlayer && !isSpectator) return null;

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
            setTowers={() => {}} // No-op, managed by spAllTowers
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
