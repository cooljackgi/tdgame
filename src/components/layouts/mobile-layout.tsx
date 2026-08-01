

"use client";

import React, { useState, memo, useMemo, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Pause, Play, LogOut, Hammer, ArrowUpCircle, ChevronsUpDown, Bug, X, MessageCircle, Eye, RefreshCcw, Coins, Sparkles, Microscope, Bot, Heart, TrendingUp, Move, ZoomIn } from 'lucide-react';
import WaveTracker from '@/components/game/wave-tracker';
import GameStatsTracker from '@/components/game/game-stats-tracker';
import GameBoard, { type GameBoardHandle } from '@/components/game/game-board';
import TowerSelection from '@/components/game/tower-selection';
import DebugMenu from '@/components/game/debug-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import WaveStartTimer from '../game/wave-start-timer';
import { ScrollArea } from '../ui/scroll-area';
import WavePreview from '../game/wave-preview';
import { Separator } from '../ui/separator';

import type {
  Tower, Wave, PlacedTower, Enemy, Node, Player, GameState,
  Attack, DamageNumber, SplashRing, Difficulty, PingKind, Element, PersistentCloud,
  Worker, GhostFoundation, Portal
} from '@/lib/game-data/types';

type GameStatus = 'waiting' | 'playing' | 'paused' | 'gameover' | 'picking-element' | 'tutorial';

interface MobileLayoutProps {
  players: Player[];
  setPlayers: React.Dispatch<React.SetStateAction<Player[]>>;
  gameState: GameState;
  localPlayer: Player;
  currentWave: number;
  totalWaves: number;
  difficulty: Difficulty;
  placedTowers: PlacedTower[];
  enemies: Enemy[];
  workers: Worker[];
  ghosts: GhostFoundation[];
  portals: Portal[];
  damageNumbers: DamageNumber[];
  splashRings: SplashRing[];
  persistentClouds: PersistentCloud[];
  currentPath: Node[];
  handlePlaceTower: (row: number, col: number) => void;
  onFocusTower: (tower: PlacedTower) => void;
  selectedTowerToBuild: Tower | null;
  portalEntrance: Node | null;
  focusedTower: PlacedTower | null;
  gameBoardRef: React.RefObject<GameBoardHandle>;
  interactionPrompt: string | null;
  cancelInteractions: () => void;
  handleGameControl: () => void;
  gameStatus: GameStatus;
  resetGame: () => void;
  onSelectTowerToBuild: (tower: Tower | null) => void;
  onEnterPortalMode: () => void;
  handleUpgradeTower: (upgradeId: string) => void;
  handleSellTower: () => void;
  setFocusedTower: (tower: PlacedTower | null) => void;
  towers: Tower[];
  waves: Wave[];
  setTowers: React.Dispatch<React.SetStateAction<Tower[]>>;
  spawnedThisWave: number;
  totalEnemiesInWave: number;
  totalKilled: number;
  totalLeaked: number;
  isIntermission: boolean;
  waveStartCountdown: number;
  intermissionTime: number;
  handleStartNextWaveNow: () => void;
  lastUpgradedTowerId: string | null;
  justPlacedTowerId?: string | null;
  isCoop: boolean;
  playerRole: 'player1' | 'player2' | 'spectator' | null;
  handleLoadTestLayout: () => void;
  handleLoadAllTowersLayout: () => void;
  isCheating: boolean;
  cheat_addResources?: () => void;
  cheat_skipWaves?: () => void;
  cheat_heal?: () => void;
  cheat_unlockAll: () => void;
  firingTowerIds: Set<string>;
  allTowers: Tower[];
  attacks?: Attack[];
  onPing?: (kind: PingKind, row: number, col: number, msg?: string) => void;
    // Network Stats
  isWsConnected?: boolean;
  hostPacketsPerSecond?: number;
  hostBytesSentPerSecond?: number;
  clientPacketsPerSecond?: number;
  clientBytesReceivedPerSecond?: number;
  averagePacketSize?: number;
  isPlacingPortalEntrance?: boolean;
  gameMode?: 'coop' | 'versus';
  onSendEnemy?: (payload: { type: any; cost: number; incomeBonus: number }) => void;
}

const hasAllElements = (unlockedElements: Set<Element>, requiredElements: Element[]) => {
    return requiredElements.every(element => unlockedElements.has(element));
};

export const MobileLayout = memo(function MobileLayout(props: MobileLayoutProps) {
  const {
    players, setPlayers, gameState, localPlayer, currentWave, totalWaves, difficulty, placedTowers, enemies,
    workers, ghosts, portals,
    damageNumbers, splashRings, persistentClouds, currentPath, handlePlaceTower, onFocusTower, selectedTowerToBuild,
    portalEntrance, focusedTower, gameBoardRef, interactionPrompt,
    cancelInteractions, handleGameControl, gameStatus, resetGame,
    onSelectTowerToBuild, onEnterPortalMode, handleUpgradeTower, handleSellTower, setFocusedTower, towers, waves, setTowers,
    spawnedThisWave, totalEnemiesInWave, totalKilled, totalLeaked, isIntermission, waveStartCountdown, intermissionTime, handleStartNextWaveNow, lastUpgradedTowerId,
    justPlacedTowerId,
    isCoop, playerRole, handleLoadTestLayout, handleLoadAllTowersLayout, isCheating, cheat_addResources, cheat_skipWaves, cheat_heal,
    cheat_unlockAll,
    firingTowerIds,
    allTowers,
    attacks,
    onPing,
    isWsConnected,
    hostPacketsPerSecond,
    hostBytesSentPerSecond,
    clientPacketsPerSecond,
    clientBytesReceivedPerSecond,
    averagePacketSize,
    isPlacingPortalEntrance,
    gameMode = 'coop',
    onSendEnemy = () => {}
  } = props;

  const [isBuildSheetOpen, setIsBuildSheetOpen] = useState(false);

  useEffect(() => {
    const reset = () => gameBoardRef.current?.resetView();
    // Reset view initially and also after a tiny delay to ensure container has its final dimensions
    reset();
    const id = setTimeout(reset, 50);

    window.addEventListener('orientationchange', reset);
    window.addEventListener('resize', reset);
    
    return () => {
      clearTimeout(id);
      window.removeEventListener('orientationchange', reset);
      window.removeEventListener('resize', reset);
    };
  }, [gameBoardRef]);

  useEffect(() => {
    if (!isBuildSheetOpen) {
      const id = setTimeout(() => gameBoardRef.current?.resetView(), 50);
      return () => clearTimeout(id);
    }
  }, [isBuildSheetOpen, gameBoardRef]);
  
  // Bug fix: When a tower is focused, open the build/upgrade sheet automatically
  useEffect(() => {
    if (focusedTower && !selectedTowerToBuild) {
      setIsBuildSheetOpen(true);
    }
  }, [focusedTower, selectedTowerToBuild]);


  const isSpectator = playerRole === 'spectator';
  const isHost = playerRole === 'player1';
  const showNextWaveButton = (isIntermission && gameStatus === 'playing') || gameStatus === 'waiting';
  const canStartWave = !isSpectator && (!isCoop || isHost);

  const showDebugFeatures = isCheating || isCoop;
  
  const auraTowers = React.useMemo(() => placedTowers.filter(t => t.effects?.some(e => e.type === 'aura')), [placedTowers]);
  const buffedTowerIds = React.useMemo(() => {
    const ids = new Set<string>();
    if (auraTowers.length === 0) return ids;
    
    placedTowers.forEach(tower => {
      if (tower.effects?.some(e => e.type === 'aura')) return;
      for (const auraTower of auraTowers) {
        const distSq = Math.pow(tower.position.col - auraTower.position.col, 2) + Math.pow(tower.position.row - auraTower.position.row, 2);
        if (distSq <= Math.pow(auraTower.range, 2)) {
          ids.add(tower.id);
          break;
        }
      }
    });
    return ids;
  }, [placedTowers, auraTowers]);

  const sheetTitle = isSpectator
    ? 'Zuschauer'
    : (focusedTower ? `Upgrade ${focusedTower.name}` : 'Turm bauen');
  const sheetIcon = isSpectator ? <Eye /> : <Hammer />;

  const handleSelectAndClose = (tower: Tower | null) => {
    onSelectTowerToBuild(tower);
    setIsBuildSheetOpen(false);
  };
  
  const handleSell = () => {
    handleSellTower();
    setIsBuildSheetOpen(false);
  };
  
  const getAvailableUpgrades = useCallback((tower: PlacedTower) => {
    if (!tower.upgradesTo?.length || !localPlayer) return [];
    
    const unlockedElements = new Set(localPlayer.unlockedElements);
    const resources = Math.floor(localPlayer.resources);
    const refund = Math.floor(tower.cost * 0.75);

    return tower.upgradesTo
      .map(id => allTowers.find(t => t.id === id))
      .filter((t): t is Tower => !!t)
      .filter(t => 
        hasAllElements(unlockedElements, t.elements) && 
        (t.cost - refund) <= resources
      );
  }, [localPlayer, allTowers]);

  const handleUpgrade = (upgradeId: string) => {
    handleUpgradeTower(upgradeId);
    // Decision to close sheet is handled by the effect below
  };

  useEffect(() => {
    if (!lastUpgradedTowerId || !focusedTower) return;
    
    // Check upgrades for the *newly focused* tower
    if (focusedTower.id === lastUpgradedTowerId) {
        const availableNext = getAvailableUpgrades(focusedTower);
        if (availableNext.length === 0) {
            setIsBuildSheetOpen(false);
        }
    }
  }, [lastUpgradedTowerId, focusedTower, getAvailableUpgrades]);


  const handleFocusTower = (tower: PlacedTower) => {
    if (selectedTowerToBuild) {
      cancelInteractions();
    }
    onFocusTower(tower);
    setIsBuildSheetOpen(true);
  };
  
  const isBossWaveNext = isIntermission && (currentWave + 1) > 0 && (currentWave + 1) % 10 === 0;

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-950">
      {/* GAME AREA */}
      <div
        id="tutorial-game-board"
        className="relative w-full flex-1 min-h-0 overflow-hidden"
      >
        {isBossWaveNext && (
            <div className="boss-announcement">
                <h2 className="boss-announcement-text">BOSS-WELLE NÄHERT SICH!</h2>
            </div>
        )}
        <GameBoard
          ref={gameBoardRef}
          placedTowers={placedTowers}
          enemies={enemies}
          workers={workers}
          ghosts={ghosts}
          portals={portals}
          attacks={attacks}
          damageNumbers={damageNumbers}
          splashRings={splashRings}
          persistentClouds={persistentClouds}
          currentPath={currentPath}
          handlePlaceTower={handlePlaceTower}
          onFocusTower={handleFocusTower} // Use the new handler
          cancelInteractions={cancelInteractions}
          selectedTowerToBuild={selectedTowerToBuild}
          portalEntrance={portalEntrance}
          isPlacingPortalEntrance={isPlacingPortalEntrance}
          focusedTower={focusedTower}
          lastUpgradedTowerId={lastUpgradedTowerId}
          justPlacedTowerId={justPlacedTowerId}
          isCoop={isCoop}
          playerRole={playerRole}
          firingTowerIds={firingTowerIds}
          onUpgradeTower={handleUpgradeTower}
          onSellTower={handleSellTower}
          allTowers={allTowers}
          localPlayer={localPlayer}
          onPing={onPing}
        >
          {/* TOP OVERLAYS */}
          <div
            id="tutorial-player-stats"
            className="pointer-events-none absolute left-2 right-2 top-2 z-40 flex gap-2 landscape:right-auto landscape:w-[17rem]"
          >
            {players.map((player) => player && (
              <div
                key={player.id}
                className={`min-w-0 flex-1 rounded-xl border px-2.5 py-2 shadow-lg backdrop-blur-md ${
                  player.id === localPlayer.id
                    ? 'border-cyan-300/30 bg-slate-950/80'
                    : 'border-white/10 bg-slate-950/70'
                }`}
              >
                <div className="mb-1 flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-slate-100">
                  {player.avatarUrl ? (
                    <img src={player.avatarUrl} alt="" className="h-4 w-4 rounded-full" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.8)]" />
                  )}
                  <span className="truncate">{player.name || 'Spieler'}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
                  <span className="flex items-center gap-1 text-yellow-300"><Coins className="h-3.5 w-3.5" />{player.id === 'spectator' ? '---' : Math.floor(player.resources)}</span>
                  <span className="flex items-center gap-1 text-rose-400"><Heart className="h-3.5 w-3.5" />{gameState.lives}</span>
                  <span className="flex items-center gap-1 text-emerald-300"><TrendingUp className="h-3.5 w-3.5" />+{player.incomePerSecond}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="pointer-events-none absolute top-[4.5rem] left-1/2 -translate-x-1/2 z-40 w-[92%] max-w-sm space-y-2 landscape:left-auto landscape:right-2 landscape:top-2 landscape:w-[19rem] landscape:translate-x-0">
            {showNextWaveButton && (
              <div id="tutorial-start-wave-button" className="pointer-events-auto">
                <WaveStartTimer countdown={waveStartCountdown} totalTime={intermissionTime} onStartWave={handleStartNextWaveNow} canStartWave={canStartWave}/>
              </div>
            )}
          </div>

          <div className="pointer-events-none absolute bottom-3 left-3 right-14 z-40 landscape:right-auto landscape:w-[17rem]">
            <div className="flex min-h-9 items-center gap-2 rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-[11px] font-medium text-slate-200 shadow-lg backdrop-blur-md">
              {selectedTowerToBuild || focusedTower || isPlacingPortalEntrance ? (
                <MessageCircle className="h-4 w-4 flex-shrink-0 text-cyan-300" />
              ) : (
                <Move className="h-4 w-4 flex-shrink-0 text-cyan-300" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {selectedTowerToBuild || focusedTower || isPlacingPortalEntrance
                  ? interactionPrompt
                  : 'Tippen: wählen · Ziehen: bewegen · 2 Finger: zoomen'}
              </span>
              {!selectedTowerToBuild && !focusedTower && !isPlacingPortalEntrance && <ZoomIn className="h-4 w-4 flex-shrink-0 text-slate-400" />}
              {(selectedTowerToBuild || focusedTower || isPlacingPortalEntrance) && !isSpectator && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={cancelInteractions}
                  className="pointer-events-auto h-7 w-7 flex-shrink-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

        </GameBoard>
      </div>

      {/* BOTTOM BAR */}
      <footer
        className="z-50 flex-shrink-0 border-t border-white/10 bg-slate-950/90 shadow-[0_-16px_40px_-24px_rgba(34,211,238,0.45)] backdrop-blur-xl"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0)' }}
      >
<div
  className="w-full p-2 px-[max(env(safe-area-inset-left),0px)] pr-[max(env(safe-area-inset-right),0px)]"
>
          <div className="grid grid-cols-3 gap-2">
            {/* Build / Upgrade Sheet */}
            <Sheet open={isBuildSheetOpen} onOpenChange={setIsBuildSheetOpen}>
              <SheetTrigger asChild>
                <Button
                  id="tutorial-build-menu"
                  variant="outline"
                  className="h-14 rounded-xl border-white/10 bg-white/[0.04] flex flex-col justify-center"
                  disabled={gameStatus === 'picking-element' || isSpectator}
                >
                  {sheetIcon}
                  <span className="text-[11px] mt-1">{sheetTitle}</span>
                </Button>
              </SheetTrigger>

              <SheetContent side="bottom" className="rounded-t-2xl h-[75svh] max-h-[75svh] p-0 flex flex-col">
                <div className="flex-shrink-0 sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b px-4 pt-2 pb-3 rounded-t-2xl">
                  <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-muted" />

                  <SheetHeader className="items-center flex-row justify-between">
                    <SheetTitle>{sheetTitle}</SheetTitle>
                    {!isSpectator && localPlayer && (
                        <div className="flex items-center gap-2 text-yellow-400 font-semibold text-lg bg-background/50 border rounded-md px-3 py-1">
                            <Coins className="h-5 w-5" />
                            <span>{Math.floor(localPlayer.resources)}</span>
                        </div>
                    )}
                  </SheetHeader>
                </div>
                <div className="flex-grow min-h-0">
                  <ScrollArea className="h-full px-4 py-4">
                    {!isSpectator && (
                      <TowerSelection
                        allTowers={allTowers}
                        onSelectTower={handleSelectAndClose}
                        onEnterPortalMode={() => {
                            onEnterPortalMode();
                            setIsBuildSheetOpen(false);
                        }}
                        focusedTower={focusedTower}
                        selectedTowerToBuild={selectedTowerToBuild}
                        onUpgradeTower={handleUpgrade}
                        onSellTower={handleSell}
                        onBack={cancelInteractions}
                        localPlayer={localPlayer}
                        isMobile
                        buffedTowerIds={buffedTowerIds}
                        currentWave={currentWave}
                        gameMode={gameMode}
                        onSendEnemy={onSendEnemy}
                      />
                    )}
                  </ScrollArea>
                </div>
              </SheetContent>
            </Sheet>

            {/* Play/Pause */}
            <Button
              onClick={handleGameControl}
              variant="outline"
              className="h-14 rounded-xl border-white/10 bg-white/[0.04] flex flex-col justify-center"
              disabled={
                gameStatus === 'gameover' ||
                gameStatus === 'picking-element' ||
                (gameStatus === 'waiting' && !isHost) ||
                isSpectator
              }
            >
              {gameStatus === 'playing' ? <Pause /> : <Play />}
              <span className="text-[12px] leading-4 mt-1">

                {gameStatus === 'playing' ? 'Pause' : (gameStatus === 'waiting' && !isHost ? 'Wartet...' : 'Weiter')}
              </span>
            </Button>

            {/* Extra / Debug Sheet */}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" className="h-14 rounded-xl border-white/10 bg-white/[0.04] flex flex-col justify-center" id="tutorial-wave-tracker">
                  <ChevronsUpDown />
                  <span className="text-[11px] mt-1">Menü</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="rounded-t-2xl h-[80svh] max-h-[80svh] p-0">
                <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b px-4 py-3 rounded-t-2xl">
                  <SheetHeader className="items-start">
                    <SheetTitle>Zusatzmenü</SheetTitle>
                  </SheetHeader>
                </div>

                <Tabs defaultValue="main" className="w-full h-full flex flex-col">
                  <div className="px-4 pt-3">
                    <TabsList className={`grid w-full ${showDebugFeatures ? 'grid-cols-2' : 'grid-cols-1'}`}>
                      <TabsTrigger value="main">Menü</TabsTrigger>
                      {showDebugFeatures && <TabsTrigger value="debug">
                        {isCoop ? <Bug className="h-4 w-4 mr-2"/> : <Sparkles className="h-4 w-4 mr-2"/>}
                        {isCoop ? 'Diagnose' : 'Chaos'}
                      </TabsTrigger>}
                    </TabsList>
                  </div>

                  <TabsContent value="main" className="flex-1 min-h-0">
                     <ScrollArea className="h-full px-4 py-4">
                        <div className="space-y-4">
                          <Button variant="outline" className="w-full" onClick={() => gameBoardRef.current?.resetView()}>
                            <RefreshCcw className="mr-2 h-4 w-4" />
                            Ansicht zurücksetzen
                          </Button>
                          <Separator />
                          <WaveTracker currentWave={currentWave} totalWaves={totalWaves} isCompact />
                          <WavePreview currentWave={currentWave} waves={waves} isCompact />
                          <GameStatsTracker
                            spawnedThisWave={spawnedThisWave}
                            totalEnemiesInWave={totalEnemiesInWave}
                            totalKilled={totalKilled}
                            totalLeaked={totalLeaked}
                            isCompact
                          />
                          <Button onClick={resetGame} variant="destructive" size="lg" className="w-full h-12">
                            <LogOut className="mr-2" />
                            <span>{isSpectator ? 'Lobby verlassen' : 'Spiel verlassen'}</span>
                          </Button>
                        </div>
                     </ScrollArea>
                  </TabsContent>

                  {showDebugFeatures && <TabsContent value="debug" className="flex-1 min-h-0 px-4 py-4">
                    <ScrollArea className="h-full pr-2">
                      <DebugMenu
                        towers={towers}
                        setTowers={setTowers}
                        cheat_unlockAll={cheat_unlockAll}
                        setPlayers={setPlayers}
                        onLoadTestLayout={handleLoadTestLayout}
                        onLoadAllTowersLayout={handleLoadAllTowersLayout}
                        isCheating={isCheating}
                        cheat_addResources={cheat_addResources}
                        cheat_skipWaves={cheat_skipWaves}
                        cheat_heal={cheat_heal}
                        isCoop={isCoop}
                        isWsConnected={isWsConnected}
                        hostPacketsPerSecond={hostPacketsPerSecond}
                        clientPacketsPerSecond={clientPacketsPerSecond}
                        averagePacketSize={averagePacketSize}
                        hostBytesSentPerSecond={hostBytesSentPerSecond}
                        clientBytesReceivedPerSecond={clientBytesReceivedPerSecond}
                      />
                    </ScrollArea>
                  </TabsContent>}
                </Tabs>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </footer>
    </div>
  );
});
