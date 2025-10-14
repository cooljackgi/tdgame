

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pause, Play, LogOut, Swords, Zap, MessageCircle, Bug, Sparkles, Microscope, X } from 'lucide-react';
import PlayerStats from '@/components/game/player-stats';
import WaveTracker from '@/components/game/wave-tracker';
import GameStatsTracker from '@/components/game/game-stats-tracker';
import DebugMenu from '@/components/game/debug-menu';
import GameBoard, { type GameBoardHandle } from '@/components/game/game-board';
import TowerSelection from '@/components/game/tower-selection';
import WaveStartTimer from '@/components/game/wave-start-timer';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import WavePreview from '@/components/game/wave-preview';

// Import types from page.tsx or a shared types file
import type { Tower, PlacedTower, Enemy, Node, Element, Player, GameState, Attack, DamageNumber, SplashRing, Difficulty } from '@/lib/game-data/types';
import { waves } from '@/lib/game-data/enemies';
import { difficultyModifiers, INTERMISSION_TIME } from '@/lib/game-data/constants';


type GameStatus = 'waiting' | 'playing' | 'paused' | 'gameover' | 'picking-element';

interface DesktopLayoutProps {
  players: Player[];
  setPlayers: React.Dispatch<React.SetStateAction<Player[]>>;
  gameState: GameState;
  localPlayer: Player;
  currentWave: number;
  totalWaves: number;
  difficulty: Difficulty;
  handleGameControl: () => void;
  gameStatus: GameStatus;
  resetGame: () => void;
  towers: Tower[];
  setTowers: React.Dispatch<React.SetStateAction<Tower[]>>;
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
  onSelectTowerToBuild: (tower: Tower | null) => void;
  handleUpgradeTower: (upgradeId: string) => void;
  handleSellTower: () => void;
  setFocusedTower: (tower: PlacedTower | null) => void;
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
  // Network Stats
  isWsConnected?: boolean;
  hostPacketsPerSecond?: number;
  hostBytesSentPerSecond?: number;
  clientPacketsPerSecond?: number;
  clientBytesReceivedPerSecond?: number;
  averagePacketSize?: number;
}

export const DesktopLayout = React.memo(function DesktopLayout(props: DesktopLayoutProps) {
  const {
    players, setPlayers, gameState, localPlayer, currentWave, totalWaves, difficulty, handleGameControl, gameStatus,
    resetGame, towers, setTowers, placedTowers, enemies, attacks, damageNumbers, splashRings,
    currentPath, handlePlaceTower, onFocusTower, selectedTowerToBuild, focusedTower,
    rows, cols, startNode, endNode, interactionPrompt, cancelInteractions,
    onSelectTowerToBuild, handleUpgradeTower, handleSellTower, setFocusedTower,
    spawnedThisWave, totalEnemiesInWave, totalKilled, totalLeaked, isIntermission, waveStartCountdown, intermissionTime, handleStartNextWaveNow, lastUpgradedTowerId,
    justPlacedTowerId,
    isCoop,
    playerRole,
    handleLoadTestLayout,
    handleLoadAllTowersLayout,
    isCheating,
    cheat_addResources,
    cheat_skipWaves,
    cheat_heal,
    cheat_unlockAll,
    firingTowerIds,
    allTowers,
    isWsConnected,
    hostPacketsPerSecond,
    hostBytesSentPerSecond,
    clientPacketsPerSecond,
    clientBytesReceivedPerSecond,
    averagePacketSize,
  } = props;

  const isSpectator = playerRole === 'spectator';
  const isHost = playerRole === 'player1';
  const showNextWaveButton = isIntermission && gameStatus === 'playing';
  const canStartWave = !isSpectator && (!isCoop || isHost);
  
  const maxLives = difficultyModifiers[difficulty].startLives;
  const gameBoardRef = React.useRef<GameBoardHandle>(null);
  const showDebugFeatures = isCheating || isCoop;


  const debugMenu = (
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
  );
  
  const interactionPromptComponent = (
    <>
    {interactionPrompt && !focusedTower && (
        <div className="bg-card/80 backdrop-blur-sm border rounded-lg p-2 flex items-center gap-2 shadow-lg mb-4">
            <MessageCircle className="h-5 w-5 text-accent"/>
            <p className="text-sm font-medium flex-grow">
            {interactionPrompt}
            </p>
            {(selectedTowerToBuild || focusedTower) && !isSpectator && (
            <Button variant="ghost" size="icon" onClick={cancelInteractions} className="h-7 w-7">
                <X className="h-4 w-4" />
            </Button>
            )}
        </div>
        )}
    </>
  );


  const combinedSidebar = (
     <Tabs defaultValue="control" className="w-full">
      <TabsList className={`grid w-full ${showDebugFeatures ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <TabsTrigger value="control"><Swords className="h-4 w-4 mr-2"/>Steuerung</TabsTrigger>
        <TabsTrigger value="build" disabled={isSpectator}><Zap className="h-4 w-4 mr-2"/>Bauen</TabsTrigger>
        {showDebugFeatures && <TabsTrigger value="debug">
            {isCoop ? <Bug className="h-4 w-4 mr-2"/> : <Sparkles className="h-4 w-4 mr-2"/>}
            {isCoop ? 'Diagnose' : 'Chaos'}
        </TabsTrigger>}
      </TabsList>
      <TabsContent value="control" className="space-y-6 mt-4">
        {interactionPromptComponent}
        <div id="tutorial-player-stats">
          {players.map(player => player && (
            <PlayerStats
              key={player.id}
              player={player}
              lives={gameState.lives}
              maxLives={maxLives}
              isLocalPlayer={player.id === localPlayer.id}
              isCoop={isCoop}
            />
          ))}
        </div>
         <Card className="p-4 space-y-2">
          <div className="flex justify-around items-center">
            <Button onClick={handleGameControl} variant="outline" size="lg" disabled={gameStatus === 'gameover' || gameStatus === 'picking-element' || (gameStatus === 'waiting' && !isHost) || isSpectator}>
              {gameStatus === 'playing' ? <Pause /> : <Play />}
              <span className="ml-2">{gameStatus === 'playing' ? 'Pause' : (gameStatus === 'waiting' ? 'Start' : 'Weiter')}</span>
            </Button>
            <Button onClick={resetGame} variant="destructive" size="lg">
              <LogOut />
              <span className="ml-2">{isSpectator ? 'Verlassen' : (isCoop ? 'Verlassen' : 'Reset')}</span>
            </Button>
          </div>
        </Card>
        <div id="tutorial-wave-tracker">
            <WaveTracker currentWave={currentWave} totalWaves={totalWaves} />
            {showNextWaveButton && <div id="tutorial-start-wave-button" className="mt-4"><WaveStartTimer countdown={waveStartCountdown} totalTime={intermissionTime} onStartWave={handleStartNextWaveNow} canStartWave={canStartWave}/></div>}
            <WavePreview currentWave={currentWave} waves={waves} />
        </div>
        <GameStatsTracker 
          spawnedThisWave={spawnedThisWave}
          totalEnemiesInWave={totalEnemiesInWave}
          totalKilled={totalKilled}
          totalLeaked={totalLeaked}
        />
        
      </TabsContent>
      <TabsContent value="build" className="mt-4" id="tutorial-build-menu">
        {!isSpectator && (
          <TowerSelection
            allTowers={towers}
            onSelectTower={onSelectTowerToBuild}
            focusedTower={focusedTower}
            selectedTowerToBuild={selectedTowerToBuild}
            onUpgradeTower={handleUpgradeTower}
            onSellTower={handleSellTower}
            onBack={cancelInteractions}
            localPlayer={localPlayer}
          />
        )}
      </TabsContent>
       {showDebugFeatures && (
        <TabsContent value="debug" className="mt-4">
          {debugMenu}
        </TabsContent>
      )}
    </Tabs>
  );


  return (
    <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] xl:grid-cols-[320px_1fr_320px] gap-6 max-w-screen-2xl mx-auto h-full">
      {/* Left Sidebar - visible on XL */}
      <aside className="hidden xl:flex xl:flex-col gap-6">
        {interactionPromptComponent}
        <div id="tutorial-player-stats-xl">
            {players.map(player => player && (
              <PlayerStats
                key={player.id}
                player={player}
                lives={gameState.lives}
                maxLives={maxLives}
                isLocalPlayer={player.id === localPlayer.id}
                isCoop={isCoop}
              />
            ))}
        </div>
         <Card className="p-4 space-y-2">
          <div className="flex justify-around items-center">
            <Button onClick={handleGameControl} variant="outline" size="lg" disabled={gameStatus === 'gameover' || gameStatus === 'picking-element' || (gameStatus === 'waiting' && !isHost) || isSpectator}>
              {gameStatus === 'playing' ? <Pause /> : <Play />}
              <span className="ml-2">{gameStatus === 'playing' ? 'Pause' : (gameStatus === 'waiting' ? 'Start' : 'Weiter')}</span>
            </Button>
            <Button onClick={resetGame} variant="destructive" size="lg">
              <LogOut />
              <span className="ml-2">{isSpectator ? 'Verlassen' : (isCoop ? 'Verlassen' : 'Reset')}</span>
            </Button>
          </div>
        </Card>
        <div id="tutorial-wave-tracker-xl">
            <WaveTracker currentWave={currentWave} totalWaves={totalWaves} />
            {showNextWaveButton && <div id="tutorial-start-wave-button-xl" className="mt-4"><WaveStartTimer countdown={waveStartCountdown} totalTime={intermissionTime} onStartWave={handleStartNextWaveNow} canStartWave={canStartWave}/></div>}
            <WavePreview currentWave={currentWave} waves={waves} />
        </div>
        <GameStatsTracker 
          spawnedThisWave={spawnedThisWave}
          totalEnemiesInWave={totalEnemiesInWave}
          totalKilled={totalKilled}
          totalLeaked={totalLeaked}
        />
        {showDebugFeatures && debugMenu}
      </aside>

      {/* Combined Sidebar - visible on MD and LG */}
      <aside className="hidden md:flex xl:hidden flex-col gap-6">
        {combinedSidebar}
      </aside>


      <div className="flex-grow flex items-center justify-center h-full">
        <div className="w-full h-full max-w-[80vh] aspect-square" id="tutorial-game-board">
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
                justPlacedTowerId={justPlacedTowerId}
                isCoop={isCoop}
                playerRole={playerRole}
                firingTowerIds={firingTowerIds}
                onUpgradeTower={handleUpgradeTower}
                onSellTower={handleSellTower}
                allTowers={allTowers}
                localPlayer={localPlayer}
            />
        </div>
      </div>

      {/* Right Sidebar - visible on XL */}
      <aside className="hidden xl:flex xl:flex-col gap-6" id="tutorial-build-menu-xl">
        {!isSpectator && (
          <TowerSelection
            allTowers={towers}
            onSelectTower={onSelectTowerToBuild}
            focusedTower={focusedTower}
            selectedTowerToBuild={selectedTowerToBuild}
            onUpgradeTower={handleUpgradeTower}
            onSellTower={handleSellTower}
            onBack={cancelInteractions}
            localPlayer={localPlayer}
          />
        )}
      </aside>
    </div>
  );
});
