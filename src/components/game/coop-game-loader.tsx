
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, auth, functions } from '@/lib/firebase';
import { doc, onSnapshot, Unsubscribe, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { normalizePlayers } from '@/lib/player-utils';
import type { Player, GameState, GameStatus, PlacedTower, Difficulty, GameDelta, Tower } from '@/lib/game-data/types';
import { INTERMISSION_TIME, difficultyModifiers, GRID_ROWS, GRID_COLS, LOCAL_STORAGE_KEY } from '@/lib/game-data/constants';
import { httpsCallable } from 'firebase/functions';
import { Loader2 } from 'lucide-react';
import { GameSession } from './game-session';
import { towers as initialTowers } from '@/lib/game-data/towers';
import { useWebRTC, type NetMsg } from '@/hooks/use-webrtc';
import { findPath } from '@/lib/pathfinding';


export default function CoopGameLoader() {
  const { gameId } = useParams<{ gameId: string }>();
  const router = useRouter();
  const { toast } = useToast();
  
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const [players, setPlayers] = useState<Player[]>([]);
  const [gameState, setGameState] = useState<GameState>({ lives: 20 });
  const [towersByCell, setTowersByCell] = useState<Record<string, PlacedTower>>({});
  const [currentWave, setCurrentWave] = useState(0);
  const [gameStatus, setGameStatus] = useState<GameStatus>('waiting');
  const [isIntermission, setIsIntermission] = useState(true);
  const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);
  const [difficulty, setDifficulty] = useState<Difficulty>('Normal');
  const [localPlayerId, setLocalPlayerId] = useState<'player1' | 'player2' | 'spectator' | null>(null);
  const [gameDataLoaded, setGameDataLoaded] = useState(false);
  
  const isGameHost = useMemo(() => localPlayerId === 'player1', [localPlayerId]);

  const handleGameData = useCallback((msg: NetMsg) => {
    // Only client should process game data from host
    if (!isGameHost && msg.type === 'GAME_DELTAS') {
      applyDeltas(msg.payload);
    }
  }, [isGameHost]);

  const handleActionData = useCallback((msg: NetMsg) => {
    // Only host should process actions from client
    if (isGameHost && msg.payload.playerId !== 'player1') {
      const { action, payload, playerId } = msg;
      const { row, col, towerId, upgradeId } = payload;
      
      switch (action) {
          case 'BUILD_TOWER':
              handleRequestBuildTower(row, col, towerId, playerId);
              break;
          case 'UPGRADE_TOWER':
              handleRequestUpgradeTower(row, col, upgradeId, playerId);
              break;
          case 'SELL_TOWER':
              handleRequestSellTower(row, col, playerId);
              break;
      }
    }
  }, [isGameHost]);

  const { sendAction, sendGameData, isConnected, ...stats } = useWebRTC(gameId, isGameHost, user, false, handleGameData, handleActionData);

  const applyDeltas = useCallback((deltas: GameDelta[]) => {
      // Placeholder for client-side delta application
  }, []);

  const handleRequestBuildTower = (row: number, col: number, towerId: string, playerId: 'player1' | 'player2') => {
      if(!isGameHost) return; // Only host validates
      const player = players.find(p => p.id === playerId);
      const towerSpec = initialTowers.find(t => t.id === towerId);
      
      if (!player || !towerSpec || player.resources < towerSpec.cost) return;

      const cellKey = `${row}_${col}`;
      if (towersByCell[cellKey]) return;

      const currentPlacedTowers = Object.values(towersByCell).map(t => t.position);
      if (!findPath({row:1, col:1}, {row:GRID_ROWS, col:GRID_COLS}, [...currentPlacedTowers, {row, col}], GRID_ROWS, GRID_COLS)) {
        return;
      }

      // If valid, update host state (which will then be broadcast via deltas)
      const newTower: PlacedTower = JSON.parse(JSON.stringify({
          ...towerSpec, id: `tower-${row}-${col}-${Date.now()}`, specId: towerSpec.id,
          position: { row, col }, lastAttack: 0, health: towerSpec.maxHealth, ownerId: player.id,
      }));
      
      const newTowersByCell = { ...towersByCell, [cellKey]: newTower };
      const newPlayers = players.map(p => p.id === playerId ? {...p, resources: p.resources - newTower.cost} : p);

      if(gameId) {
          updateDoc(doc(db, 'games', gameId), {
              towersByCell: newTowersByCell,
              players: { player1: newPlayers[0], player2: newPlayers[1] }
          });
      }
  };

  const handleRequestUpgradeTower = (row: number, col: number, upgradeId: string, playerId: 'player1' | 'player2') => {
      if(!isGameHost) return;
      const player = players.find(p => p.id === playerId);
      const cellKey = `${row}_${col}`;
      const focusedTower = towersByCell[cellKey];

      if (!player || !focusedTower || focusedTower.ownerId !== playerId) return;

      const upgradeTowerSpec = initialTowers.find(t => t.id === upgradeId);
      if (!upgradeTowerSpec) return;

      const refundPercentage = difficulty === 'Einfach' ? 1.0 : 0.75;
      const cost = Math.max(0, upgradeTowerSpec.cost - Math.floor(focusedTower.cost * refundPercentage));

      if (player.resources < cost) return;

      const newPlacedTower: PlacedTower = JSON.parse(JSON.stringify({ 
          ...focusedTower, ...upgradeTowerSpec, specId: upgradeTowerSpec.id, health: upgradeTowerSpec.maxHealth 
      }));
      
      const newTowersByCell = {...towersByCell, [cellKey]: newPlacedTower };
      const newPlayers = players.map(p => p.id === playerId ? {...p, resources: p.resources - cost} : p);
      
      if(gameId) {
          updateDoc(doc(db, 'games', gameId), {
              towersByCell: newTowersByCell,
              players: { player1: newPlayers[0], player2: newPlayers[1] }
          });
      }
  };
  
  const handleRequestSellTower = (row: number, col: number, playerId: 'player1' | 'player2') => {
      if(!isGameHost) return;
      const player = players.find(p => p.id === playerId);
      const cellKey = `${row}_${col}`;
      const focusedTower = towersByCell[cellKey];

      if (!player || !focusedTower || focusedTower.ownerId !== playerId) return;

      const refundPercentage = difficulty === 'Einfach' ? 1.0 : 0.75;
      const refund = Math.round(focusedTower.cost * refundPercentage);

      const newTowersByCell = { ...towersByCell };
      delete newTowersByCell[cellKey];
      const newPlayers = players.map(p => p.id === playerId ? {...p, resources: p.resources + refund} : p);
      
       if(gameId) {
          updateDoc(doc(db, 'games', gameId), {
              towersByCell: newTowersByCell,
              players: { player1: newPlayers[0], player2: newPlayers[1] }
          });
      }
  };


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
                setPlayers(normalizePlayers(gameData.players));
                setGameState(gameData.gameState || { lives: difficultyModifiers[gameData.difficulty || 'Normal'].startLives });
                setGameStatus(gameData.gameStatus || 'waiting');
                setCurrentWave(gameData.currentWave || 0);
                setIsIntermission(gameData.isIntermission ?? true);
                setWaveStartCountdown(gameData.waveStartCountdown ?? INTERMISSION_TIME);
                setTowersByCell(gameData.towersByCell || {});
                
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
  }, [user, gameId, router, toast]);

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
  

  const onLocalAction = useCallback((action: 'build' | 'upgrade' | 'sell', payload: any) => {
      if (!localPlayerId || localPlayerId === 'spectator') return;

      const fullPayload = { ...payload, playerId: localPlayerId };
      
      if (isGameHost) {
          // Host executes action directly
           const { row, col, towerId, upgradeId } = payload;
            switch(action) {
                case 'build': handleRequestBuildTower(row, col, towerId, localPlayerId); break;
                case 'upgrade': handleRequestUpgradeTower(row, col, upgradeId, localPlayerId); break;
                case 'sell': handleRequestSellTower(row, col, localPlayerId); break;
            }
      } else {
          // Client sends action to host
          sendAction(action.toUpperCase() + '_TOWER', fullPayload);
      }
  }, [localPlayerId, isGameHost, sendAction]);
  
  if (loading || !gameDataLoaded || !localPlayerId || players.length === 0) {
    return <div className="w-full h-full flex items-center justify-center bg-background"><Loader2 className="h-16 w-16 animate-spin text-primary" /> <p className="ml-4 text-lg">Verbinde mit Spiel...</p></div>;
  }
  
  const activeUser = user || { displayName: 'Spieler', photoURL: null, uid: 'unknown-uid' };

  return (
    <GameSession 
        initialPlayers={players}
        initialGameState={gameState}
        initialTowersByCell={towersByCell}
        initialEnemies={[]} // Enemies are managed by the host
        initialCurrentWave={currentWave}
        initialDifficulty={difficulty}
        initialIsIntermission={isIntermission}
        initialWaveStartCountdown={waveStartCountdown}
        isCoop={true}
        isGameHost={isGameHost}
        localPlayerId={localPlayerId}
        user={activeUser as User}
        onExit={() => router.push('/')}
        onLocalAction={onLocalAction}
        allTowers={initialTowers}
        isWsConnected={isConnected}
        hostPacketsPerSecond={isGameHost ? stats.sentPacketsPerSecond : stats.packetsPerSecond}
        hostBytesSentPerSecond={isGameHost ? stats.sentBytesPerSecond : stats.bytesPerSecond}
        clientPacketsPerSecond={!isGameHost ? stats.sentPacketsPerSecond : stats.packetsPerSecond}
        clientBytesReceivedPerSecond={!isGameHost ? stats.sentBytesPerSecond : stats.bytesPerSecond}
        averagePacketSize={stats.averagePacketSize}
    />
  );
}
