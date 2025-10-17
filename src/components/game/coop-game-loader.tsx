

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
import { INTERMISSION_TIME, difficultyModifiers, GRID_ROWS, GRID_COLS } from '@/lib/game-data/constants';
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
import Header from './header';
import { audioManager } from '@/lib/audio/audio-manager';


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
  const [isMuted, setIsMuted] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [hostRevision, setHostRevision] = useState(0);

  // VFX State (now mostly handled by GameBoard, but kept for simplicity if needed)
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

  const onSelectTowerToBuild = (tower: Tower | null) => {
    cancelInteractions();
    setSelectedTowerToBuild(tower);
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
        gameBoardRef.current?.queueAttacks(payload);
        break;
      case 'VFX_DAMAGE_NUMBER':
        gameBoardRef.current?.queueDamageNumbers(payload);
        break;
      case 'VFX_SPLASH':
        gameBoardRef.current?.queueSplashRings(payload);
        break;
      case 'VFX_TOWER_FIRING':
        setFiringTowerIds(new Set(payload));
        setTimeout(() => setFiringTowerIds(new Set()), 150);
        break;
      case 'TOWER_UPGRADE_VFX':
        setLastUpgradedTowerId(payload.towerId);
        setTimeout(() => setLastUpgradedTowerId(null), 500);
        break;
      case 'TOWER_PLACE_VFX':
        setJustPlacedTowerId(payload.towerId);
        setTimeout(() => setJustPlacedTowerId(null), 400);
        break;
    }
  }, [isGameHost]);

    const sendGameDataRef = useRef<(type: string, payload: any) => void>(() => {});

    const broadcastSnapshot = useCallback(() => {
        if (!isGameHost || !sendGameDataRef.current) return;
        
        const snapshot = {
            players, enemies, towersByCell, gameState,
            currentWave, isIntermission, waveStartCountdown, gameStatus,
        };
        sendGameDataRef.current('GAME_STATE_SNAPSHOT', snapshot);
    }, [isGameHost, players, enemies, towersByCell, gameState, currentWave, isIntermission, waveStartCountdown, gameStatus]);
    
    // This effect runs on the host to broadcast state changes.
    useEffect(() => {
        if (!isGameHost || hostRevision === 0) return;
        broadcastSnapshot();
    }, [hostRevision, isGameHost, broadcastSnapshot]);
    
    const hostCanPlace = useCallback((row: number, col: number) => {
        const occupied = Object.values(towersByCell).map(t => t.position);
        const tentative = [...occupied, { row, col }];
        const start = { row: 1, col: 1 };
        const goal  = { row: GRID_ROWS, col: GRID_COLS };
        return !!findPath(start, goal, tentative, GRID_ROWS, GRID_COLS);
    }, [towersByCell]);

    const onHostAction = useCallback((action:'build'|'upgrade'|'sell'|'pick_element'|'start_wave_now', payload:any) => {
        console.log(`[HOST] Executing action: ${action}`, payload);
        
        switch(action){
            case 'build': {
                const { row, col, towerId, playerId } = payload;
                if (!hostCanPlace(row, col)) {
                    console.warn(`[HOST] Invalid build request at ${row},${col}. Path blocked.`);
                    return;
                }
                const key = `${row}_${col}`;
                const towerSpec = initialTowers.find(t => t.id === towerId);
                const builder = players.find(p => p.id === playerId);

                if(!towerSpec || !builder || builder.resources < towerSpec.cost || towersByCell[key]) return;
                
                const newTower: PlacedTower = {
                    ...towerSpec,
                    id: crypto.randomUUID(),
                    specId: towerSpec.id,
                    position: { row, col },
                    lastAttack: 0,
                    health: towerSpec.maxHealth,
                    ownerId: playerId,
                };
                
                setTowersByCell(prev => ({ ...prev, [key]: newTower }));
                setPlayers(prev => prev.map(p => p.id === playerId ? {...p, resources: p.resources - towerSpec.cost} : p));

                setFocusedTower(null);
                setSelectedTowerToBuild(null);
                setJustPlacedTowerId(newTower.id);
                setTimeout(() => setJustPlacedTowerId(null), 400);
                if (sendGameDataRef.current) sendGameDataRef.current('TOWER_PLACE_VFX', { towerId: newTower.id });
                break;
            }
            case 'upgrade': {
                const { row, col, upgradeId, playerId } = payload;
                const key = `${row}_${col}`;
                const existingTower = towersByCell[key];
                const upgradeSpec = initialTowers.find(t => t.id === upgradeId);
                const upgrader = players.find(p => p.id === playerId);

                if (!existingTower || !upgradeSpec || !upgrader || existingTower.ownerId !== playerId) return;
                
                const cost = upgradeSpec.cost - Math.floor(existingTower.cost * 0.75);
                if (upgrader.resources < cost) return;

                const upgradedTower: PlacedTower = {...existingTower, ...upgradeSpec, specId: upgradeSpec.id, health: upgradeSpec.maxHealth, id: existingTower.id };

                setTowersByCell(prev => ({ ...prev, [key]: upgradedTower }));
                setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, resources: p.resources - cost } : p));
                
                setLastUpgradedTowerId(upgradedTower.id);
                setTimeout(()=>setLastUpgradedTowerId(null), 500);
                 if (sendGameDataRef.current) sendGameDataRef.current('TOWER_UPGRADE_VFX', { towerId: upgradedTower.id });

                break;
            }
            case 'sell': {
                 const { row, col, playerId } = payload;
                 const key = `${row}_${col}`;
                 const towerToSell = towersByCell[key];
                 if (!towerToSell || towerToSell.ownerId !== playerId) return;

                 const refund = Math.round(towerToSell.cost * 0.75);
                 setTowersByCell(prev => { const { [key]:_, ...rest } = prev; return rest; });
                 setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, resources: p.resources + refund } : p));
                 setFocusedTower(null);
                 break;
            }
            case 'pick_element': {
                const { playerId, element } = payload;
                setPlayers(prev => prev.map(p => 
                  p.id === playerId 
                    ? { ...p, unlockedElements: Array.from(new Set([...p.unlockedElements, element])) }
                    : p
                ));
                setGameStatus("playing"); 
                break;
            }
            case 'start_wave_now': 
                setIsIntermission(false); 
                setWaveStartCountdown(0); 
                break;
        }
        setHostRevision(r => r + 1);
    }, [players, towersByCell, hostCanPlace]);


    const handleActionData = useCallback((msg: any) => {
        if (!isGameHost) return;
        const { type, payload } = msg;
        console.log(`[HOST] Received action request from client: ${type}`, payload);

        switch (type) {
            case 'CLIENT_READY': {
                broadcastSnapshot();
                return;
            }
            case 'BUILD_TOWER_REQUEST':      onHostAction('build', payload); return;
            case 'UPGRADE_TOWER_REQUEST':    onHostAction('upgrade', payload); return;
            case 'SELL_TOWER_REQUEST':       onHostAction('sell', payload); return;
            case 'PICK_ELEMENT_REQUEST':     onHostAction('pick_element', payload); return;
            case 'START_WAVE_NOW_REQUEST':   onHostAction('start_wave_now', payload); return;
        }
    }, [isGameHost, broadcastSnapshot, onHostAction]);

  const { sendAction, sendGameData, isConnected, ...stats } = useWebRTC(gameId, isGameHost, user, false, handleGameData, handleActionData);

  useEffect(() => {
    sendGameDataRef.current = sendGameData;
  }, [sendGameData]);


  useEffect(() => {
      if (isConnected && !isGameHost && localPlayerId === 'player2') {
          console.log('[CLIENT] Connected to host, sending CLIENT_READY...');
          sendAction('CLIENT_READY', {});
      }
  }, [isConnected, isGameHost, localPlayerId, sendAction]);

  const onLocalAction = useCallback((action: 'build' | 'upgrade' | 'sell' | 'pick_element' | 'start_wave_now', payload: any) => {
      if (!localPlayerId || localPlayerId === 'spectator' || isGameHost) return;
      
      const actionTypeMap = {
        build: 'BUILD_TOWER_REQUEST',
        upgrade: 'UPGRADE_TOWER_REQUEST',
        sell: 'SELL_TOWER_REQUEST',
        pick_element: 'PICK_ELEMENT_REQUEST',
        start_wave_now: 'START_WAVE_NOW_REQUEST',
      }
      const actionType = actionTypeMap[action];
      console.log(`[CLIENT] Sending action request to host: ${actionType}`, payload);
      sendAction(actionType, { ...payload, playerId: localPlayerId });
  }, [localPlayerId, isGameHost, sendAction]);
  
    const dispatchAction = useCallback((action: 'build' | 'upgrade' | 'sell' | 'pick_element' | 'start_wave_now', payload: any) => {
        console.log(`[DISPATCH] Action: ${action}`, { ...payload, playerId: payload.playerId ?? localPlayerId });
        const finalPayload = { ...payload, playerId: payload.playerId ?? localPlayerId };
        if (isGameHost) {
            onHostAction(action, finalPayload);
        } else {
            onLocalAction(action, finalPayload);
        }
    }, [isGameHost, onHostAction, onLocalAction, localPlayerId]);

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
                
                // Host reads from Firestore, client will get data from host
                if (currentRole === 'player1') {
                    if(!gameDataLoaded) { // Only on initial load
                        setPlayers(normalizePlayers(gameData.players));
                        setGameState(gameData.gameState || { lives: difficultyModifiers[gameData.difficulty || 'Normal'].startLives });
                        setTowersByCell(gameData.towersByCell || {});
                        setCurrentWave(gameData.currentWave || 0);
                        setIsIntermission(gameData.isIntermission ?? true);
                        setWaveStartCountdown(gameData.waveStartCountdown ?? INTERMISSION_TIME);
                        setGameStatus(gameData.gameStatus || 'waiting');
                        setHostRevision(r => r + 1); // Trigger initial broadcast
                    }
                }
                
                // P2 needs to see the player list to know who they are, even before snapshot
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
  }, [user, gameId, router, toast, players.length, gameDataLoaded]);

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
  
  const toggleMute = () => {
    setIsMuted(current => {
      const newMuted = !current;
      if (newMuted) audioManager.mute();
      else audioManager.unmute();
      return newMuted;
    });
  };

  if (loading || !gameDataLoaded || !localPlayerId || !localPlayer) {
    return <div className="w-full h-full flex items-center justify-center bg-background"><Loader2 className="h-16 w-16 animate-spin text-primary" /> <p className="ml-4 text-lg">Verbinde mit Spiel...</p></div>;
  }
  
  const onPlaceTower = (row: number, col: number) => {
    if(selectedTowerToBuild) {
        dispatchAction('build', { row, col, towerId: selectedTowerToBuild.id });
    }
  };
  const onUpgradeTower = (upgradeId: string) => focusedTower && dispatchAction('upgrade', { row: focusedTower.position.row, col: focusedTower.position.col, upgradeId });
  const onSellTower = () => focusedTower && dispatchAction('sell', { row: focusedTower.position.row, col: focusedTower.position.col });
  const onElementPick = (element: Element) => dispatchAction('pick_element', { element, playerId: localPlayerId });
  const handleStartNextWaveNow = () => dispatchAction('start_wave_now', {});
  
  const LayoutComponent = isMobile ? MobileLayout : DesktopLayout;

  return (
    <div className="w-full h-full flex flex-col" onClick={() => { if (!hasInteracted) { audioManager.init(); setHasInteracted(true); }}}>
       <Header onExit={() => router.push('/')} isMuted={isMuted} toggleMute={toggleMute} />
        <div className="flex-grow p-2">
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
                damageNumbers={[]} 
                splashRings={[]}
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
            </div>
            {localPlayer && (
                <ElementPickDialog
                    isOpen={gameStatus === 'picking-element' && localPlayer.id === 'player1'}
                    onElementPick={onElementPick}
                    playerName={localPlayer.name}
                    currentWave={currentWave}
                    unlockedElements={new Set(localPlayer.unlockedElements)}
                />
            )}
      </div>
  );
}
