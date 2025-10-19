

import React, {useRef, useEffect} from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pause, Play, LogOut, MessageCircle, X } from 'lucide-react';
import PlayerStats from '@/components/game/player-stats';
import WaveTracker from '@/components/game/wave-tracker';
import GameStatsTracker from '@/components/game/game-stats-tracker';
import DebugMenu from '@/components/game/debug-menu';
import GameBoard, { type GameBoardHandle } from '@/components/game/game-board';
import TowerSelection from '@/components/game/tower-selection';
import WaveStartTimer from '@/components/game/wave-start-timer';
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
  damageNumbers: DamageNumber[];
  splashRings: SplashRing[];
  currentPath: Node[];
  handlePlaceTower: (row: number, col: number) => void;
  onFocusTower: (tower: PlacedTower) => void;
  selectedTowerToBuild: Tower | null;
  focusedTower: PlacedTower | null;
  gameBoardRef: React.RefObject<GameBoardHandle>;
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
  attacks?: Attack[];
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
    resetGame, towers, setTowers, placedTowers, enemies, damageNumbers, splashRings,
    currentPath, handlePlaceTower, onFocusTower, selectedTowerToBuild, focusedTower,
    gameBoardRef, interactionPrompt, cancelInteractions,
    onSelectTowerToBuild, handleUpgradeTower, handleSellTower,
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
    attacks,
    isWsConnected,
    hostPacketsPerSecond,
    hostBytesSentPerSecond,
    clientPacketsPerSecond,
    clientBytesReceivedPerSecond,
    averagePacketSize,
  } = props;
  
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reset = () => gameBoardRef.current?.resetView();
    reset();

    const ro = new ResizeObserver(() => reset());
    if (wrapRef.current) ro.observe(wrapRef.current);

    const onWin = () => reset();
    window.addEventListener('resize', onWin);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onWin);
    };
  }, [gameBoardRef]);


  const isSpectator = playerRole === 'spectator';
  const isHost = playerRole === 'player1';
  const showNextWaveButton = isIntermission && gameStatus === 'playing';
  const canStartWave = !isSpectator && (!isCoop || isHost);
  
  const maxLives = difficultyModifiers[difficulty].startLives;
  const showDebugFeatures = isCheating || isCoop;


  const interactionPromptComponent = (
    <>
    {interactionPrompt && !focusedTower && (
        <div className="bg-card/80 backdrop-blur-sm border rounded-lg p-2 flex items-center gap-2 shadow-lg">
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

  return (
    <div className="grid grid-cols-[320px_1fr_320px] gap-6 max-w-screen-2xl mx-auto h-full">
      {/* Left Sidebar */}
      <aside className="flex flex-col gap-4">
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
      </aside>

      {/* Main Game Area */}
      <div className="flex-grow flex items-center justify-center h-full">
         <div
            id="tutorial-game-board"
            ref={wrapRef}
            className="relative"
            style={{
                width:  'min(calc(100vw - 640px - 3rem), 90svh)',
                height: 'min(calc(100vw - 640px - 3rem), 90svh)',
            }}
        >
            <GameBoard
                ref={gameBoardRef}
                placedTowers={placedTowers}
                enemies={enemies}
                attacks={attacks || []}
                damageNumbers={damageNumbers}
                splashRings={splashRings}
                currentPath={currentPath}
                handlePlaceTower={handlePlaceTower}
                onFocusTower={onFocusTower}
                cancelInteractions={cancelInteractions}
                selectedTowerToBuild={selectedTowerToBuild}
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
            />
        </div>
      </div>

      {/* Right Sidebar */}
      <aside className="flex flex-col gap-4">
        <div id="tutorial-build-menu">
            {!isSpectator && (
              <TowerSelection
                allTowers={allTowers}
                onSelectTower={onSelectTowerToBuild}
                focusedTower={focusedTower}
                selectedTowerToBuild={selectedTowerToBuild}
                onUpgradeTower={handleUpgradeTower}
                onSellTower={handleSellTower}
                onBack={cancelInteractions}
                localPlayer={localPlayer}
              />
            )}
        </div>
        {showDebugFeatures && (
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
        )}
      </aside>
    </div>
  );
});