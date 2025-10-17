
'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, auth, functions } from '@/lib/firebase';
import { doc, onSnapshot, Unsubscribe, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { normalizePlayers } from '@/lib/player-utils';
import type { Player, GameState, GameStatus, PlacedTower, Difficulty, Tower, Element, Enemy, Attack, DamageNumber, SplashRing } from '@/lib/game-data/types';
import { INTERMISSION_TIME, difficultyModifiers } from '@/lib/game-data/constants';
import { httpsCallable } from 'firebase/functions';
import { Loader2 } from 'lucide-react';
import { towers as initialTowers } from '@/lib/game-data/towers';
import { useWebRTC } from '@/hooks/use-webrtc';
import { findPath } from '@/lib/pathfinding';
import { useIsMobile } from '@/hooks/use-mobile';
import { DesktopLayout } from '@/components/layouts/desktop-layout';
import { MobileLayout } from '@/components/layouts/mobile-layout';
import { waves } from '@/lib/game-data/enemies';
import type { GameBoardHandle } from './game-board';
import { ElementPickDialog } from './element-pick-dialog';


export default function CoopGameLoader() {
  const { gameId } = useParams<{ gameId: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Core Game State
  const [players, setPlayers] = useState<Player[]>([]);
  const [gameState, setGameState] = useState<GameState>({ lives: 20 });
  const [towersByCell, setTowersByCell] = useState<Record<string, PlacedTower>>({});
  const [enemies, setEnemies] = useState<Enemy[]>([]);
  const [currentWave, setCurrentWave] = useState(0);
  const [gameStatus, setGameStatus] = useState<GameStatus>('waiting');
  const [isIntermission, setIsIntermission] = useState(true);
  const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);
  const [difficulty, setDifficulty] = useState<Difficulty>('Normal');
  const [localPlayerId, setLocalPlayerId] = useState<'player1' | 'player2' | 'spectator' | null>(null);
  const [gameDataLoaded, setGameDataLoaded] = useState(false);
  
  // UI State
  const [selectedTowerToBuild, setSelectedTowerToBuild] = useState<Tower | null>(null);
  const [focusedTower, setFocusedTower] = useState<PlacedTower | null>(null);
  const [justPlacedTowerId, setJustPlacedTowerId] = useState<string | null>(null);
  const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string | null>(null);
  const gameBoardRef = useRef<GameBoardHandle>(null);

  // VFX State
  const [attacks, setAttacks] = useState<Attack[]>([]);
  const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
  const [splashRings, setSplashRings] = useState<SplashRing[]>([]);
  const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());
  
  const isGameHost = useMemo(() => localPlayerId === 'player1', [localPlayerId]);
  const placedTowers = useMemo(() => Object.values(towersByCell), [towersByCell]);
  const currentPath = useMemo(() => findPath({ row: 1, col: 1 }, { row: 12, col: 12 }, placedTowers.map(t => t.position), 12, 12) || [], [placedTowers]);
  const localPlayer = useMemo(() => players.find(p => p.id === localPlayerId), [players, localPlayerId]);

  const onFocusTower = (tower: PlacedTower) => {
    setSelectedTowerToBuild(null);
    setFocusedTower(tower);
  };

  const cancelInteractions = () => {
    setSelectedTowerToBuild(null);
    setFocusedTower(null);
  };
  
  const handleGameData = useCallback((msg: any) => {
    if (isGameHost) return;
    const { type, payload } = msg;

    switch(type) {
      case 'GAME_STATE_SNAPSHOT':
        setPlayers(payload.players);
        setEnemies(payload.enemies);
        setTowersByCell(payload.towersByCell);
        setGameState(payload.gameState);
        setCurrentWave(payload.currentWave);
        setIsIntermission(payload.isIntermission);
        setWaveStartCountdown(payload.waveStartCountdown);
        setGameStatus(payload.gameStatus);
        break;
      case 'VFX_ATTACK':
        setAttacks(prev => [...prev, ...payload]);
        break;
      case 'VFX_DAMAGE_NUMBER':
        setDamageNumbers(prev => [...prev, ...payload]);
        break;
      case 'VFX_SPLASH':
        setSplashRings(prev => [...prev, ...payload]);
        break;
      case 'VFX_TOWER_FIRING':
        setFiringTowerIds(new Set(payload));
        setTimeout(() => setFiringTowerIds(new Set()), 150);
        break;
      case 'TOWER_UPGRADE_VFX':
        setLastUpgradedTowerId(payload.towerId);
        setTimeout(() => setLastUpgradedTowerId(null), 500);
        break;
    }
  }, [isGameHost]);

    const handleActionData = useCallback((msg: any) => {
        if (!isGameHost) return;

        const { type, payload } = msg;
        switch(type) {
            case 'CLIENT_READY':
                // Client is connected and ready, send them the full current game state.
                sendGameData('GAME_STATE_SNAPSHOT', {
                    players: players,
                    enemies: enemies,
                    towersByCell: towersByCell,
                    gameState: gameState,
                    currentWave: currentWave,
                    isIntermission: isIntermission,
                    waveStartCountdown: waveStartCountdown,
                    gameStatus: gameStatus,
                });
                break;
        }
    }, [isGameHost, sendGameData, players, enemies, towersByCell, gameState, currentWave, isIntermission, waveStartCountdown, gameStatus]);


  const { sendAction, sendGameData, isConnected, ...stats } = useWebRTC(gameId, isGameHost, user, false, handleGameData, handleActionData);

  // When the client connects, it should inform the host it's ready.
  useEffect(() => {
      if (isConnected && !isGameHost && localPlayerId === 'player2') {
          console.log('[CLIENT] Connected to host, sending CLIENT_READY...');
          sendAction('CLIENT_READY', {});
      }
  }, [isConnected, isGameHost, localPlayerId, sendAction]);

  // This is the function clients call to request an action from the host
  const onLocalAction = useCallback((action: 'build' | 'upgrade' | 'sell', payload: any) => {
      if (!localPlayerId || localPlayerId === 'spectator' || isGameHost) return;
      const actionTypeMap = {
        build: 'BUILD_TOWER_REQUEST',
        upgrade: 'UPGRADE_TOWER_REQUEST',
        sell: 'SELL_TOWER_REQUEST'
      }
      sendAction(actionTypeMap[action], { ...payload, playerId: localPlayerId });
  }, [localPlayerId, isGameHost, sendAction]);

  useEffect(() => {
    let gameUnsubscribe: Unsubscribe | undefined;
    
    const setupListeners = async (uid: string) => {
        try {
            const gameDocRef = doc(db, 'games', gameId);
            gameUnsubscribe = onSnapshot(gameDocRef, async (snap) => {
                if (!snap.exists()) {
                     toast({ title: "Spiel nicht gefunden", variant: 'destructive'});
                     router.push('/');
                     return;
                }
                
                const gameData = snap.data();
                if (!gameData) return;
                
                let currentRole: 'player1' | 'player2' | 'spectator' = 'spectator';
                if(gameData.player1Id === uid) currentRole = 'player1';
                else if(gameData.player2Id === uid) currentRole = 'player2';

                if (currentRole === 'spectator' && !gameData.player2Id && !gameData.isTestGame) {
                    try {
                        const joinGameCallable = httpsCallable(functions, 'joinGame');
                        await joinGameCallable({ gameId });
                        toast({ title: "Spiel beigetreten!", description: "Du bist jetzt Spieler 2." });
                        return;
                    } catch(e: any) {
                       toast({ title: "Beitritt fehlgeschlagen", description: e.message, variant: 'destructive'});
                       router.push('/');
                       return;
                    }
                }

                setLocalPlayerId(currentRole);
                setDifficulty(gameData.difficulty || 'Normal');
                
                // Only host reads from Firestore directly. Client gets data from WebRTC.
                if (currentRole === 'player1') {
                    setPlayers(normalizePlayers(gameData.players));
                    setGameState(gameData.gameState || { lives: difficultyModifiers[gameData.difficulty || 'Normal'].startLives });
                    setTowersByCell(gameData.towersByCell || {});
                    setCurrentWave(gameData.currentWave || 0);
                    setIsIntermission(gameData.isIntermission ?? true);
                    setWaveStartCountdown(gameData.waveStartCountdown ?? INTERMISSION_TIME);
                    setGameStatus(gameData.gameStatus || 'waiting');
                }
                
                // For a client, we still need to get the initial player list to identify ourselves
                // before the host sends the full snapshot.
                if(currentRole === 'player2' && players.length === 0){
                    setPlayers(normalizePlayers(gameData.players));
                }

                setGameDataLoaded(true);
                setLoading(false);
            }, (error) => {
              console.error("Error listening to game document:", error);
              toast({ title: "Verbindung zum Spiel verloren", variant: 'destructive'});
              router.push('/');
            });
            
        } catch (e: any) {
            console.error("Error joining/setting up game:", e);
            toast({ title: "Fehler beim Beitreten", description: e.message, variant: 'destructive'});
            router.push('/');
        }
    };

    if (user && gameId) {
        setupListeners(user.uid);
    }

    return () => {
        if (gameUnsubscribe) gameUnsubscribe();
    };
  }, [user, gameId, router, toast, players.length]);

  useEffect(() => {
    const authUnsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
      } else {
         toast({ title: "Authentifizierung erforderlich.", variant: 'destructive' });
         router.push('/');
      }
    });
    return () => authUnsubscribe();
  }, [router, toast]);
  
  if (loading || !gameDataLoaded || !localPlayerId || players.length === 0 || !localPlayer) {
    return <div className="w-full h-full flex items-center justify-center bg-background"><Loader2 className="h-16 w-16 animate-spin text-primary" /> <p className="ml-4 text-lg">Verbinde mit Spiel...</p></div>;
  }
  
  const onPlaceTower = (row: number, col: number, towerId: string) => onLocalAction('build', { row, col, towerId });
  const onUpgradeTower = (upgradeId: string) => focusedTower && onLocalAction('upgrade', { row: focusedTower.position.row, col: focusedTower.position.col, upgradeId });
  const onSellTower = () => focusedTower && onLocalAction('sell', { row: focusedTower.position.row, col: focusedTower.position.col });
  const onElementPick = (element: Element) => onLocalAction('pick_element', { element });
  const handleStartNextWaveNow = () => onLocalAction('start_wave_now', {});
  const onSelectTowerToBuild = (tower: Tower | null) => {
    cancelInteractions();
    setSelectedTowerToBuild(tower);
  };
  
  const LayoutComponent = isMobile ? MobileLayout : DesktopLayout;

  return (
    <div className="flex flex-col h-full bg-background text-foreground font-body">
      <LayoutComponent
          players={players} 
          setPlayers={setPlayers} 
          gameState={gameState} 
          localPlayer={localPlayer}
          currentWave={currentWave} 
          totalWaves={waves.length} 
          difficulty={difficulty} 
          handleGameControl={() => {}} 
          gameStatus={gameStatus} 
          resetGame={() => router.push('/')}
          towers={initialTowers} 
          setTowers={() => {}} 
          placedTowers={placedTowers} 
          enemies={enemies} 
          damageNumbers={damageNumbers} 
          splashRings={splashRings}
          currentPath={currentPath} 
          handlePlaceTower={onPlaceTower}
          onFocusTower={onFocusTower} 
          selectedTowerToBuild={selectedTowerToBuild}
          focusedTower={focusedTower}
          gameBoardRef={gameBoardRef}
          interactionPrompt={""} 
          cancelInteractions={cancelInteractions}
          onSelectTowerToBuild={onSelectTowerToBuild} 
          handleUpgradeTower={onUpgradeTower}
          handleSellTower={onSellTower}
          setFocusedTower={setFocusedTower}
          spawnedThisWave={0} 
          totalEnemiesInWave={0}
          totalKilled={0}
          totalLeaked={0}
          isIntermission={isIntermission} 
          waveStartCountdown={waveStartCountdown}
          intermissionTime={INTERMISSION_TIME} 
          handleStartNextWaveNow={handleStartNextWaveNow}
          lastUpgradedTowerId={lastUpgradedTowerId}
          justPlacedTowerId={justPlacedTowerId}
          isCoop={true} 
          playerRole={localPlayerId}
          handleLoadTestLayout={() => {}} 
          handleLoadAllTowersLayout={() => {}}
          isCheating={false} 
          cheat_unlockAll={() => {}}
          firingTowerIds={firingTowerIds} 
          allTowers={initialTowers}
          isWsConnected={isConnected} 
          hostPacketsPerSecond={stats.sentPacketsPerSecond} 
          hostBytesSentPerSecond={stats.sentBytesPerSecond}
          clientPacketsPerSecond={stats.packetsPerSecond}
          clientBytesReceivedPerSecond={stats.bytesPerSecond}
          averagePacketSize={stats.averagePacketSize}
        />
        {localPlayer && (
            <ElementPickDialog
                isOpen={gameStatus === 'picking-element' && localPlayer.id === 'player1'}
                onElementPick={onElementPick}
                playerName={localPlayer.name}
                currentWave={currentWave}
            />
        )}
    </div>
  );
}
