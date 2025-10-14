

import React, { useState, memo, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Pause, Play, LogOut, Hammer, ArrowUpCircle, ChevronsUpDown, Bug, X, MessageCircle, Eye, RefreshCcw, Coins, Sparkles, Microscope, Bot } from 'lucide-react';
import PlayerStats from '@/components/game/player-stats';
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
  Tower, PlacedTower, Enemy, Node, Player, GameState,
  Attack, DamageNumber, SplashRing, Difficulty, WorkerState
} from '@/lib/game-data/types';
import { waves } from '@/lib/game-data/enemies';
import { difficultyModifiers, INTERMISSION_TIME } from '@/lib/game-data/constants';

type GameStatus = 'waiting' | 'playing' | 'paused' | 'gameover' | 'picking-element';

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
  attacks: Attack[];
  damageNumbers: DamageNumber[];
  splashRings: SplashRing[];
  currentPath: Node[];
  handlePlaceTower: (row: number, col: number) => void;
  onFocusTower: (tower: PlacedTower) => void;
  selectedTowerToBuild: Tower | null;
  focusedTower: PlacedTower | null;
  rows: number;
  cols: number;
  startNode: Node;
  endNode: Node;
  interactionPrompt: string | null;
  cancelInteractions: () => void;
  handleGameControl: () => void;
  gameStatus: GameStatus;
  resetGame: () => void;
  onSelectTowerToBuild: (tower: Tower) => void;
  handleUpgradeTower: (upgradeId: string) => void;
  handleSellTower: () => void;
  setFocusedTower: (tower: PlacedTower | null) => void;
  towers: Tower[];
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
  isCoop: boolean;
  playerRole: 'player1' | 'player2' | 'spectator' | null;
  handleLoadTestLayout: () => void;
  handleLoadAllTowersLayout: () => void;
  isCheating: boolean;
  cheat_addResources?: () => void;
  cheat_skipWaves?: () => void;
  cheat_heal?: () => void;
  cheat_unlockAll: () => void;
  cheat_nudgeEnemy: () => void;
  firingTowerIds: Set<string>;
  workerState: WorkerState;
    // Network Stats
  isWsConnected?: boolean;
  hostPacketsPerSecond?: number;
  hostBytesSentPerSecond?: number;
  clientPacketsPerSecond?: number;
  clientBytesReceivedPerSecond?: number;
  averagePacketSize?: number;
}

export const MobileLayout = memo(function MobileLayout(props: MobileLayoutProps) {
  const {
    players, setPlayers, gameState, localPlayer, currentWave, totalWaves, difficulty, placedTowers, enemies, attacks,
    damageNumbers, splashRings, currentPath, handlePlaceTower, onFocusTower, selectedTowerToBuild,
    focusedTower, rows, cols, startNode, endNode, interactionPrompt,
    cancelInteractions, handleGameControl, gameStatus, resetGame,
    onSelectTowerToBuild, handleUpgradeTower, handleSellTower, setFocusedTower, towers, setTowers,
    spawnedThisWave, totalEnemiesInWave, totalKilled, totalLeaked, isIntermission, waveStartCountdown, intermissionTime, handleStartNextWaveNow, lastUpgradedTowerId,
    isCoop, playerRole, handleLoadTestLayout, handleLoadAllTowersLayout, isCheating, cheat_addResources, cheat_skipWaves, cheat_heal,
    cheat_unlockAll, cheat_nudgeEnemy,
    firingTowerIds,
    workerState,
    isWsConnected,
    hostPacketsPerSecond,
    hostBytesSentPerSecond,
    clientPacketsPerSecond,
    clientBytesReceivedPerSecond,
    averagePacketSize,
  } = props;

  const [isBuildSheetOpen, setIsBuildSheetOpen] = useState(false);
  const gameBoardRef = useRef<GameBoardHandle>(null);

  const isSpectator = playerRole === 'spectator';
  const isHost = playerRole === 'player1';
  const showNextWaveButton = isIntermission && gameStatus === 'playing';
  const canStartWave = !isSpectator && (!isCoop || isHost);

  const maxLives = difficultyModifiers[difficulty].startLives;
  const showDebugFeatures = isCheating || isCoop;

  const sheetTitle = isSpectator
    ? 'Zuschauer'
    : (focusedTower ? `Upgrade ${focusedTower.name}` : (selectedTowerToBuild ? 'Turm bauen' : 'Turm-Menü'));
  const sheetIcon = isSpectator ? <Eye /> : (focusedTower ? <ArrowUpCircle /> : <Hammer />);

  const handleSelectAndClose = (tower: Tower) => {
    onSelectTowerToBuild(tower);
    setIsBuildSheetOpen(false);
  };
  const handleSellAndClose = () => {
    handleSellTower();
    setIsBuildSheetOpen(false);
  };

  return (
    <div className="w-full h-[calc(100svh-133px)] flex flex-col">
      {/* GAME AREA */}
      <div
        className="relative w-full overflow-hidden flex-grow"
      >
        <GameBoard
          ref={gameBoardRef}
          placedTowers={placedTowers}
          enemies={enemies}
          attacks={attacks}
          damageNumbers={damageNumbers}
          splashRings={splashRings}
          currentPath={currentPath}
          handlePlaceTower={handlePlaceTower}
          onFocusTower={onFocusTower}
          cancelInteractions={cancelInteractions}
          selectedTowerToBuild={selectedTowerToBuild}
          focusedTower={focusedTower}
          rows={rows}
          cols={cols}
          startNode={startNode}
          endNode={endNode}
          lastUpgradedTowerId={lastUpgradedTowerId}
          isCoop={isCoop}
          playerRole={playerRole}
          firingTowerIds={firingTowerIds}
          workerState={workerState}
        >
          {/* TOP OVERLAYS */}
          <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 z-40 w-[92%] max-w-sm space-y-2">
            {showNextWaveButton && (
              <div className="pointer-events-auto">
                <WaveStartTimer countdown={waveStartCountdown} totalTime={intermissionTime} onStartWave={handleStartNextWaveNow} canStartWave={canStartWave}/>
              </div>
            )}
          </div>

        </GameBoard>
      </div>

      {/* BOTTOM BAR */}
      <div
        className="flex-shrink-0 border-t bg-card/80 backdrop-blur-sm"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}
      >
        <div className="mx-auto w-full max-w-md p-2 space-y-2">
          {/* PROMPT - Moved here */}
          {interactionPrompt && (
            <div className="bg-card/90 backdrop-blur-sm border rounded-lg p-2 flex items-center gap-2 shadow-md">
                <MessageCircle className="h-5 w-5 text-accent flex-shrink-0" />
                <p className="text-xs font-medium truncate flex-grow">{interactionPrompt}</p>
                {(selectedTowerToBuild || focusedTower) && !isSpectator && (
                <Button variant="ghost" size="icon" onClick={cancelInteractions} className="h-7 w-7">
                    <X className="h-4 w-4" />
                </Button>
                )}
            </div>
           )}

           {/* PLAYER BAR */}
           <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {players.map((p) => p && (
              <div key={p.id} className="min-w-0">
                <PlayerStats
                  player={p}
                  lives={gameState.lives}
                  maxLives={maxLives}
                  isCompact
                  isLocalPlayer={p.id === localPlayer.id}
                  isCoop={isCoop}
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {/* Build / Upgrade Sheet */}
            <Sheet open={isBuildSheetOpen} onOpenChange={setIsBuildSheetOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  className="h-14 flex flex-col justify-center"
                  disabled={gameStatus === 'picking-element' || isSpectator}
                >
                  {sheetIcon}
                  <span className="text-[11px] mt-1">{sheetTitle}</span>
                </Button>
              </SheetTrigger>

              <SheetContent side="bottom" className="rounded-t-2xl h-[80svh] max-h-[80svh] p-0">
                <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b px-4 py-3 rounded-t-2xl">
                  <SheetHeader className="items-center flex-row justify-between">
                    <SheetTitle>{sheetTitle}</SheetTitle>
                    {!isSpectator && localPlayer && (
                        <div className="flex items-center gap-2 text-yellow-400 font-semibold text-lg bg-background/50 border rounded-md px-3 py-1">
                            <Coins className="h-5 w-5" />
                            <span>{localPlayer.resources}</span>
                        </div>
                    )}
                  </SheetHeader>
                </div>
                <div className="px-4 py-4">
                  {!isSpectator && (
                    <TowerSelection
                      allTowers={towers}
                      onSelectTower={handleSelectAndClose}
                      focusedTower={focusedTower}
                      selectedTowerToBuild={selectedTowerToBuild}
                      onUpgradeTower={handleUpgradeTower}
                      onSellTower={handleSellAndClose}
                      onBack={cancelInteractions}
                      localPlayer={localPlayer}
                      isMobile
                    />
                  )}
                </div>
              </SheetContent>
            </Sheet>

            {/* Play/Pause */}
            <Button
              onClick={handleGameControl}
              variant="outline"
              className="h-14 flex flex-col justify-center"
              disabled={
                gameStatus === 'gameover' ||
                gameStatus === 'picking-element' ||
                (gameStatus === 'waiting' && !isHost) ||
                isSpectator
              }
            >
              {gameStatus === 'playing' ? <Pause /> : <Play />}
              <span className="text-[11px] mt-1">
                {gameStatus === 'playing' ? 'Pause' : gameStatus === 'waiting' ? 'Start' : 'Weiter'}
              </span>
            </Button>

            {/* Extra / Debug Sheet */}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" className="h-14 flex flex-col justify-center">
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

                  <TabsContent value="main" className="flex-1 min-h-0 px-4 py-4">
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
                        cheat_nudgeEnemy={cheat_nudgeEnemy}
                        isCoop={isCoop}
                        isWsConnected={isWsConnected}
                        hostPacketsPerSecond={hostPacketsPerSecond}
                        hostBytesSentPerSecond={hostBytesSentPerSecond}
                        clientPacketsPerSecond={clientPacketsPerSecond}
                        clientBytesReceivedPerSecond={clientBytesReceivedPerSecond}
                        averagePacketSize={averagePacketSize}
                      />
                    </ScrollArea>
                  </TabsContent>}
                </Tabs>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </div>
  );
});
