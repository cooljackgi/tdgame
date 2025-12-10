

'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, auth } from '@/lib/firebase';
import { doc, onSnapshot, Unsubscribe, getDoc } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { normalizePlayers } from '@/lib/player-utils';
import type { Player, PlayerGameState, GameStatus, Tower, Difficulty, Node, PlacedTower, VersusEnemyToSend, GameSessionState } from '@/lib/game-data/types';
import { INTERMISSION_TIME, difficultyModifiers } from '@/lib/game-data/constants';
import { httpsCallable } from 'firebase/functions';
import { Loader2 } from 'lucide-react';
import { useWebRTC } from '@/hooks/use-webrtc';
import { useIsMobile } from '@/hooks/use-mobile';
import { VersusDesktopLayout } from '@/components/layouts/versus-desktop-layout';
import { VersusMobileLayout } from '@/components/layouts/versus-mobile-layout';
import Header from './header';
import type { GameBoardHandle } from './game-board';
import { loadGameConfig, type GameConfig } from '@/lib/game-config-loader';
import { DeltaType } from '@/lib/game-data/types';

export default function VersusGameLoader() {
  const { gameId } = useParams<{ gameId: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  const [gameConfig, setGameConfig] = useState<GameConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Lade Spiel...');
  const [localPlayerId, setLocalPlayerId] = useState<'player1' | 'player2' | 'spectator' | null>(null);
  const [gameDataLoaded, setGameDataLoaded] = useState(false);

  // --- Core Game State ---
  const [players, setPlayers] = useState<Player[]>([]);
  const [playerStates, setPlayerStates] = useState<{ player1: PlayerGameState | null, player2: PlayerGameState | null }>({ player1: null, player2: null });
  const [currentWave, setCurrentWave] = useState(0);
  const [gameStatus, setGameStatus] = useState<GameStatus>('waiting');
  const [isIntermission, setIsIntermission] = useState(true);
  const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);
  const [difficulty, setDifficulty] = useState<Difficulty>('Normal');
  
  const [fps, setFps] = useState(0);

  // --- UI/Interaction State ---
  const [selectedTowerToBuild, setSelectedTowerToBuild] = useState<Tower | null>(null);
  const [portalPhase, setPortalPhase] = useState<'idle' | 'entrance' | 'exit'>('idle');
  const [portalEntrance, setPortalEntrance] = useState<Node | null>(null);
  const [focusedTower, setFocusedTower] = useState<PlacedTower | null>(null);
  const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string | null>(null);
  const gameBoardRef = useRef<GameBoardHandle>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  const isGameHost = useMemo(() => localPlayerId === 'player1', [localPlayerId]);

  const localPlayer = useMemo(() => {
    return players.find(p => p.id === localPlayerId);
  }, [players, localPlayerId]);

  const localPlayerState = useMemo(() => {
    if (!localPlayerId || localPlayerId === 'spectator' || !playerStates) return null;
    return playerStates[localPlayerId as 'player1' | 'player2'];
  }, [localPlayerId, playerStates]);

  // --- Refs for stable access in callbacks ---
  const playersRef = useRef(players);
  useEffect(() => { playersRef.current = players; }, [players]);
  const gameDataLoadedRef = useRef(gameDataLoaded);
  useEffect(() => { gameDataLoadedRef.current = gameDataLoaded; }, [gameDataLoaded]);
  const playerStatesRef = useRef(playerStates);
  useEffect(() => { playerStatesRef.current = playerStates; }, [playerStates]);
  
  // --- WebRTC Logic ---

  const handleGameData = useCallback((msg: any) => {
    if (isGameHost) return;
    
    if (msg.type === 'deltas') {
        const deltas = msg.payload as any[];
        for (const delta of deltas) {
            const deltaType = delta[0];
            const deltaPayload = delta[1];
            switch(deltaType) {
                case DeltaType.SNAPSHOT:
                  const state = deltaPayload as GameSessionState;
                  setPlayers(state.players);
                  setPlayerStates(state.playerStates!);
                  setCurrentWave(state.currentWave);
                  setIsIntermission(state.isIntermission);
                  setWaveStartCountdown(state.waveStartCountdown);
                  setGameStatus(state.gameStatus);
                  setLoading(false); // Make sure loading is false after snapshot
                  break;
                // Add other delta handling here as needed for versus mode
            }
        }
    }
  }, [isGameHost]);

  const onGameDataRef = useRef(handleGameData);
  useEffect(() => {
    onGameDataRef.current = handleGameData;
  }, [handleGameData]);

  const { sendAction, sendGameData, isConnected, ...stats } = useWebRTC(
    localPlayerId ? gameId : null, 
    isGameHost, 
    user, 
    false,
    (msg: any) => onGameDataRef.current?.(msg),
    // Pass the action handler directly
    (msg: any) => {
        if (!isGameHost) return;
        if (msg.type === 'CLIENT_READY') {
          const currentState = {
            gameMode: 'versus',
            players: playersRef.current,
            playerStates: playerStatesRef.current,
            currentWave: currentWave,
            difficulty: difficulty,
            gameStatus: gameStatus,
            waveStartCountdown: waveStartCountdown,
            isIntermission: isIntermission,
          } as GameSessionState;
          
          sendGameData('deltas', [[DeltaType.SNAPSHOT, currentState]]);
        }
    }
  );

  useEffect(() => {
    if (isConnected && !isGameHost && localPlayerId === 'player2') {
      sendAction('CLIENT_READY', {});
    }
  }, [isConnected, isGameHost, localPlayerId, sendAction]);


  useEffect(() => {
    if (!gameId) return;
    const authUnsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) {
        toast({ title: "Authentifizierung erforderlich.", variant: 'destructive' });
        router.push('/');
        return;
      }
      setUser(currentUser);
    });
    return () => authUnsubscribe();
  }, [gameId, router, toast]);

  useEffect(() => {
    async function fetchConfig() {
        try {
            const config = await loadGameConfig();
            setGameConfig(config);
        } catch (error) {
            console.error("Failed to load game config:", error);
            toast({ 
                title: 'Fehler beim Laden der Konfiguration',
                variant: 'destructive' 
            });
        } finally {
            setConfigLoading(false);
        }
    }
    fetchConfig();
  }, [toast]);

  useEffect(() => {
    if (!user || !gameId || configLoading) return;

    const gameDocRef = doc(db, 'games', gameId);
    let unsub: Unsubscribe | undefined;

    const joinAndListen = async () => {
        setLoadingMessage('Trete Spiel bei...');
        const gameSnap = await getDoc(gameDocRef);
        if (!gameSnap.exists() || gameSnap.data().gameMode !== 'versus') {
            toast({ title: "Spiel nicht gefunden oder falscher Modus.", variant: 'destructive' });
            router.push('/');
            return;
        }

        const initialData = gameSnap.data();
        if (initialData.player1Id !== user.uid && !initialData.player2Id) {
            const joinGameCallable = httpsCallable(functions, 'joinGame');
            await joinGameCallable({ gameId });
        }

        setLoadingMessage('Warte auf Spiel-Daten...');
        unsub = onSnapshot(gameDocRef, (snap) => {
            const data = snap.data();
            if (!data) return;

            let role: 'player1' | 'player2' | 'spectator' = 'spectator';
            if (data.player1Id === user.uid) role = 'player1';
            else if (data.player2Id === user.uid) role = 'player2';
            setLocalPlayerId(role);
            
            // Host loads initial data and then waits for client to be ready
            if (role === 'player1') {
                 setPlayers(normalizePlayers(data.players));
                 setDifficulty(data.difficulty || 'Normal');
                 setPlayerStates(data.playerStates);
                 setGameStatus(data.gameStatus);
                 setIsIntermission(data.isIntermission ?? true);
                 setWaveStartCountdown(data.waveStartCountdown ?? INTERMISSION_TIME);
                 if (!gameDataLoaded) {
                    setGameDataLoaded(true);
                 }
                 setLoading(false); // Host is ready to be displayed
            } else if (role === 'player2') {
                 // Client only needs minimal data, rest comes from snapshot
                 setPlayers(normalizePlayers(data.players));
                 setDifficulty(data.difficulty || 'Normal');
                 setPlayerStates(data.playerStates); // THE FIX
                 if (!gameDataLoaded) {
                    setGameDataLoaded(true);
                 }
                 // setLoading(false) will be called by the SNAPSHOT
            }
        });
    };

    joinAndListen().catch(err => {
        console.error("Error in joinAndListen", err);
        toast({ title: 'Fehler beim beitreten.', variant: 'destructive' });
        router.push('/');
    });

    return () => unsub?.();
  }, [user, gameId, router, toast, configLoading, gameDataLoaded]);

  const onExit = () => router.push('/');
  const cancelInteractions = useCallback(() => { setSelectedTowerToBuild(null); setFocusedTower(null); }, []);

  if (configLoading || !localPlayer) {
    return <div className="w-full h-full flex flex-col items-center justify-center bg-background"><Loader2 className="h-10 w-10 animate-spin text-primary mb-4" /><p className="text-muted-foreground">{loadingMessage}</p></div>;
  }
  
  // This is the correct loading state for Player 2
  if (!isGameHost && !localPlayerState) {
    return <div className="w-full h-full flex flex-col items-center justify-center bg-background"><Loader2 className="h-10 w-10 animate-spin text-primary mb-4" /><p>Warte auf Spielzustand vom Host...</p></div>;
  }

  const LayoutComponent = isMobile ? VersusMobileLayout : VersusDesktopLayout;

  return (
    <div className="w-full h-full flex flex-col">
      <Header onExit={onExit} isMuted={isMuted} toggleMute={() => setIsMuted(m => !m)} fps={isGameHost ? fps : stats.fps} />
      <div className="flex-grow p-2">
        <LayoutComponent
          players={players}
          setPlayers={setPlayers}
          gameState={localPlayerState!}
          localPlayer={localPlayer!}
          currentWave={currentWave}
          totalWaves={gameConfig?.waves.length ?? 0}
          difficulty={difficulty}
          handleGameControl={() => {}}
          gameStatus={gameStatus}
          resetGame={onExit}
          towers={gameConfig?.towers ?? []}
          setTowers={() => {}}
          placedTowers={Object.values(localPlayerState!.towersByCell)}
          enemies={localPlayerState!.enemies}
          workers={localPlayerState!.workers}
          ghosts={localPlayerState!.ghosts}
          portals={localPlayerState!.portals}
          damageNumbers={[]}
          splashRings={[]}
          persistentClouds={[]}
          currentPath={localPlayerState!.currentPath}
          handlePlaceTower={() => {}}
          onFocusTower={setFocusedTower}
          selectedTowerToBuild={selectedTowerToBuild}
          portalEntrance={portalEntrance}
          focusedTower={focusedTower}
          gameBoardRef={gameBoardRef}
          interactionPrompt="Versus Mode"
          cancelInteractions={cancelInteractions}
          onSelectTowerToBuild={setSelectedTowerToBuild}
          onEnterPortalMode={() => {}}
          handleUpgradeTower={() => {}}
          handleSellTower={() => {}}
          setFocusedTower={setFocusedTower}
          spawnedThisWave={0}
          totalEnemiesInWave={0}
          totalKilled={0}
          totalLeaked={0}
          isIntermission={isIntermission}
          waveStartCountdown={waveStartCountdown}
          intermissionTime={INTERMISSION_TIME}
          handleStartNextWaveNow={() => {}}
          lastUpgradedTowerId={lastUpgradedTowerId}
          isCoop={false}
          playerRole={localPlayerId}
          handleLoadTestLayout={() => {}}
          handleLoadAllTowersLayout={() => {}}
          isCheating={false}
          cheat_unlockAll={() => {}}
          firingTowerIds={new Set()}
          allTowers={gameConfig?.towers ?? []}
          isWsConnected={isConnected}
          onPing={() => {}}
          isPlacingPortalEntrance={portalPhase !== 'idle'}
          onSendEnemy={(payload: any) => sendAction('SEND_ENEMY', payload)}
          gameMode="versus"
        />
      </div>
    </div>
  );
}
