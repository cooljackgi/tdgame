
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

export type GameStatus = 'waiting' | 'playing' | 'paused' | 'gameover' | 'picking-element' | 'archived';

const towersToArray = (towersByCell: Record<string, PlacedTower> | undefined): PlacedTower[] => {
    if (!towersByCell) return [];
    return Object.values(towersByCell);
}

type GameSessionProps = {
    // --- Initial State & Config ---
    initialPlayers: Player[];
    initialGameState: GameState;
    initialTowersByCell: Record<string, PlacedTower>;
    initialEnemies: Enemy[];
    initialCurrentWave: number;
    initialDifficulty: Difficulty;
    initialIsIntermission: boolean;
    initialWaveStartCountdown: number;

    isCoop: boolean;
    isGameHost: boolean;
    localPlayerId: Player['id'] | null;
    isCheating?: boolean;
    user: User | null;

    // --- Control Functions from Parent ---
    onExit: () => void;
    onLocalAction: (action: 'build' | 'upgrade' | 'sell', payload: any) => void;
    onFocusTower: (tower: PlacedTower) => void;
    cancelInteractions: () => void;
    onSelectTowerToBuild: (tower: Tower | null) => void;
    
    // --- CO-OP ONLY Props ---
    broadcastGameData?: (deltas: GameDelta[], reliable?: boolean) => void;
    applyDeltas?: (deltas: GameDelta[]) => void;
    onGameEnd?: (result: GameResult) => void;
    
    // --- VFX State (passed down from parent in CO-OP) ---
    damageNumbersFromParent?: DamageNumber[];
    splashRingsFromParent?: SplashRing[];
    lastUpgradedTowerIdFromParent?: string | null;
    justPlacedTowerIdFromParent?: string | null;
    firingTowerIdsFromParent?: Set<string>;
    
    // --- Stats (passed down from parent in CO-OP) ---
    fpsFromParent?: number;
    isWsConnected?: boolean;
    hostPacketsPerSecond?: number;
    hostBytesSentPerSecond?: number;
    clientPacketsPerSecond?: number;
    clientBytesReceivedPerSecond?: number;
    averagePacketSize?: number;
    finalGameResultFromParent?: GameResult | null;
    totalKilledFromParent?: number;
    totalLeakedFromParent?: number;

    allTowers: Tower[];
    selectedTowerToBuild: Tower | null;
    focusedTower: PlacedTower | null;
}

export function GameSession(props: GameSessionProps) {
  
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  // --- Core Game State ---
  const [players, setPlayers] = useState(props.initialPlayers);
  const [gameState, setGameState] = useState(props.initialGameState);
  const [towersByCell, setTowersByCell] = useState(props.initialTowersByCell);
  const [enemies, setEnemies] = useState(props.initialEnemies);
  const [currentWave, setCurrentWave] = useState(props.initialCurrentWave);
  const [difficulty, setDifficulty] = useState(props.initialDifficulty);
  const [isIntermission, setIsIntermission] = useState(props.initialIsIntermission);
  const [waveStartCountdown, setWaveStartCountdown] = useState(props.initialWaveStartCountdown);
  const [gameStatus, setGameStatus] = useState<GameStatus>('playing');
  const [finalGameResult, setFinalGameResult] = useState<GameResult | null>(null);

  // --- UI/Interaction State ---
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // --- VFX State ---
  const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
  const [splashRings, setSplashRings] = useState<SplashRing[]>([]);
  const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string | null>(null);
  const [justPlacedTowerId, setJustPlacedTowerId] = useState<string | null>(null);
  const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());

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
  const isIntermissionRef = useRef(isIntermission);
  
  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { towersByCellRef.current = towersByCell; }, [towersByCell]);
  useEffect(() => { enemiesRef.current = enemies; }, [enemies]);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  useEffect(() => { currentWaveRef.current = currentWave; }, [currentWave]);
  useEffect(() => { difficultyRef.current = difficulty; }, [difficulty]);
  useEffect(() => { gameStatusRef.current = gameStatus; }, [gameStatus]);
  useEffect(() => { isIntermissionRef.current = isIntermission; }, [isIntermission]);
  
  const allTowers = props.allTowers;
  const placedTowers = useMemo(() => towersToArray(towersByCell), [towersByCell]);
  const currentPath = useMemo(() => findPath({ row: 1, col: 1 }, { row: GRID_ROWS, col: GRID_COLS }, placedTowers.map(t => t.position), GRID_ROWS, GRID_COLS) || [], [placedTowers]);
  const localPlayer = useMemo(() => players.find(p => p.id === props.localPlayerId), [players, props.localPlayerId]);

  useEffect(() => {
    // Sync state from props for coop mode
    if (props.isCoop) {
        setPlayers(props.initialPlayers);
        setGameState(props.initialGameState);
        setTowersByCell(props.initialTowersByCell);
        setCurrentWave(props.initialCurrentWave);
        setDifficulty(props.initialDifficulty);
        setIsIntermission(props.initialIsIntermission);
        setWaveStartCountdown(props.initialWaveStartCountdown);
        setJustPlacedTowerId(props.justPlacedTowerIdFromParent || null);
    }
  }, [
      props.isCoop, props.initialPlayers, props.initialGameState, 
      props.initialTowersByCell, props.initialCurrentWave, 
      props.initialDifficulty, props.initialIsIntermission, props.initialWaveStartCountdown,
      props.justPlacedTowerIdFromParent,
  ]);


  const saveGameState = useCallback(() => {
    if (gameStatusRef.current === 'gameover' || props.isCheating || props.isCoop) return;
    const stateToSave: GameSaveState = {
        players: { player1: playersRef.current[0], player2: null },
        gameState: gameStateRef.current, towersByCell: towersByCellRef.current,
        enemies: enemiesRef.current, currentWave: currentWaveRef.current, difficulty: difficultyRef.current
    };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stateToSave));
    toast({ title: 'Spiel gespeichert!' });
  }, [props.isCheating, props.isCoop, toast]);

  const handleGameEnd = useCallback(async (result: GameResult) => {
    if (gameStatusRef.current !== 'gameover') {
        setGameStatus('gameover');
        if (!props.isCoop) {
            localStorage.removeItem(LOCAL_STORAGE_KEY);
            if (props.user && !props.isCheating) {
                try {
                    await addDoc(collection(db, "scores"), { ...result, date: serverTimestamp() });
                } catch(e) { console.error("Failed to save score", e); }
            }
        }
        setFinalGameResult({ ...result, date: new Date().toISOString() });
    }
  }, [props.isCoop, props.user, props.isCheating]);

  // Game Loop: Only for Single-Player and Co-op Host
  useEffect(() => {
    if (!props.isGameHost) return;

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
        
        if (isIntermissionRef.current) {
            setWaveStartCountdown(prev => {
                const newTime = prev - delta / 1000;
                if (newTime <= 0) {
                    setIsIntermission(false);
                    audioManager.playWaveMusic();
                    return 0;
                }
                return newTime;
            });
            return;
        }

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
                    handleGameEnd({ playerName: playersRef.current[0].name, playerUid: props.user?.uid || 'anon', date: new Date().toISOString(), difficulty: difficultyRef.current, wave: currentWaveRef.current + 1, won: false, finalTowers: towersByCellRef.current });
                    return { lives: 0 };
                }
                return { lives: newLives };
            });
        }
        
        setTowersByCell(currentTowers => {
            const towersCopy = { ...currentTowers };
            Object.values(towersCopy).forEach(tower => {
                if (now - tower.lastAttack >= tower.attackSpeed) {
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
                handleGameEnd({ playerName: playersRef.current[0].name, playerUid: props.user?.uid || 'anon', date: new Date().toISOString(), difficulty: difficultyRef.current, wave: waves.length, won: true, finalTowers: towersByCellRef.current });
            } else {
                if ((nextWave + 1) % 5 === 0 && ALL_PICKABLE_ELEMENTS.some(e => !playersRef.current[0].unlockedElements.includes(e))) {
                    setGameStatus('picking-element');
                } else {
                    setCurrentWave(nextWave);
                    setIsIntermission(true);
                    setWaveStartCountdown(INTERMISSION_TIME);
                    saveGameState();
                }
            }
        }
    };
    
    gameLoopRef.current = requestAnimationFrame(gameLoop);
    return () => { if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current); };
  }, [props.isGameHost, currentPath, handleGameEnd, saveGameState]);


  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (gameStatusRef.current !== 'gameover' && !props.isCheating && !props.isCoop) {
        saveGameState();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [saveGameState, props.isCheating, props.isCoop]);


  const toggleMute = useCallback(() => setIsMuted(prev => { audioManager.isMuted = !prev; return !prev; }), []);
  const handleInteraction = useCallback(async () => { if (!hasInteracted) { await audioManager.init(); setHasInteracted(true); } }, [hasInteracted]);
  const resetGame = useCallback(() => { audioManager.stopMusic(); props.onExit(); }, [props.onExit]);
  
  const handleGameControl = useCallback(() => {
    audioManager.playSfx('build_tower');
    setGameStatus(prev => (prev === 'playing' ? 'paused' : 'playing'));
  }, []);

  const handleStartNextWaveNow = useCallback(() => {
    if (isIntermission && gameStatus === 'playing') {
        setIsIntermission(false);
        setWaveStartCountdown(0);
        audioManager.playWaveMusic();
    }
  }, [isIntermission, gameStatus]);
  
  if (!localPlayer) return null;

  const isSpectator = props.localPlayerId === 'spectator';
  const interactionPrompt = isSpectator ? 'Du schaust zu.' : props.selectedTowerToBuild ? `Wähle Bauplatz für: ${props.selectedTowerToBuild?.name}` : props.focusedTower ? `Fokus: ${props.focusedTower?.name}` : 'Wähle einen Turm zum Bauen';
  const LayoutComponent = isMobile ? MobileLayout : DesktopLayout;

  const handlePlaceTower = (row: number, col: number) => {
    if (props.selectedTowerToBuild) {
        props.onLocalAction('build', { row, col, towerId: props.selectedTowerToBuild.id });
    }
  }

  const handleUpgradeTower = (upgradeId: string) => {
    if (props.focusedTower) {
        props.onLocalAction('upgrade', { row: props.focusedTower.position.row, col: props.focusedTower.position.col, upgradeId });
    }
  };

  const handleSellTower = () => {
    if (props.focusedTower) {
        props.onLocalAction('sell', { row: props.focusedTower.position.row, col: props.focusedTower.position.col });
    }
  };

  return (
    <div className="flex flex-col h-full bg-background text-foreground font-body" onClick={handleInteraction}>
      <Header isMobile={isMobile} onExit={resetGame} fps={props.isCoop ? (props.fpsFromParent || 0) : fps} isMuted={isMuted} toggleMute={toggleMute} />
      <main className="flex-grow md:p-6 h-[calc(100%-69px)]">
        <LayoutComponent
            players={players} setPlayers={setPlayers} gameState={gameState} localPlayer={localPlayer}
            currentWave={currentWave} totalWaves={waves.length} difficulty={difficulty} 
            handleGameControl={handleGameControl} gameStatus={gameStatus} resetGame={resetGame}
            towers={allTowers} setTowers={() => {}} 
            placedTowers={placedTowers} enemies={enemies} 
            damageNumbers={props.isCoop ? (props.damageNumbersFromParent || []) : damageNumbers} 
            splashRings={props.isCoop ? (props.splashRingsFromParent || []) : splashRings}
            currentPath={currentPath} handlePlaceTower={handlePlaceTower}
            onFocusTower={props.onFocusTower} selectedTowerToBuild={props.selectedTowerToBuild}
            focusedTower={props.focusedTower}
            gameBoardRef={gameBoardRef}
            interactionPrompt={interactionPrompt} cancelInteractions={props.cancelInteractions}
            onSelectTowerToBuild={props.onSelectTowerToBuild} 
            handleUpgradeTower={handleUpgradeTower}
            handleSellTower={handleSellTower}
            setFocusedTower={() => {}}
            spawnedThisWave={spawnedThisWave} totalEnemiesInWave={waves[currentWave]?.enemies.count || 0}
            totalKilled={props.isCoop ? (props.totalKilledFromParent || 0) : totalKilled} 
            totalLeaked={props.isCoop ? (props.totalLeakedFromParent || 0) : totalLeaked}
            isIntermission={isIntermission} waveStartCountdown={waveStartCountdown}
            intermissionTime={INTERMISSION_TIME} handleStartNextWaveNow={handleStartNextWaveNow}
            lastUpgradedTowerId={props.isCoop ? (props.lastUpgradedTowerIdFromParent || null) : lastUpgradedTowerId}
            justPlacedTowerId={props.justPlacedTowerIdFromParent}
            isCoop={props.isCoop} playerRole={props.localPlayerId}
            handleLoadTestLayout={() => {}} handleLoadAllTowersLayout={() => {}}
            isCheating={!!props.isCheating} cheat_addResources={() => {}} cheat_skipWaves={() => {}} cheat_heal={() => {}} cheat_unlockAll={() => {}}
            firingTowerIds={props.isCoop ? (props.firingTowerIdsFromParent || new Set()) : firingTowerIds} allTowers={allTowers}
            isWsConnected={props.isWsConnected} hostPacketsPerSecond={props.hostPacketsPerSecond} clientPacketsPerSecond={props.clientPacketsPerSecond}
            averagePacketSize={props.averagePacketSize} hostBytesSentPerSecond={props.hostBytesSentPerSecond} clientBytesReceivedPerSecond={props.clientBytesReceivedPerSecond}
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
          {(props.isCoop ? props.finalGameResultFromParent : finalGameResult)?.finalTowers && (
             <div className="flex flex-col items-center gap-2"><p className="text-sm font-semibold text-muted-foreground">Dein finales Spielfeld:</p><ScoreboardMiniMap towersByCell={(props.isCoop ? props.finalGameResultFromParent : finalGameResult)!.finalTowers!} /></div>
          )}
          <AlertDialogFooter><AlertDialogAction onClick={resetGame}>Zum Hauptmenü</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {localPlayer && !isSpectator && <ElementPickDialog
        isOpen={gameStatus === 'picking-element'}
        unlockedElements={new Set(localPlayer.unlockedElements)}
        onElementPick={handleElementPick}
        playerName={localPlayer.name}
        currentWave={currentWave}
      />}
    </div>
  );
}
