
"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Header from '@/components/game/header';
import type { Tower, PlacedTower, Enemy, Node, Element, Difficulty, Attack, DamageNumber, SplashRing, GameSaveState, GameResult, GameResultWithId, GameDelta, EnemyStatusEffect, MovementPattern } from '@/lib/game-data/types';
import { DeltaType } from '@/lib/game-data/types';
import { waves } from '@/lib/game-data/enemies';
import { difficultyModifiers, INTERMISSION_TIME, GRID_ROWS, GRID_COLS, LOCAL_STORAGE_KEY } from '@/lib/game-data/constants';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { DesktopLayout } from '@/components/layouts/desktop-layout';
import { MobileLayout } from '@/components/layouts/mobile-layout';
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ElementPickDialog } from './element-pick-dialog';
import { audioManager } from '@/lib/audio/audio-manager';
import { findPath } from '@/lib/pathfinding';
import ScoreboardMiniMap from './ScoreboardMiniMap';
import type { User } from 'firebase/auth';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import GameBoard, { type GameBoardHandle } from './game-board';


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

export type GameStatus = 'waiting' | 'playing' | 'paused' | 'gameover' | 'picking-element';

const towersToArray = (towersByCell: Record<string, PlacedTower> | undefined): PlacedTower[] => {
    if (!towersByCell) return [];
    return Object.values(towersByCell);
}

type GameSessionProps = {
    // --- State from parent ---
    players: Player[];
    setPlayers: React.Dispatch<React.SetStateAction<Player[]>>;
    gameState: GameState;
    setGameState: React.Dispatch<React.SetStateAction<GameState>>;
    towersByCell: Record<string, PlacedTower>;
    setTowersByCell: React.Dispatch<React.SetStateAction<Record<string, PlacedTower>>>;
    enemies: Enemy[];
    setEnemies: React.Dispatch<React.SetStateAction<Enemy[]>>;
    currentWave: number;
    setCurrentWave: React.Dispatch<React.SetStateAction<number>>;
    difficulty: Difficulty;
    gameStatus: GameStatus;
    setGameStatus: React.Dispatch<React.SetStateAction<GameStatus>>;

    // --- Config ---
    isCoop: boolean;
    isGameHost: boolean;
    localPlayerId: Player['id'] | null;
    isCheating?: boolean;
    user: User | null;
    allTowers: Tower[];
    initialEnemies: Enemy[];

    // --- Control Functions from Parent ---
    onExit: () => void;
    onPlaceTower: (row: number, col: number, towerId: string) => void;
    onUpgradeTower: (upgradeId: string) => void;
    onSellTower: () => void;
    onFocusTower: (tower: PlacedTower) => void;
    cancelInteractions: () => void;
    onSelectTowerToBuild: (tower: Tower | null) => void;
    onElementPick: (element: Element) => void;
    onStartNextWaveNow?: () => void;
    waveStartCountdown?: number;
    
    // --- VFX State & Interaction State (passed down from parent) ---
    attacks: Attack[];
    selectedTowerToBuild: Tower | null;
    focusedTower: PlacedTower | null;
    justPlacedTowerId: string | null;
    lastUpgradedTowerId: string | null;
    gameBoardRef: React.RefObject<GameBoardHandle>;
    
    // --- Stats (passed down from parent in CO-OP) ---
    isWsConnected?: boolean;
    hostPacketsPerSecond?: number;
    hostBytesSentPerSecond?: number;
    clientPacketsPerSecond?: number;
    clientBytesReceivedPerSecond?: number;
    averagePacketSize?: number;
}

export function GameSession(props: GameSessionProps) {
  
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  // --- De-structure all props ---
  const {
      players, setPlayers, gameState, setGameState, towersByCell, setTowersByCell,
      enemies, setEnemies, currentWave, setCurrentWave, difficulty, gameStatus, setGameStatus,
      isCoop, isGameHost, localPlayerId, isCheating, user, allTowers, initialEnemies,
      onExit, onPlaceTower, onUpgradeTower, onSellTower, onFocusTower, cancelInteractions,
      onSelectTowerToBuild, onElementPick, onStartNextWaveNow,
      attacks, selectedTowerToBuild, focusedTower, justPlacedTowerId, lastUpgradedTowerId, gameBoardRef,
      isWsConnected, hostPacketsPerSecond, hostBytesSentPerSecond, clientPacketsPerSecond, clientBytesReceivedPerSecond, averagePacketSize
  } = props;
  
  // --- UI/Interaction State ---
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // --- VFX State ---
  const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
  const [splashRings, setSplashRings] = useState<SplashRing[]>([]);
  const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());
  const [finalGameResult, setFinalGameResult] = useState<GameResult | null>(null);

  // --- Stats State ---
  const [fps, setFps] = useState(0);
  const [totalKilled, setTotalKilled] = useState(0);
  const [totalLeaked, setTotalLeaked] = useState(0);

  const placedTowers = useMemo(() => towersToArray(towersByCell), [towersByCell]);
  const currentPath = useMemo(() => findPath({ row: 1, col: 1 }, { row: GRID_ROWS, col: GRID_COLS }, placedTowers.map(t => t.position), GRID_ROWS, GRID_COLS) || [], [placedTowers]);
  const localPlayer = useMemo(() => players.find(p => p.id === localPlayerId), [players, localPlayerId]);
  
  useEffect(() => {
    if(attacks?.length) {
        gameBoardRef.current?.queueAttacks(attacks);
    }
  }, [attacks, gameBoardRef]);

  const isIntermission = useMemo(() => {
     if (isCoop) return props.waveStartCountdown !== 0;
     return enemies.length === 0 && !isCoop; // Simplified for clarity
  }, [isCoop, enemies, props.waveStartCountdown]);

  const waveStartCountdown = useMemo(() => {
    if (isIntermission) return props.waveStartCountdown ?? INTERMISSION_TIME;
    return 0;
  }, [isIntermission, isCoop, props.waveStartCountdown]);


  const handleGameEnd = useCallback(async (result: GameResult) => {
    if (gameStatus !== 'gameover') {
        setGameStatus('gameover');
        if (!isCoop) {
            localStorage.removeItem(LOCAL_STORAGE_KEY);
            if (user && !isCheating) {
                try {
                    await addDoc(collection(db, "scores"), { ...result, date: serverTimestamp() });
                } catch(e) { console.error("Failed to save score", e); }
            }
        }
        setFinalGameResult({ ...result, date: new Date().toISOString() });
    }
  }, [isCoop, user, isCheating, gameStatus, setGameStatus]);

  const toggleMute = useCallback(() => setIsMuted(prev => { audioManager.isMuted = !prev; return !prev; }), []);
  const handleInteraction = useCallback(async () => { if (!hasInteracted) { await audioManager.init(); setHasInteracted(true); } }, [hasInteracted]);
  const resetGame = useCallback(() => { audioManager.stopMusic(); onExit(); }, [onExit]);
  
  const handleGameControl = useCallback(() => {
    audioManager.playSfx('build_tower');
    setGameStatus(prev => (prev === 'playing' ? 'paused' : 'playing'));
  }, [setGameStatus]);

  const handlePlaceTower = useCallback((row: number, col: number) => {
    if (selectedTowerToBuild) {
      onPlaceTower(row, col, selectedTowerToBuild.id);
    }
  }, [selectedTowerToBuild, onPlaceTower]);

  const handleUpgradeTower = useCallback((upgradeId: string) => {
    onUpgradeTower(upgradeId);
  }, [onUpgradeTower]);

  const handleSellTower = useCallback(() => {
    onSellTower();
  }, [onSellTower]);
  
  const handleStartNextWaveNow = useCallback(() => {
    props.onStartNextWaveNow?.();
  }, [props.onStartNextWaveNow]);
  
  if (!localPlayer) return null;

  const isSpectator = localPlayerId === 'spectator';
  const interactionPrompt = isSpectator ? 'Du schaust zu.' : selectedTowerToBuild ? `Wähle Bauplatz für: ${selectedTowerToBuild?.name}` : focusedTower ? `Fokus: ${focusedTower?.name}` : 'Wähle einen Turm zum Bauen';
  const LayoutComponent = isMobile ? MobileLayout : DesktopLayout;

  return (
    <div className="flex flex-col h-full bg-background text-foreground font-body" onClick={handleInteraction}>
      <Header isMobile={isMobile} onExit={resetGame} fps={isCoop ? (props.hostPacketsPerSecond || 0) : fps} isMuted={isMuted} toggleMute={toggleMute} />
      <main className="flex-grow md:p-6 h-[calc(100%-69px)]">
        <LayoutComponent
            players={players} setPlayers={setPlayers} gameState={gameState} localPlayer={localPlayer}
            currentWave={currentWave} totalWaves={waves.length} difficulty={difficulty} 
            handleGameControl={handleGameControl} gameStatus={gameStatus} resetGame={resetGame}
            towers={allTowers} setTowers={() => {}} 
            placedTowers={placedTowers} enemies={enemies} 
            damageNumbers={damageNumbers} 
            splashRings={splashRings}
            currentPath={currentPath} handlePlaceTower={handlePlaceTower}
            onFocusTower={onFocusTower} selectedTowerToBuild={selectedTowerToBuild}
            focusedTower={focusedTower}
            gameBoardRef={gameBoardRef}
            interactionPrompt={interactionPrompt} cancelInteractions={cancelInteractions}
            onSelectTowerToBuild={onSelectTowerToBuild} 
            handleUpgradeTower={handleUpgradeTower}
            handleSellTower={handleSellTower}
            setFocusedTower={() => {}} // This is managed by parent
            spawnedThisWave={0} // placeholder
            totalEnemiesInWave={waves[currentWave]?.enemies.count || 0}
            totalKilled={totalKilled} 
            totalLeaked={totalLeaked}
            isIntermission={isIntermission} waveStartCountdown={waveStartCountdown}
            intermissionTime={INTERMISSION_TIME} handleStartNextWaveNow={handleStartNextWaveNow}
            lastUpgradedTowerId={lastUpgradedTowerId}
            justPlacedTowerId={justPlacedTowerId}
            isCoop={isCoop} playerRole={localPlayerId}
            handleLoadTestLayout={() => {}} handleLoadAllTowersLayout={() => {}}
            isCheating={!!isCheating} cheat_addResources={() => {}} cheat_skipWaves={() => {}} cheat_heal={() => {}} cheat_unlockAll={() => {}}
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
          {(finalGameResult)?.finalTowers && (
             <div className="flex flex-col items-center gap-2"><p className="text-sm font-semibold text-muted-foreground">Dein finales Spielfeld:</p><ScoreboardMiniMap towersByCell={(finalGameResult)!.finalTowers!} /></div>
          )}
          <AlertDialogFooter><AlertDialogAction onClick={resetGame}>Zum Hauptmenü</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {localPlayer && !isSpectator && <ElementPickDialog
        isOpen={gameStatus === 'picking-element'}
        unlockedElements={new Set(localPlayer.unlockedElements)}
        onElementPick={onElementPick}
        playerName={localPlayer.name}
        currentWave={currentWave}
      />}
    </div>
  );
}
