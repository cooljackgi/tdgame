

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

const towersToArray = (towersByCell: Record<string, PlacedTower> | undefined): PlacedTower[] => {
    if (!towersByCell) return [];
    return Object.values(towersByCell);
}

type GameSessionProps = {
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
    isCoop: boolean;
    isGameHost: boolean;
    localPlayerId: Player['id'] | null;
    broadcastGameData: (deltas: GameDelta[], reliable?: boolean) => void;
    applyDeltas: (deltas: GameDelta[]) => void;
    onGameEnd: (result: GameResult) => void;
    onExit: () => void;
    attacks: Attack[];
    damageNumbers: DamageNumber[];
    splashRings: SplashRing[];
    lastUpgradedTowerId: string | null;
    setLastUpgradedTowerId: (id: string | null) => void;
    setFiringTowerIds: (val: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
    firingTowerIds: Set<string>;
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
    onLocalAction: (action: 'build' | 'upgrade' | 'sell', payload: any) => void;
}

export default function GameSession({ 
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
    broadcastGameData, applyDeltas, onGameEnd, onExit, onLocalAction,

    // VFX
    attacks, damageNumbers, splashRings, lastUpgradedTowerId, setLastUpgradedTowerId, firingTowerIds, setFiringTowerIds,

    // Stats
    fps, setFps,
    isWsConnected, hostPacketsPerSecond, hostBytesSentPerSecond, clientPacketsPerSecond, clientBytesReceivedPerSecond, averagePacketSize,
    finalGameResult,
    totalKilled, setTotalKilled,
    totalLeaked, setTotalLeaked,
}: GameSessionProps) {
  
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  const allTowers = useMemo(() => initialTowers.map(t => ({...t})), []);
  const placedTowers = useMemo(() => towersToArray(towersByCell), [towersByCell]);

  const [selectedTowerToBuild, setSelectedTowerToBuild] = useState<Tower | null>(null);
  const [focusedTower, setFocusedTower] = useState<PlacedTower | null>(null);
  
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [justPlacedTowerId, setJustPlacedTowerId] = useState<string|null>(null);
  
  const difficultyMod = difficultyModifiers[difficulty];
  const localPlayer = useMemo(() => players.find(p => p.id === localPlayerId), [players, localPlayerId]);

  const START_NODE = { row: 1, col: 1 };
  const END_NODE = { row: GRID_ROWS, col: GRID_COLS };

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
        const newMutedState = !prev;
        if (newMutedState) audioManager.mute();
        else {
            audioManager.unmute();
            if (gameStatus === 'playing' && !isIntermission) audioManager.playWaveMusic();
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
  
  const resetGame = useCallback(() => {
    audioManager.stopMusic();
    onExit();
  }, [onExit]);

  const handleGameControl = useCallback(() => {
    if (localPlayerId === 'spectator') return;
    audioManager.playSfx('build_tower');

    if (!isGameHost) {
      toast({ title: 'Nur der Host kann das Spiel steuern.' });
      return;
    }
    
    let stateUpdate: Partial<any> = {};
    if (gameStatus === 'playing') stateUpdate = { gameStatus: 'paused' };
    else if (gameStatus === 'paused' || gameStatus === 'waiting') {
       stateUpdate = { gameStatus: 'playing', isIntermission: false, waveStartCountdown: 0 };
    } else return;
    
    broadcastGameData([[DeltaType.GAME_STATE_UPDATE, stateUpdate]]);

  }, [gameStatus, isGameHost, toast, localPlayerId, broadcastGameData]);

  const handleStartNextWaveNow = useCallback(() => {
    if (isIntermission && gameStatus === 'playing' && isGameHost) {
        broadcastGameData([[DeltaType.GAME_STATE_UPDATE, { isIntermission: false, waveStartCountdown: 0 }]]);
    }
  }, [isIntermission, gameStatus, isGameHost, broadcastGameData]);

  const onFocusTower = useCallback((tower: PlacedTower) => {
    setSelectedTowerToBuild(null);
    setFocusedTower(tower);
    audioManager.playSfx('build_tower');
  }, []);

  const cancelInteractions = useCallback(() => {
    if (localPlayerId === 'spectator') return;
    if (selectedTowerToBuild || focusedTower) audioManager.playSfx('build_tower');
    setSelectedTowerToBuild(null);
    setFocusedTower(null);
  }, [localPlayerId, selectedTowerToBuild, focusedTower]);

  const handlePlaceTower = useCallback((row: number, col: number) => {
    if (localPlayerId === 'spectator' || !selectedTowerToBuild) return;
    onLocalAction('build', { row, col });
    // Keep tower selected for multi-build
    // cancelInteractions();
  }, [localPlayerId, selectedTowerToBuild, onLocalAction]);
  
  const handleUpgradeTower = useCallback((upgradeId: string) => {
      if (localPlayerId === 'spectator' || !focusedTower) return;
      if (focusedTower.ownerId !== localPlayerId) {
          toast({ title: "Upgrade nicht möglich", description: "Du kannst nur deine eigenen Türme upgraden.", variant: "destructive" });
          return;
      }
      onLocalAction('upgrade', { row: focusedTower.position.row, col: focusedTower.position.col, upgradeId });
      cancelInteractions();
  }, [localPlayerId, focusedTower, onLocalAction, cancelInteractions, toast]);
  
  const handleSellTower = useCallback(() => {
      if (localPlayerId === 'spectator' || !focusedTower) return;
      if (focusedTower.ownerId !== localPlayerId) {
          toast({ title: "Verkauf nicht möglich", description: "Du kannst nur deine eigenen Türme verkaufen.", variant: "destructive" });
          return;
      }
      onLocalAction('sell', { row: focusedTower.position.row, col: focusedTower.position.col });
      cancelInteractions();
  }, [localPlayerId, focusedTower, onLocalAction, cancelInteractions, toast]);

  const handleSelectTowerToBuild = useCallback((tower: Tower | null) => {
    const currentLocalPlayer = players.find(p => p.id === localPlayerId);
    if (!currentLocalPlayer || (tower && currentLocalPlayer.resources < tower.cost)) {
      if(tower) toast({ title: 'Nicht genügend Ressourcen', variant: 'destructive'});
      if (tower === null) {
          setSelectedTowerToBuild(null);
          if (typeof document !== "undefined") (document as any).__SELECTED_TOWER_ID = null;
      }
      return;
    }
    if (selectedTowerToBuild?.id === tower?.id) { 
        setSelectedTowerToBuild(null); 
        if (typeof document !== "undefined") (document as any).__SELECTED_TOWER_ID = null;
        return; 
    }
    setSelectedTowerToBuild(tower);
    setFocusedTower(null);
    if (typeof document !== "undefined") (document as any).__SELECTED_TOWER_ID = tower?.id;
  }, [players, localPlayerId, toast, selectedTowerToBuild]);
  
  const handleElementPick = (element: Element) => {
    if (localPlayerId === 'spectator' || !localPlayer) return;
    
    const playerUpdate = { [localPlayer.id]: { unlockedElements: [...localPlayer.unlockedElements, element] }};
    const stateUpdate = { gameStatus: 'playing', isIntermission: true, waveStartCountdown: INTERMISSION_TIME, currentWave: currentWave + 1, spawnedThisWave: 0 };

    broadcastGameData([
        [DeltaType.PLAYER_UPDATE, playerUpdate],
        [DeltaType.GAME_STATE_UPDATE, stateUpdate]
    ]);
  };
  
  if (!localPlayer) return null;

  const isSpectator = localPlayerId === 'spectator';
  const interactionPrompt = isSpectator ? 'Du schaust zu.' : selectedTowerToBuild ? `Wähle Bauplatz für: ${selectedTowerToBuild?.name}` : focusedTower ? `Fokus: ${focusedTower?.name}` : 'Wähle einen Turm zum Bauen';
    
  const LayoutComponent = isMobile ? MobileLayout : DesktopLayout;

  return (
    <div className="flex flex-col h-full bg-background text-foreground font-body" onClick={handleInteraction}>
      <Header isMobile={isMobile} onExit={resetGame} fps={fps} isMuted={isMuted} toggleMute={toggleMute} />
      <main className="flex-grow md:p-6 h-[calc(100%-69px)]">
        <LayoutComponent
            players={players} setPlayers={setPlayers}
            gameState={gameState} localPlayer={localPlayer}
            currentWave={currentWave} totalWaves={waves.length}
            difficulty={difficulty} handleGameControl={handleGameControl}
            gameStatus={gameStatus} resetGame={resetGame}
            towers={allTowers} setTowers={() => {}} 
            placedTowers={placedTowers} enemies={enemies} attacks={attacks}
            damageNumbers={damageNumbers} splashRings={splashRings}
            currentPath={currentPath} handlePlaceTower={handlePlaceTower}
            onFocusTower={onFocusTower} selectedTowerToBuild={selectedTowerToBuild}
            focusedTower={focusedTower} rows={GRID_ROWS} cols={GRID_COLS}
            startNode={START_NODE} endNode={END_NODE}
            interactionPrompt={interactionPrompt} cancelInteractions={cancelInteractions}
            onSelectTowerToBuild={handleSelectTowerToBuild} handleUpgradeTower={handleUpgradeTower}
            handleSellTower={handleSellTower} setFocusedTower={setFocusedTower}
            spawnedThisWave={spawnedThisWave} totalEnemiesInWave={waves[currentWave]?.enemies.count || 0}
            totalKilled={totalKilled} totalLeaked={totalLeaked}
            isIntermission={isIntermission} waveStartCountdown={waveStartCountdown}
            intermissionTime={INTERMISSION_TIME} handleStartNextWaveNow={handleStartNextWaveNow}
            lastUpgradedTowerId={lastUpgradedTowerId} justPlacedTowerId={justPlacedTowerId}
            isCoop={isCoop} playerRole={localPlayerId}
            handleLoadTestLayout={() => {}} handleLoadAllTowersLayout={() => {}}
            isCheating={false} cheat_addResources={() => {}} cheat_skipWaves={() => {}} cheat_heal={() => {}} cheat_unlockAll={() => {}}
            firingTowerIds={firingTowerIds} allTowers={allTowers}
            isWsConnected={isWsConnected} hostPacketsPerSecond={hostPacketsPerSecond} clientPacketsPerSecond={clientPacketsPerSecond}
            averagePacketSize={averagePacketSize} hostBytesSentPerSecond={hostBytesSentPerSecond} clientBytesReceivedPerSecond={clientBytesReceivedPerSecond}
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
             <div className="flex flex-col items-center gap-2"><p className="text-sm font-semibold text-muted-foreground">Dein finales Spielfeld:</p><ScoreboardMiniMap towersByCell={finalGameResult.finalTowers} /></div>
          )}
          <AlertDialogFooter><AlertDialogAction onClick={resetGame}>Zum Hauptmenü</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {localPlayer && !isSpectator && <ElementPickDialog
        isOpen={gameStatus === 'picking-element'}
        unlockedElements={new Set(localPlayer.unlockedElements)}
        onElementPick={handleElementPick}
        playerName={localPlayer.name}
        currentWave={currentWave}
      />}
    </div>
  );
}
