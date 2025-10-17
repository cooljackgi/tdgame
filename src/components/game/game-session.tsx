
"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Header from '@/components/game/header';
import type { Tower, PlacedTower, Enemy, Node, Element, Difficulty, Attack, DamageNumber, SplashRing, GameSaveState, GameResult, GameResultWithId, GameDelta, EnemyStatusEffect, MovementPattern } from '@/lib/game-data/types';
import { DeltaType } from '@/lib/game-data/types';
import { waves } from '@/lib/game-data/enemies';
// import { towers as initialTowers } from '@/lib/game-data/towers';
import { difficultyModifiers, elementProjectileColors, ALL_PICKABLE_ELEMENTS, INTERMISSION_TIME, GRID_ROWS, GRID_COLS, LOCAL_STORAGE_KEY } from '@/lib/game-data/constants';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { DesktopLayout } from '@/components/layouts/desktop-layout';
import { MobileLayout } from '@/components/layouts/mobile-layout';
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ElementPickDialog } from './element-pick-dialog';
import { audioManager } from '@/lib/audio/audio-manager';
import { findPath } from '@/lib/pathfinding';
import ScoreboardMiniMap from './ScoreboardMiniMap';
import type { User } from 'firebase/auth';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import GameBoard, { type GameBoardHandle } from './game-board';


export type Player = {
  id: 'player1' | 'player2' | 'spectator';
  name: string;
  avatarUrl: string | null;
  resources: number;
  unlockedElements: Element[];
};

export type GameState = {
  lives: number;
}

export type GameStatus = 'waiting' | 'playing' | 'paused' | 'gameover' | 'picking-element';

const towersToArray = (towersByCell: Record<string, PlacedTower> | undefined): PlacedTower[] => {
    if (!towersByCell) return [];
    return Object.values(towersByCell);
}

type GameSessionProps = {
    // --- Initial State (SP) or Managed State (Coop) ---
    players: Player[];
    setPlayers: React.Dispatch<React.SetStateAction<Player[]>>;
    gameState: GameState;
    setGameState: React.Dispatch<React.SetStateAction<GameState>>;
    towersByCell: Record<string, PlacedTower>;
    setTowersByCell: React.Dispatch<React.SetStateAction<Record<string, PlacedTower>>>;
    enemies: Enemy[];
    setEnemies: React.Dispatch<React.SetStateAction<Enemy[]>>;
    currentWave: number;
    setCurrentWave: React.Dispatch<React.SetStateAction<number>>;
    difficulty: Difficulty;
    gameStatus: GameStatus;
    setGameStatus: React.Dispatch<React.SetStateAction<GameStatus>>;

    // --- Config ---
    isCoop: boolean;
    isGameHost: boolean;
    localPlayerId: Player['id'] | null;
    isCheating?: boolean;
    user: User | null;
    allTowers: Tower[];
    initialEnemies: Enemy[];

    // --- Control Functions from Parent ---
    onExit: () => void;
    onPlaceTower: (row: number, col: number) => void;
    onUpgradeTower: (upgradeId: string) => void;
    onSellTower: () => void;
    onFocusTower: (tower: PlacedTower) => void;
    cancelInteractions: () => void;
    onSelectTowerToBuild: (tower: Tower | null) => void;
    onElementPick: (element: Element) => void;
    
    // --- VFX State & Interaction State (passed down from parent) ---
    selectedTowerToBuild: Tower | null;
    focusedTower: PlacedTower | null;
    justPlacedTowerId: string | null;
    lastUpgradedTowerId: string | null;
    
    // --- CO-OP ONLY Props ---
    broadcastGameData?: (deltas: GameDelta[], reliable?: boolean) => void;
    applyDeltas?: (deltas: GameDelta[]) => void;
    onGameEnd?: (result: GameResult) => void;
    
    // --- Stats (passed down from parent in CO-OP) ---
    isWsConnected?: boolean;
    hostPacketsPerSecond?: number;
    hostBytesSentPerSecond?: number;
    clientPacketsPerSecond?: number;
    clientBytesReceivedPerSecond?: number;
    averagePacketSize?: number;
}

export function GameSession(props: GameSessionProps) {
  
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  // --- De-structure all props ---
  const {
      players, setPlayers, gameState, setGameState, towersByCell, setTowersByCell,
      enemies, setEnemies, currentWave, setCurrentWave, difficulty, gameStatus, setGameStatus,
      isCoop, isGameHost, localPlayerId, isCheating, user, allTowers, initialEnemies,
      onExit, onPlaceTower, onUpgradeTower, onSellTower, onFocusTower, cancelInteractions,
      onSelectTowerToBuild, onElementPick,
      selectedTowerToBuild, focusedTower, justPlacedTowerId, lastUpgradedTowerId,
      broadcastGameData,
      isWsConnected, hostPacketsPerSecond, hostBytesSentPerSecond, clientPacketsPerSecond, clientBytesReceivedPerSecond, averagePacketSize
  } = props;
  
  // --- UI/Interaction State ---
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // --- VFX State ---
  const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
  const [splashRings, setSplashRings] = useState<SplashRing[]>([]);
  const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());
  const [finalGameResult, setFinalGameResult] = useState<GameResult | null>(null);

  // --- Stats State ---
  const [fps, setFps] = useState(0);
  const [totalKilled, setTotalKilled] = useState(0);
  const [totalLeaked, setTotalLeaked] = useState(0);
  const [spawnedThisWave, setSpawnedThisWave] = useState(0);

  // --- Game Loop Refs ---
  const gameLoopRef = useRef<number>();
  const lastTickRef = useRef(performance.now());
  const spawnerStateRef = useRef<{ count: number; timer: number; waveData: any } | null>(null);
  const enemyIdCounter = useRef(0);
  const gameBoardRef = useRef<GameBoardHandle>(null);

  // --- Create stable refs for game loop access ---
  const playersRef = useRef(players);
  const towersByCellRef = useRef(towersByCell);
  const enemiesRef = useRef(enemies);
  const gameStateRef = useRef(gameState);
  const currentWaveRef = useRef(currentWave);
  const difficultyRef = useRef(difficulty);
  const gameStatusRef = useRef(gameStatus);
  
  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { towersByCellRef.current = towersByCell; }, [towersByCell]);
  useEffect(() => { enemiesRef.current = enemies; }, [enemies]);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  useEffect(() => { currentWaveRef.current = currentWave; }, [currentWave]);
  useEffect(() => { difficultyRef.current = difficulty; }, [difficulty]);
  useEffect(() => { gameStatusRef.current = gameStatus; }, [gameStatus]);
  
  const placedTowers = useMemo(() => towersToArray(towersByCell), [towersByCell]);
  const currentPath = useMemo(() => findPath({ row: 1, col: 1 }, { row: GRID_ROWS, col: GRID_COLS }, placedTowers.map(t => t.position), GRID_ROWS, GRID_COLS) || [], [placedTowers]);
  const localPlayer = useMemo(() => players.find(p => p.id === localPlayerId), [players, localPlayerId]);
  
  const isIntermission = useMemo(() => {
    if (spawnerStateRef.current) return false;
    if (enemies.length > 0) return false;
    return true;
  }, [enemies]);
  
  const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);


  const saveGameState = useCallback(() => {
    if (gameStatusRef.current === 'gameover' || isCheating || isCoop) return;
    const stateToSave: GameSaveState = {
        players: { player1: playersRef.current[0], player2: null },
        gameState: gameStateRef.current, towersByCell: towersByCellRef.current,
        enemies: enemiesRef.current, currentWave: currentWaveRef.current, difficulty: difficultyRef.current
    };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stateToSave));
    toast({ title: 'Spiel gespeichert!' });
  }, [isCheating, isCoop, toast]);

  const handleGameEnd = useCallback(async (result: GameResult) => {
    if (gameStatusRef.current !== 'gameover') {
        setGameStatus('gameover');
        if (!isCoop) {
            localStorage.removeItem(LOCAL_STORAGE_KEY);
            if (user && !isCheating) {
                try {
                    await addDoc(collection(db, "scores"), { ...result, date: serverTimestamp() });
                } catch(e) { console.error("Failed to save score", e); }
            }
        }
        setFinalGameResult({ ...result, date: new Date().toISOString() });
    }
  }, [isCoop, user, isCheating]);

  // Game Loop: Only for Single-Player and Co-op Host
  useEffect(() => {
    if (!isGameHost) {
        setEnemies(initialEnemies);
        return;
    }

    const gameLoop = (now: number) => {
        gameLoopRef.current = requestAnimationFrame(gameLoop);
        if (gameStatusRef.current !== 'playing') {
            lastTickRef.current = now;
            return;
        }

        const delta = now - lastTickRef.current;
        if (delta < 1000/65) return; // ~60fps cap
        lastTickRef.current = now;
        setFps(Math.round(1000 / delta));
        
        const isCurrentlyIntermission = enemiesRef.current.length === 0 && !spawnerStateRef.current;

        if (isCurrentlyIntermission) {
            setWaveStartCountdown(prev => {
                const newTime = prev - delta / 1000;
                if (newTime <= 0) {
                    audioManager.playWaveMusic();
                    return 0;
                }
                return newTime;
            });
            return;
        }
        
        if (waveStartCountdown > 0) setWaveStartCountdown(0);


        if (!spawnerStateRef.current) {
            const waveData = waves[currentWaveRef.current];
            if (waveData) {
                spawnerStateRef.current = { count: 0, timer: 0, waveData: waveData.enemies };
                setSpawnedThisWave(0);
            }
        }
        if (spawnerStateRef.current && currentPath.length > 0) {
            spawnerStateRef.current.timer += delta;
            if (spawnerStateRef.current.timer >= spawnerStateRef.current.waveData.spawnDelay) {
                if (spawnerStateRef.current.count < spawnerStateRef.current.waveData.count) {
                    spawnerStateRef.current.timer = 0;
                    const difficultyMod = difficultyModifiers[difficultyRef.current];
                    const health = Math.round(spawnerStateRef.current.waveData.health * difficultyMod.enemyHealth);
                    const newEnemy: Enemy = {
                        id: `enemy-${currentWaveRef.current}-${enemyIdCounter.current++}`, ...spawnerStateRef.current.waveData,
                        health, maxHealth: health, path: currentPath, pathIndex: 0, position: {row: 1, col: 1},
                        isBlocked: false, effects: [], lastMove: now, wasHit: false, targetNode: {row: GRID_ROWS, col: GRID_COLS},
                        movementPattern: spawnerStateRef.current.waveData.type === 'schnell' ? 'zigzag' : 'wobble'
                    };
                    setEnemies(prev => [...prev, newEnemy]);
                    setSpawnedThisWave(prev => prev + 1);
                    spawnerStateRef.current.count++;
                }
            }
        }

        let livesLost = 0;
        let newDamageNumbers: DamageNumber[] = [];
        let newFiringTowerIds = new Set<string>();

        setEnemies(currentEnemies => {
            const nextEnemies = [];
            for (const enemy of currentEnemies) {
                if (enemy.health <= 0) {
                    setPlayers(prev => prev.map(p => ({...p, resources: p.resources + enemy.bounty})));
                    setTotalKilled(k => k + 1);
                    continue;
                }
                if (enemy.pathIndex >= currentPath.length - 1) {
                    livesLost++;
                    setTotalLeaked(l => l + 1);
                    continue;
                }
                const slowEffect = enemy.effects.find(e => e.type === 'slow' && e.expires > now);
                const effectiveSpeed = enemy.speed * (slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1);
                
                let updatedEnemy = enemy;
                if (now - enemy.lastMove >= 1000 / effectiveSpeed) {
                    const newPathIndex = enemy.pathIndex + 1;
                    updatedEnemy = {...enemy, pathIndex: newPathIndex, position: currentPath[newPathIndex], lastMove: now, wasHit: false};
                }
                nextEnemies.push({...updatedEnemy, wasHit: false});
            }
            return nextEnemies;
        });

        if (livesLost > 0) {
            setGameState(prev => {
                const newLives = prev.lives - livesLost;
                if (newLives <= 0) {
                    handleGameEnd({ playerName: playersRef.current[0].name, playerUid: user?.uid || 'anon', date: new Date().toISOString(), difficulty: difficultyRef.current, wave: currentWaveRef.current + 1, won: false, finalTowers: towersByCellRef.current });
                    return { lives: 0 };
                }
                return { lives: newLives };
            });
        }
        
        setTowersByCell(currentTowers => {
            const towersCopy = { ...currentTowers };
            Object.values(towersCopy).forEach(tower => {
                if (tower.damage > 0 && now - tower.lastAttack >= tower.attackSpeed) {
                    const targets = enemiesRef.current.filter(e => {
                        const distSq = (tower.position.col - e.position.col) ** 2 + (tower.position.row - e.position.row) ** 2;
                        return distSq <= tower.range ** 2;
                    });
                    if (targets.length > 0) {
                        const mainTarget = targets.sort((a,b) => b.pathIndex - a.pathIndex)[0];
                        tower.lastAttack = now;
                        
                        const specId = tower.specId || tower.id;
                        const projectileType = (specId.includes('-1a') || specId.includes('-2a') || specId.includes('-1b') || specId.includes('-2b')) ? 'arrow' : 'beam';
                        
                        gameBoardRef.current?.queueAttacks([{ id: `attack-${now}-${Math.random()}`, towerId: tower.id, targetId: mainTarget.id, targetPosition: mainTarget.position, elements: tower.elements, projectile: projectileType }]);
                        newFiringTowerIds.add(tower.id);
                        audioManager.playSfx('shoot', 0.3);
                        
                        setEnemies(currentEnemies => currentEnemies.map(e => {
                           if (e.id === mainTarget.id) {
                               newDamageNumbers.push({ id: `dmg-${now}-${Math.random()}`, targetId: e.id, amount: tower.damage, color: elementProjectileColors[tower.elements[0]] || 'white', position: e.position });
                               return {...e, health: e.health - tower.damage, wasHit: true};
                           }
                           return e;
                        }));
                    }
                }
            });
            return towersCopy;
        });
        
        setDamageNumbers(prev => [...prev.slice(-100), ...newDamageNumbers]);
        setFiringTowerIds(newFiringTowerIds);
        setTimeout(() => setFiringTowerIds(new Set()), 150);

        if (spawnerStateRef.current && spawnerStateRef.current.count >= spawnerStateRef.current.waveData.count && enemiesRef.current.length === 0) {
            spawnerStateRef.current = null;
            const nextWave = currentWaveRef.current + 1;
            if (nextWave >= waves.length) {
                handleGameEnd({ playerName: playersRef.current[0].name, playerUid: user?.uid || 'anon', date: new Date().toISOString(), difficulty: difficultyRef.current, wave: waves.length, won: true, finalTowers: towersByCellRef.current });
            } else {
                if ((nextWave + 1) % 5 === 0 && ALL_PICKABLE_ELEMENTS.some(e => !playersRef.current[0].unlockedElements.includes(e))) {
                    setGameStatus('picking-element');
                } else {
                    setCurrentWave(nextWave);
                    setWaveStartCountdown(INTERMISSION_TIME);
                    saveGameState();
                }
            }
        }
    };
    
    gameLoopRef.current = requestAnimationFrame(gameLoop);
    return () => { if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current); };
  }, [isGameHost, currentPath, handleGameEnd, saveGameState, user, initialEnemies, waveStartCountdown]);


  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (gameStatusRef.current !== 'gameover' && !isCheating && !isCoop) {
        saveGameState();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [saveGameState, isCheating, isCoop]);


  const toggleMute = useCallback(() => setIsMuted(prev => { audioManager.isMuted = !prev; return !prev; }), []);
  const handleInteraction = useCallback(async () => { if (!hasInteracted) { await audioManager.init(); setHasInteracted(true); } }, [hasInteracted]);
  const resetGame = useCallback(() => { audioManager.stopMusic(); onExit(); }, [onExit]);
  
  const handleGameControl = useCallback(() => {
    audioManager.playSfx('build_tower');
    setGameStatus(prev => (prev === 'playing' ? 'paused' : 'playing'));
  }, [setGameStatus]);

  const handleStartNextWaveNow = useCallback(() => {
    if (isIntermission && gameStatus === 'playing') {
        setWaveStartCountdown(0);
        audioManager.playWaveMusic();
    }
  }, [isIntermission, gameStatus]);
  
  if (!localPlayer) return null;

  const isSpectator = localPlayerId === 'spectator';
  const interactionPrompt = isSpectator ? 'Du schaust zu.' : selectedTowerToBuild ? `Wähle Bauplatz für: ${selectedTowerToBuild?.name}` : focusedTower ? `Fokus: ${focusedTower?.name}` : 'Wähle einen Turm zum Bauen';
  const LayoutComponent = isMobile ? MobileLayout : DesktopLayout;

  return (
    <div className="flex flex-col h-full bg-background text-foreground font-body" onClick={handleInteraction}>
      <Header isMobile={isMobile} onExit={resetGame} fps={isCoop ? (props.hostPacketsPerSecond || 0) : fps} isMuted={isMuted} toggleMute={toggleMute} />
      <main className="flex-grow md:p-6 h-[calc(100%-69px)]">
        <LayoutComponent
            players={players} setPlayers={setPlayers} gameState={gameState} localPlayer={localPlayer}
            currentWave={currentWave} totalWaves={waves.length} difficulty={difficulty} 
            handleGameControl={handleGameControl} gameStatus={gameStatus} resetGame={resetGame}
            towers={allTowers} setTowers={() => {}} 
            placedTowers={placedTowers} enemies={enemies} 
            damageNumbers={damageNumbers} 
            splashRings={splashRings}
            currentPath={currentPath} handlePlaceTower={onPlaceTower}
            onFocusTower={onFocusTower} selectedTowerToBuild={selectedTowerToBuild}
            focusedTower={focusedTower}
            gameBoardRef={gameBoardRef}
            interactionPrompt={interactionPrompt} cancelInteractions={cancelInteractions}
            onSelectTowerToBuild={onSelectTowerToBuild} 
            handleUpgradeTower={onUpgradeTower}
            handleSellTower={onSellTower}
            setFocusedTower={() => {}} // This is managed by parent
            spawnedThisWave={spawnedThisWave} totalEnemiesInWave={waves[currentWave]?.enemies.count || 0}
            totalKilled={totalKilled} 
            totalLeaked={totalLeaked}
            isIntermission={isIntermission} waveStartCountdown={Math.ceil(waveStartCountdown)}
            intermissionTime={INTERMISSION_TIME} handleStartNextWaveNow={handleStartNextWaveNow}
            lastUpgradedTowerId={lastUpgradedTowerId}
            justPlacedTowerId={justPlacedTowerId}
            isCoop={isCoop} playerRole={localPlayerId}
            handleLoadTestLayout={() => {}} handleLoadAllTowersLayout={() => {}}
            isCheating={!!isCheating} cheat_addResources={() => {}} cheat_skipWaves={() => {}} cheat_heal={() => {}} cheat_unlockAll={() => {}}
            firingTowerIds={firingTowerIds} allTowers={allTowers}
            isWsConnected={isWsConnected} hostPacketsPerSecond={hostPacketsPerSecond} clientPacketsPerSecond={clientPacketsPerSecond}
            averagePacketSize={averagePacketSize} hostBytesSentPerSecond={hostBytesSentPerSecond} clientBytesReceivedPerSecond={clientBytesReceivedPerSecond}
          />
      </main>
      
      <AlertDialog open={gameStatus === 'gameover'}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{gameState.lives > 0 ? "Sieg!" : "Game Over"}</AlertDialogTitle>
            <AlertDialogDescription>
              {gameState.lives <= 0 ? "Du hast alle Leben verloren." : "Herzlichen Glückwunsch, du hast alle Wellen besiegt!"} Du hast Welle {currentWave + 1} erreicht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {(finalGameResult)?.finalTowers && (
             <div className="flex flex-col items-center gap-2"><p className="text-sm font-semibold text-muted-foreground">Dein finales Spielfeld:</p><ScoreboardMiniMap towersByCell={(finalGameResult)!.finalTowers!} /></div>
          )}
          <AlertDialogFooter><AlertDialogAction onClick={resetGame}>Zum Hauptmenü</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {localPlayer && !isSpectator && <ElementPickDialog
        isOpen={gameStatus === 'picking-element'}
        unlockedElements={new Set(localPlayer.unlockedElements)}
        onElementPick={onElementPick}
        playerName={localPlayer.name}
        currentWave={currentWave}
      />}
    </div>
  );
}
