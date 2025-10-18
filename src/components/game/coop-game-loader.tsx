

'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, auth } from '@/lib/firebase';
import { doc, onSnapshot, Unsubscribe, updateDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { normalizePlayers } from '@/lib/player-utils';
import type { Player, GameState, GameStatus, PlacedTower, Difficulty, Tower, Element, Enemy, Attack, DamageNumber, SplashRing, Node, EnemyStatusEffect, TowerEffect } from '@/lib/game-data/types';
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
import { onGameEnd } from '@/lib/game-logic';


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
  const [totalKilled, setTotalKilled] = useState(0);
  const [totalLeaked, setTotalLeaked] = useState(0);

  
  // UI State
  const [selectedTowerToBuild, setSelectedTowerToBuild] = useState<Tower | null>(null);
  const [focusedTower, setFocusedTower] = useState<PlacedTower | null>(null);
  const [justPlacedTowerId, setJustPlacedTowerId] = useState<string | null>(null);
  const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string | null>(null);
  const gameBoardRef = useRef<GameBoardHandle>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [hostRevision, setHostRevision] = useState(0);

  // VFX State
  const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());
  
  const isGameHost = useMemo(() => localPlayerId === 'player1', [localPlayerId]);
  const placedTowers = useMemo(() => Object.values(towersByCell), [towersByCell]);
  const currentPath = useMemo(() => findPath({ row: 1, col: 1 }, { row: 12, col: 12 }, placedTowers.map(t => t.position), 12, 12) || [], [placedTowers]);
  const localPlayer = useMemo(() => players.find(p => p.id === localPlayerId), [players, localPlayerId]);

  // Host-side Game Loop & State Refs
  const countdownRef = useRef<number | null>(null);
  const spawnRef = useRef<number | null>(null);
  const spawningRef = useRef(false);
  const pendingSpawnRef = useRef<Enemy[]>([]);
  const gameLoopRef = useRef<number>();
  const lastTickRef = useRef(performance.now());
  const enemyIdCounter = useRef(0);
  
  // Refs for stable access in game loop
  const currentPathRef = useRef(currentPath);
  useEffect(() => { currentPathRef.current = currentPath }, [currentPath]);
  
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
        // --- Client-side interpolation logic ---
        setEnemies(currentEnemies => {
            const now = performance.now();
            const newEnemies = payload.enemies;
            const enemyMap = new Map(currentEnemies.map(e => [e.id, e]));
            
            return newEnemies.map((incomingEnemy: Enemy) => {
                const existing = enemyMap.get(incomingEnemy.id);
                if (existing) {
                    // Prevent pathIndex from going backwards, but accept host's new position
                    incomingEnemy.pathIndex = Math.max(existing.pathIndex, incomingEnemy.pathIndex);
                }
                // Normalize time base to client's clock for smooth interpolation
                incomingEnemy.lastMove = now;
                return incomingEnemy;
            });
        });
        setTowersByCell(payload.towersByCell);
        setGameState(payload.gameState);
        setCurrentWave(payload.currentWave);
        setIsIntermission(payload.isIntermission);
        setWaveStartCountdown(payload.waveStartCountdown);
        setGameStatus(payload.gameStatus);
        setTotalKilled(payload.totalKilled);
        setTotalLeaked(payload.totalLeaked);
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
            totalKilled, totalLeaked,
        };
        sendGameDataRef.current('GAME_STATE_SNAPSHOT', snapshot);
    }, [isGameHost, players, enemies, towersByCell, gameState, currentWave, isIntermission, waveStartCountdown, gameStatus, totalKilled, totalLeaked]);
    
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

    const startWave = useCallback((waveIndex: number) => {
        if (!isGameHost) return;
        if (spawningRef.current) return;

        const spec = waves[waveIndex];
        if (!spec) return;

        const enemyData = spec.enemies;
        const newEnemies: Enemy[] = Array.from({length: enemyData.count}).map((_, i) => ({
            id: `w${waveIndex}-e${enemyIdCounter.current++}`,
            type: enemyData.type,
            health: enemyData.health,
            maxHealth: enemyData.health,
            armor: enemyData.armor,
            speed: enemyData.speed,
            damage: enemyData.damage,
            bounty: enemyData.bounty,
            effects: [],
            position: { row: 1, col: 1 },
            path: currentPathRef.current,
            pathIndex: 0,
            lastMove: performance.now(),
            wasHit: false,
            targetNode: { row: GRID_ROWS, col: GRID_COLS },
            movementPattern: enemyData.type === 'schnell' ? 'zigzag' : 'wobble',
        }));
        pendingSpawnRef.current = newEnemies;

        spawningRef.current = true;
        setIsIntermission(false);
        setCurrentWave(waveIndex);
        setWaveStartCountdown(0);

        spawnRef.current = window.setInterval(() => {
            const next = pendingSpawnRef.current.shift();
            if (next) {
                setEnemies(prev => [...prev, next]);
            }
            if (pendingSpawnRef.current.length === 0) {
                window.clearInterval(spawnRef.current!);
                spawnRef.current = null;
                spawningRef.current = false;
            }
        }, enemyData.spawnDelay);

        setHostRevision(r => r + 1);
    }, [isGameHost]);

    const onHostAction = useCallback((action:'build'|'upgrade'|'sell'|'pick_element'|'start_wave_now', payload:any) => {
        if (!isGameHost) return;
        
        switch(action){
            case 'build': {
                const { row, col, towerId, playerId } = payload;
                const key = `${row}_${col}`;
                const existingTower = towersByCell[key];
                
                if (existingTower) return;
                if (!hostCanPlace(row, col)) {
                    console.warn(`[HOST] Invalid build request at ${row},${col}. Path blocked.`);
                    return;
                }

                const towerSpec = initialTowers.find(t => t.id === towerId);
                const builder = players.find(p => p.id === playerId);

                if(!towerSpec || !builder || builder.resources < towerSpec.cost) return;
                
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

                setJustPlacedTowerId(newTower.id);
                setTimeout(() => setJustPlacedTowerId(null), 400);
                if (sendGameDataRef.current) sendGameDataRef.current('TOWER_PLACE_VFX', { towerId: newTower.id });
                break;
            }
            case 'upgrade': {
                const { row, col, upgradeId, playerId } = payload;
                const key = `${row}_${col}`;
                const existingTower = towersByCell[key];
                
                if (!existingTower || existingTower.ownerId !== playerId) return;

                const upgradeSpec = initialTowers.find(t => t.id === upgradeId);
                const upgrader = players.find(p => p.id === playerId);

                if (!upgradeSpec || !upgrader) return;
                
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
                if (isIntermission) {
                    if (countdownRef.current) window.clearInterval(countdownRef.current);
                    countdownRef.current = null;
                    startWave(currentWave);
                }
                break;
        }
        setHostRevision(r => r + 1);
    }, [players, towersByCell, hostCanPlace, isGameHost, startWave, isIntermission, currentWave]);


    const handleActionData = useCallback((msg: any) => {
        if (!isGameHost) return;
        const { type, payload } = msg;

        switch (type) {
            case 'CLIENT_READY': {
                setHostRevision(r => r + 1);
                return;
            }
            case 'BUILD_TOWER_REQUEST':      onHostAction('build', payload); return;
            case 'UPGRADE_TOWER_REQUEST':    onHostAction('upgrade', payload); return;
            case 'SELL_TOWER_REQUEST':       onHostAction('sell', payload); return;
            case 'PICK_ELEMENT_REQUEST':     onHostAction('pick_element', payload); return;
            case 'START_WAVE_NOW_REQUEST':   onHostAction('start_wave_now', payload); return;
        }
    }, [isGameHost, onHostAction]);

  const { sendAction, sendGameData, isConnected, ...stats } = useWebRTC(gameId, isGameHost, user, false, handleGameData, handleActionData);

  useEffect(() => {
    sendGameDataRef.current = sendGameData;
  }, [sendGameData]);


  useEffect(() => {
      if (isConnected && !isGameHost && localPlayerId === 'player2') {
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
      sendAction(actionType, { ...payload, playerId: localPlayerId });
  }, [localPlayerId, isGameHost, sendAction]);
  
    const dispatchAction = useCallback((action: 'build' | 'upgrade' | 'sell' | 'pick_element' | 'start_wave_now', payload: any) => {
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

                setLocalPlayerId(currentRole);
                setDifficulty(gameData.difficulty || 'Normal');
                
                if (currentRole === 'player1') {
                    setPlayers(normalizePlayers(gameData.players));
                    setGameState(gameData.gameState || { lives: difficultyModifiers[gameData.difficulty || 'Normal'].startLives });
                    setTowersByCell(gameData.towersByCell || {});
                    setCurrentWave(gameData.currentWave || 0);
                    setIsIntermission(gameData.isIntermission ?? true);
                    setWaveStartCountdown(gameData.waveStartCountdown ?? INTERMISSION_TIME);
                    setGameStatus(gameData.gameStatus || 'waiting');
                }
                
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
  
    // Intermission countdown timer (HOST ONLY)
    useEffect(() => {
        if (!isGameHost || !isIntermission || gameStatus !== 'playing') {
            if (countdownRef.current) window.clearInterval(countdownRef.current);
            countdownRef.current = null;
            return;
        }

        countdownRef.current = window.setInterval(() => {
            setWaveStartCountdown(prev => {
                const newTime = Math.max(0, prev - 1);
                if (newTime === 0) {
                    window.clearInterval(countdownRef.current!);
                    countdownRef.current = null;
                    startWave(currentWave);
                }
                setHostRevision(r => r + 1); // Broadcast countdown changes
                return newTime;
            });
        }, 1000);

        return () => {
            if (countdownRef.current) window.clearInterval(countdownRef.current);
            countdownRef.current = null;
        };
    }, [isGameHost, isIntermission, gameStatus, startWave, currentWave]);

    // Wave completion detection (HOST ONLY)
    useEffect(() => {
        if (!isGameHost || gameStatus !== 'playing') return;
        if (spawningRef.current || enemies.length > 0) return;

        if (!isIntermission) {
            // Check if there is a next wave
            if (waves.length > currentWave + 1) {
                 if ((currentWave + 1) % 5 === 0 && localPlayer?.unlockedElements.length < 8) {
                    setGameStatus('picking-element');
                 } else {
                    setCurrentWave(prev => prev + 1);
                    setIsIntermission(true);
                    setWaveStartCountdown(INTERMISSION_TIME);
                 }
            } else { // Game won
                onGameEnd(gameId, user, difficulty, currentWave + 1, true, towersByCell);
                setGameStatus('gameover');
            }
             setHostRevision(r => r + 1);
        }
    }, [isGameHost, gameStatus, enemies.length, isIntermission, currentWave, difficulty, towersByCell, user, gameId, localPlayer]);
  
  // MAIN GAME LOOP (HOST ONLY)
  useEffect(() => {
      if (!isGameHost) {
          if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
          return;
      }

      const gameLoop = () => {
          gameLoopRef.current = requestAnimationFrame(gameLoop);
          const now = performance.now();
          const delta = now - lastTickRef.current;
          if (delta < 16) return; // Cap at ~60fps
          lastTickRef.current = now;

          if (gameStatus !== 'playing' || isIntermission) {
              return;
          }

          let livesLost = 0;
          let resourcesGained = 0;
          let killedInTick = 0;
          let newAttacks: Attack[] = [];
          let newDamageNumbers: DamageNumber[] = [];
          
          setEnemies(prevEnemies => {
              const stillAlive = prevEnemies.map(enemy => {
                  let updatedEnemy = { ...enemy, effects: enemy.effects.filter(e => e.expires > now) };

                  const stunEffect = updatedEnemy.effects.find(e => e.type === 'stun');
                  if (stunEffect) return updatedEnemy;

                  // Handle DoT effects (like burn)
                  const burnEffect = updatedEnemy.effects.find(e => e.type === 'burn');
                  if (burnEffect) {
                      if (!burnEffect.lastTick || now - burnEffect.lastTick >= 1000) {
                          const burnDamage = burnEffect.potency ?? 0;
                          updatedEnemy.health -= burnDamage;
                          burnEffect.lastTick = now;
                          newDamageNumbers.push({ id: crypto.randomUUID(), amount: burnDamage, targetId: updatedEnemy.id, color: '#f97316' } as DamageNumber);
                      }
                  }
                  
                  // Handle movement
                  const slowEffect = updatedEnemy.effects.find(e => e.type === 'slow');
                  const speedMultiplier = slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1;
                  const speed = updatedEnemy.speed * speedMultiplier;
                  
                  const stepMs = 1000 / Math.max(0.01, speed);
                  if (now - updatedEnemy.lastMove > stepMs) {
                      return { ...updatedEnemy, pathIndex: updatedEnemy.pathIndex + 1, position: updatedEnemy.path[updatedEnemy.pathIndex + 1], lastMove: now };
                  }
                  return updatedEnemy;

              }).filter(enemy => {
                  if (enemy.pathIndex >= enemy.path.length -1) {
                      livesLost++;
                      return false;
                  }
                  if (enemy.health <= 0) {
                      resourcesGained += enemy.bounty;
                      killedInTick++;
                      return false;
                  }
                  return true;
              });

              if (livesLost > 0) {
                  setGameState(gs => ({ ...gs, lives: Math.max(0, gs.lives - livesLost) }));
                  setTotalLeaked(l => l + livesLost);
                  if (gameState.lives - livesLost <= 0 && gameStatus !== 'gameover') {
                      onGameEnd(gameId, user, difficulty, currentWave + 1, false, towersByCell);
                      setGameStatus('gameover');
                  }
              }
              if (resourcesGained > 0) {
                  setPlayers(ps => ps.map(p => ({...p, resources: p.resources + Math.floor(resourcesGained / ps.length)})));
                  setTotalKilled(k => k + killedInTick);
              }

              return stillAlive;
          });
          
          setTowersByCell(prevTowers => {
              const newTowers = { ...prevTowers };
              let firingIds = new Set<string>();

              Object.values(newTowers).forEach(tower => {
                   if (now - tower.lastAttack >= tower.attackSpeed) {
                       let target: Enemy | null = null;
                       let minDistanceSq = tower.range * tower.range;
                       
                       enemies.forEach(enemy => {
                          const distSq = (tower.position.col - enemy.position.col) ** 2 + (tower.position.row - enemy.position.row) ** 2;
                          if (distSq <= minDistanceSq) {
                              minDistanceSq = distSq;
                              target = enemy;
                          }
                       });

                       if (target) {
                           tower.lastAttack = now;
                           firingIds.add(tower.id);
                           const projectileType = tower.specId.includes('sniper') ? 'arrow' : 'beam';
                           newAttacks.push({ id: crypto.randomUUID(), towerId: tower.id, targetId: target.id, targetPosition: target.position, elements: tower.elements, projectile: projectileType });
                           
                            setEnemies(es => {
                                let chainTargets: string[] = [target!.id]; // Keep track of who was hit in this chain
                                let lastHitEnemyId = target!.id;

                                const applyDamage = (enemyToDamage: Enemy, damageAmount: number, towerEffect?: TowerEffect) => {
                                    const armorShred = enemyToDamage.effects.find(ef => ef.type === 'armor_shred')?.potency ?? 0;
                                    const vulnerability = enemyToDamage.effects.find(ef => ef.type === 'vulnerability')?.potency ?? 0;
                                    
                                    const effectiveArmor = Math.max(0, enemyToDamage.armor * (1 - armorShred));
                                    let finalDamage = Math.max(1, damageAmount - effectiveArmor);
                                    finalDamage *= (1 + vulnerability);

                                    const newHealth = enemyToDamage.health - finalDamage;
                                    newDamageNumbers.push({ id: crypto.randomUUID(), amount: finalDamage, targetId: enemyToDamage.id, color: '#fff' } as DamageNumber);

                                    let newEffects = [...enemyToDamage.effects];
                                    if (towerEffect) {
                                        const { type, chance = 1, duration = 0, potency = 0 } = towerEffect;
                                        if (Math.random() < chance) {
                                            const existingEffectIndex = newEffects.findIndex(ef => ef.type === type);
                                            if (existingEffectIndex !== -1) {
                                                newEffects[existingEffectIndex] = { ...newEffects[existingEffectIndex], expires: now + duration, potency: Math.max(newEffects[existingEffectIndex].potency, potency) };
                                            } else {
                                                newEffects.push({ type, expires: now + duration, potency, duration });
                                            }
                                        }
                                    }
                                    return { ...enemyToDamage, health: newHealth, wasHit: true, effects: newEffects };
                                };
                                
                                const updatedEnemies = es.map(e => e.id === target!.id ? applyDamage(e, tower.damage, tower.effect) : e);

                                // Chain logic
                                if (tower.effect?.type === 'chain' && tower.effect.bounces) {
                                    for (let i = 0; i < tower.effect.bounces; i++) {
                                        let nextTarget: Enemy | null = null;
                                        let closestDistSq = Infinity;
                                        const lastHitEnemy = updatedEnemies.find(e => e.id === lastHitEnemyId);
                                        if (!lastHitEnemy) break;

                                        updatedEnemies.forEach(potentialTarget => {
                                            if (!chainTargets.includes(potentialTarget.id)) {
                                                const distSq = (lastHitEnemy.position.col - potentialTarget.position.col)**2 + (lastHitEnemy.position.row - potentialTarget.position.row)**2;
                                                if (distSq < closestDistSq && distSq <= tower.range ** 2) {
                                                    closestDistSq = distSq;
                                                    nextTarget = potentialTarget;
                                                }
                                            }
                                        });

                                        if (nextTarget) {
                                            const chainDamage = tower.damage * (tower.effect.potency ?? 0.5);
                                            const chainTargetId = nextTarget.id;
                                            
                                            // Find the enemy in the array and update it
                                            const targetIndex = updatedEnemies.findIndex(e => e.id === chainTargetId);
                                            if (targetIndex > -1) {
                                               updatedEnemies[targetIndex] = applyDamage(updatedEnemies[targetIndex], chainDamage);
                                            }

                                            newAttacks.push({ id: crypto.randomUUID(), towerId: tower.id, targetId: chainTargetId, isChain: true, chainSourceId: lastHitEnemyId, targetPosition: nextTarget.position, elements: tower.elements, projectile: 'chain' });
                                            chainTargets.push(chainTargetId);
                                            lastHitEnemyId = chainTargetId;
                                        } else {
                                            break; // No more targets in range
                                        }
                                    }
                                }
                                return updatedEnemies;
                            });
                       }
                   }
              });

              if(firingIds.size > 0) gameBoardRef.current?.queueAttacks(newAttacks);
              if(newDamageNumbers.length > 0) gameBoardRef.current?.queueDamageNumbers(newDamageNumbers);

              return newTowers;
          });

          setHostRevision(r => r + 1);
      };

      gameLoopRef.current = requestAnimationFrame(gameLoop);

      return () => {
          if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
      }
  }, [isGameHost, gameStatus, isIntermission, enemies, user, gameId, difficulty, towersByCell]);


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
                spawnedThisWave={pendingSpawnRef.current.length > 0 ? (waves[currentWave]?.enemies.count || 0) - pendingSpawnRef.current.length : 0}
                totalEnemiesInWave={waves[currentWave]?.enemies.count || 0}
                totalKilled={totalKilled}
                totalLeaked={totalLeaked}
                isIntermission={isIntermission} 
                waveStartCountdown={Math.max(0, Math.ceil(waveStartCountdown))}
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
                    isOpen={gameStatus === 'picking-element'}
                    onElementPick={onElementPick}
                    playerName={localPlayer.name}
                    currentWave={currentWave}
                    unlockedElements={new Set(localPlayer.unlockedElements)}
                />
            )}
      </div>
  );
}
