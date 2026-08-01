

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
import type { Tower, Wave, PlacedTower, Enemy, Node, Element, Player, GameState, Attack, DamageNumber, SplashRing, Difficulty, PingKind, PersistentCloud, Worker, GhostFoundation, Portal } from '@/lib/game-data/types';
import { difficultyModifiers, INTERMISSION_TIME } from '@/lib/game-data/constants';


type GameStatus = 'waiting' | 'playing' | 'paused' | 'gameover' | 'picking-element' | 'tutorial';

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
  waves: Wave[];
  setTowers: React.Dispatch<React.SetStateAction<Tower[]>>;
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
  onSelectTowerToBuild: (tower: Tower | null) => void;
  onEnterPortalMode: () => void;
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
  onPing?: (kind: PingKind, row: number, col: number, msg?: string) => void;
  isPlacingPortalEntrance?: boolean;
  gameMode?: 'coop' | 'versus';
  onSendEnemy?: (payload: { type: any; cost: number; incomeBonus: number }) => void;
}

export const DesktopLayout = React.memo(function DesktopLayout(props: DesktopLayoutProps) {
  const {
    players, setPlayers, gameState, localPlayer, currentWave, totalWaves, difficulty, handleGameControl, gameStatus,
    resetGame, towers, waves, setTowers, placedTowers, enemies, workers, ghosts, portals, damageNumbers, splashRings,
    persistentClouds,
    currentPath, handlePlaceTower, onFocusTower, selectedTowerToBuild, portalEntrance, focusedTower,
    gameBoardRef, interactionPrompt, cancelInteractions,
    onSelectTowerToBuild, onEnterPortalMode, handleUpgradeTower, handleSellTower,
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
  const showNextWaveButton = (isIntermission && gameStatus === 'playing') || gameStatus === 'waiting';
  const canStartWave = !isSpectator && (!isCoop || isHost);
  
  const maxLives = difficultyModifiers[difficulty].startLives;
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


  const interactionPromptComponent = (
    <>
    {interactionPrompt && !focusedTower && (
        <div className="bg-card/80 backdrop-blur-sm border rounded-lg p-2 flex items-center gap-2 shadow-lg">
            <MessageCircle className="h-5 w-5 text-accent"/>
            <p className="text-sm font-medium flex-grow">
            {interactionPrompt}
            </p>
            {(selectedTowerToBuild || focusedTower || isPlacingPortalEntrance) && !isSpectator && (
            <Button variant="ghost" size="icon" onClick={cancelInteractions} className="h-7 w-7">
                <X className="h-4 w-4" />
            </Button>
            )}
        </div>
        )}
    </>
  );

  const isBossWaveNext = isIntermission && (currentWave + 1) > 0 && (currentWave + 1) % 10 === 0;

  return (
    <div className="grid h-full min-h-0 max-w-[1600px] grid-cols-[clamp(240px,20vw,300px)_minmax(0,1fr)_clamp(240px,20vw,300px)] gap-3 mx-auto overflow-hidden">
      {/* Left Sidebar */}
      <aside className="flex min-h-0 flex-col gap-3 pointer-events-auto p-3 bg-gradient-to-r from-background/95 via-background/80 to-transparent backdrop-blur-md border-r border-border/50 overflow-y-auto">
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
         <Card className="p-3">
          <div className="grid grid-cols-2 gap-2">
             <Button className="w-full px-2" onClick={handleGameControl} variant="outline" disabled={gameStatus === 'gameover' || gameStatus === 'picking-element' || (gameStatus === 'waiting' && !isHost) || isSpectator}>
              {gameStatus === 'playing' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              <span className="ml-1.5">{gameStatus === 'playing' ? 'Pause' : (gameStatus === 'waiting' && !isHost ? 'Wartet...' : 'Weiter')}</span>
            </Button>
            <Button className="w-full px-2" onClick={resetGame} variant="destructive">
              <LogOut className="h-4 w-4" />
              <span className="ml-1.5">{isSpectator ? 'Verlassen' : (isCoop ? 'Verlassen' : 'Reset')}</span>
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
            <div className="flex min-h-0 min-w-0 items-center justify-center h-full p-1">
         <div
            id="tutorial-game-board"
            ref={wrapRef}
            className="relative aspect-square overflow-hidden rounded-2xl border border-cyan-300/20 bg-slate-950 shadow-[0_24px_80px_-28px_rgba(34,211,238,0.45)]"
            style={{
                width: 'min(100%, calc(100svh - 5rem))',
                maxHeight: '100%',
            }}
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
                onFocusTower={onFocusTower}
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
            />
        </div>
      </div>

      {/* Right Sidebar */}
      <aside className="flex min-h-0 flex-col gap-3 pointer-events-auto p-3 bg-gradient-to-l from-background/95 via-background/80 to-transparent backdrop-blur-md border-l border-border/50 overflow-y-auto">
      <div id="tutorial-build-menu">
            {!isSpectator && (
              <TowerSelection
                allTowers={allTowers}
                onSelectTower={onSelectTowerToBuild}
                onEnterPortalMode={onEnterPortalMode}
                focusedTower={focusedTower}
                selectedTowerToBuild={selectedTowerToBuild}
                onUpgradeTower={handleUpgradeTower}
                onSellTower={handleSellTower}
                onBack={cancelInteractions}
                localPlayer={localPlayer}
                buffedTowerIds={buffedTowerIds}
                currentWave={currentWave}
                gameMode={gameMode}
                onSendEnemy={onSendEnemy}
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
