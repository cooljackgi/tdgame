

"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import type { Difficulty, GameSaveState, User, Player, GameState, PlacedTower, Tower, Node, Element, Enemy, Attack, DamageNumber, SplashRing, MovementPattern } from '@/lib/game-data/types';
import { towers as initialTowers } from '@/lib/game-data/towers';
import { waves, generateProceduralWave, waveFormulaCoefficients } from '@/lib/game-data/enemies';
import { difficultyModifiers, GRID_COLS, GRID_ROWS, LOCAL_STORAGE_KEY, INTERMISSION_TIME } from '@/lib/game-data/constants';
import { findPath } from '@/lib/pathfinding';
import { useToast } from '@/hooks/use-toast';
import { audioManager } from '@/lib/audio/audio-manager';
import type { GameBoardHandle } from './game-board';
import { useIsMobile } from '@/hooks/use-mobile';
import { DesktopLayout } from '@/components/layouts/desktop-layout';
import { MobileLayout } from '@/components/layouts/mobile-layout';
import { ElementPickDialog } from './element-pick-dialog';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import ScoreboardMiniMap from './ScoreboardMiniMap';


export default function SinglePlayerGame({
    difficulty: initialDifficulty,
    onExit,
    initialSavedGame,
    isCheating = false,
    startWithTutorial = false,
    user
}: {
    difficulty: Difficulty,
    onExit: () => void,
    initialSavedGame: GameSaveState | null,
    isCheating?: boolean,
    startWithTutorial?: boolean,
    user: User | null
}) {
    const { toast } = useToast();
    const isMobile = useIsMobile();

    // --- Core Game State ---
    const [players, setPlayers] = useState<Player[]>([]);
    const [gameState, setGameState] = useState<GameState>({ lives: 20 });
    const [towersByCell, setTowersByCell] = useState<Record<string, PlacedTower>>({});
    const [currentWave, setCurrentWave] = useState(0);
    const [difficulty, setDifficulty] = useState(initialDifficulty);
    const [enemies, setEnemies] = useState<Enemy[]>([]);
    const [gameStatus, setGameStatus] = useState<"waiting" | "playing" | "paused" | "gameover" | "picking-element">('playing');
    const [currentPath, setCurrentPath] = useState<Node[]>([]);
    const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);
    
    // --- UI/Interaction State ---
    const [selectedTowerToBuild, setSelectedTowerToBuild] = useState<Tower | null>(null);
    const [justPlacedTowerId, setJustPlacedTowerId] = useState<string | null>(null);
    const [focusedTower, setFocusedTower] = useState<PlacedTower | null>(null);
    const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string | null>(null);
    const [hasInteracted, setHasInteracted] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [finalGameResult, setFinalGameResult] = useState<any | null>(null);


    // --- VFX State ---
    const [attacks, setAttacks] = useState<Attack[]>([]);
    const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
    const [splashRings, setSplashRings] = useState<SplashRing[]>([]);
    const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());
    
    // --- Stats State ---
    const [totalKilled, setTotalKilled] = useState(0);
    const [totalLeaked, setTotalLeaked] = useState(0);

    // --- Game Loop Refs ---
    const gameLoopRef = useRef<number>();
    const lastTickRef = useRef(performance.now());
    const spawnerStateRef = useRef<{ count: number; timer: number; waveData: any } | null>(null);
    const enemyIdCounter = useRef(0);
    const gameBoardRef = useRef<GameBoardHandle>(null);

    // --- Refs for stable access in game loop ---
    const playersRef = useRef(players);
    const towersByCellRef = useRef(towersByCell);
    const enemiesRef = useRef(enemies);
    const gameStateRef = useRef(gameState);
    const currentWaveRef = useRef(currentWave);
    const difficultyRef = useRef(difficulty);
    const gameStatusRef = useRef(gameStatus);
    const localPlayerRef = useRef<Player | undefined>(undefined);
    const currentPathRef = useRef(currentPath);

    useEffect(() => { playersRef.current = players; localPlayerRef.current = players[0]; }, [players]);
    useEffect(() => { towersByCellRef.current = towersByCell; }, [towersByCell]);
    useEffect(() => { enemiesRef.current = enemies; }, [enemies]);
    useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
    useEffect(() => { currentWaveRef.current = currentWave; }, [currentWave]);
    useEffect(() => { difficultyRef.current = difficulty; }, [difficulty]);
    useEffect(() => { gameStatusRef.current = gameStatus; }, [gameStatus]);
    useEffect(() => { currentPathRef.current = currentPath; }, [currentPath]);


    useEffect(() => {
        if (initialSavedGame) {
            setPlayers([initialSavedGame.players.player1]);
            setGameState(initialSavedGame.gameState);
            setTowersByCell(initialSavedGame.towersByCell);
            setEnemies(initialSavedGame.enemies);
            setCurrentWave(initialSavedGame.currentWave);
            setDifficulty(initialSavedGame.difficulty);
            setGameStatus('playing');
            const path = findPath({row:1,col:1},{row:GRID_ROWS,col:GRID_COLS}, Object.values(initialSavedGame.towersByCell).map(t => t.position), GRID_ROWS, GRID_COLS) ?? [];
            setCurrentPath(path);
            return;
        }

        const difficultyMod = difficultyModifiers[initialDifficulty];
        const player1: Player = {
            id: 'player1',
            name: user?.displayName || 'Spieler 1',
            resources: difficultyMod.startResources,
            unlockedElements: ['neutral'],
            avatarUrl: user?.photoURL || null,
        };

        setPlayers([player1]);
        setGameState({ lives: difficultyMod.startLives });
        setTowersByCell({});
        setEnemies([]);
        setCurrentWave(0);
        setDifficulty(initialDifficulty);
        setGameStatus('playing');
        setCurrentPath(findPath({row:1,col:1},{row:GRID_ROWS,col:GRID_COLS}, [], GRID_ROWS, GRID_COLS) ?? []);
    }, [initialSavedGame, initialDifficulty, user]);
    
    const localPlayer = useMemo(() => players.find(p => p.id === 'player1'), [players]);
    const placedTowers = useMemo(() => Object.values(towersByCell), [towersByCell]);

    const onFocusTower = (tower: PlacedTower) => {
        setSelectedTowerToBuild(null);
        setFocusedTower(tower);
    }
    
    const cancelInteractions = () => {
        setSelectedTowerToBuild(null);
        setFocusedTower(null);
    }

    const onSelectTowerToBuild = (tower: Tower | null) => {
        setFocusedTower(null);
        setSelectedTowerToBuild(tower);
    }
    
    const handlePlaceTower = useCallback((row: number, col: number) => {
        if (!selectedTowerToBuild) return;

        const player = localPlayerRef.current;
        const towerSpec = initialTowers.find(t => t.id === selectedTowerToBuild.id);

        if (!player || !towerSpec) return;

        const currentTowers = Object.values(towersByCellRef.current);
        const cellKey = `${row}_${col}`;

        if (currentTowers.some(t => t.position.row === row && t.position.col === col)) return;
        if ((row === 1 && col === 1) || (row === GRID_ROWS && col === GRID_COLS)) return;
        if (player.resources < towerSpec.cost) {
            toast({ title: 'Nicht genügend Ressourcen', variant: 'destructive'});
            return;
        }

        const newBlockedPositions = [...currentTowers.map(t => t.position), { row, col }];
        const path = findPath({ row: 1, col: 1 }, { row: GRID_ROWS, col: GRID_COLS }, newBlockedPositions, GRID_ROWS, GRID_COLS);
        if (!path) {
            toast({ title: 'Pfad blockiert', description: 'Du kannst den Weg für die Gegner nicht komplett blockieren.', variant: 'destructive'});
            return;
        }
        
        const newTower: PlacedTower = {
            ...towerSpec,
            id: `tower-${row}-${col}-${Date.now()}`,
            specId: towerSpec.id,
            position: { row, col },
            lastAttack: performance.now() - 99999,
            health: towerSpec.maxHealth,
            ownerId: player.id,
        };

        setTowersByCell(prev => ({ ...prev, [cellKey]: newTower }));
        setPlayers(prev => [{ ...prev[0], resources: prev[0].resources - towerSpec.cost }]);
        setCurrentPath(path);
        setEnemies(prevEnemies => prevEnemies.map(e => ({ ...e, path })));
        setJustPlacedTowerId(newTower.id);
        setTimeout(() => setJustPlacedTowerId(null), 500);

    }, [selectedTowerToBuild, toast]);

    const handleUpgradeTower = useCallback((upgradeId: string) => {
        const player = localPlayerRef.current;
        if (!player || !focusedTower) return;
        
        const cellKey = `${focusedTower.position.row}_${focusedTower.position.col}`;
        const upgradeTowerSpec = initialTowers.find(t => t.id === upgradeId);
        if (!upgradeTowerSpec) return;
        
        const refundPercentage = difficultyRef.current === 'Einfach' ? 1.0 : 0.75;
        const cost = Math.max(0, upgradeTowerSpec.cost - Math.floor(focusedTower.cost * refundPercentage));
        
        if (player.resources < cost) {
            toast({ title: 'Nicht genügend Ressourcen für das Upgrade.', variant: 'destructive' });
            return;
        }

        const newPlacedTower: PlacedTower = { 
            ...focusedTower, ...upgradeTowerSpec, specId: upgradeTowerSpec.id, health: upgradeTowerSpec.maxHealth, id: focusedTower.id 
        };
        
        setTowersByCell(prev => ({ ...prev, [cellKey]: newPlacedTower }));
        setPlayers(prev => [{ ...prev[0], resources: prev[0].resources - cost }]);
        setFocusedTower(newPlacedTower);
        setLastUpgradedTowerId(newPlacedTower.id);
        setTimeout(() => setLastUpgradedTowerId(null), 500);
    }, [toast, focusedTower]);

    const handleSellTower = useCallback(() => {
        const player = localPlayerRef.current;
        if (!player || !focusedTower) return;
        
        const cellKey = `${focusedTower.position.row}_${focusedTower.position.col}`;
        const refundPercentage = difficultyRef.current === 'Einfach' ? 1.0 : 0.75;
        const refund = Math.round(focusedTower.cost * refundPercentage);
        
        setTowersByCell(prev => { const newTowers = { ...prev }; delete newTowers[cellKey]; return newTowers; });
        setPlayers(prev => [{ ...prev[0], resources: prev[0].resources + refund }]);
        setFocusedTower(null);
    }, [focusedTower]);
    
    const handleElementPick = useCallback((element: Element) => {
        setPlayers(prev => [{ ...prev[0], unlockedElements: [...prev[0].unlockedElements, element] }]);
        setCurrentWave(prev => prev + 1);
        setGameStatus('playing');
        setWaveStartCountdown(INTERMISSION_TIME);
    }, []);

    const onGameEnd = useCallback(async (result: any) => {
        if(gameStatusRef.current === 'gameover') return;
        setGameStatus('gameover');
        if (!isCheating) {
            localStorage.removeItem(LOCAL_STORAGE_KEY);
            if (user?.uid) {
                 try {
                    await addDoc(collection(db, "scores"), { ...result, date: serverTimestamp() });
                } catch(e) { console.error("Failed to save score", e); }
            }
        }
        setFinalGameResult({ ...result, date: new Date().toISOString() });
    }, [isCheating, user]);

    const handleStartNextWaveNow = useCallback(() => {
      if (spawnerStateRef.current || enemiesRef.current.length > 0) return;

      const waveData = waves[currentWaveRef.current];
      if (!waveData) return;

      spawnerStateRef.current = {
        count: 0,
        timer: 0,
        waveData: waveData.enemies,
      };
      
      setWaveStartCountdown(0);
      audioManager.playWaveMusic();
    }, []);

    useEffect(() => {
        const gameLoop = () => {
            const now = performance.now();
            const delta = now - lastTickRef.current;
            lastTickRef.current = now;

            if (gameStatusRef.current !== 'playing') {
                gameLoopRef.current = requestAnimationFrame(gameLoop);
                return;
            }
            
            const isCurrentlyIntermission = !spawnerStateRef.current && enemiesRef.current.length === 0;

            if (isCurrentlyIntermission) {
                const newTime = waveStartCountdown - delta / 1000;
                 if (newTime <= 0) {
                    handleStartNextWaveNow();
                    setWaveStartCountdown(0);
                 } else {
                    setWaveStartCountdown(newTime);
                 }
            }


            if (spawnerStateRef.current && currentPathRef.current.length > 0) {
              spawnerStateRef.current.timer += delta;
              if (spawnerStateRef.current.timer >= spawnerStateRef.current.waveData.spawnDelay) {
                  if (spawnerStateRef.current.count < spawnerStateRef.current.waveData.count) {
                      spawnerStateRef.current.timer = 0;
                      const difficultyMod = difficultyModifiers[difficultyRef.current];
                      const health = Math.round(spawnerStateRef.current.waveData.health * difficultyMod.enemyHealth);
                      
                      const newEnemy: Enemy = {
                          id: `enemy-${currentWaveRef.current}-${enemyIdCounter.current++}`,
                          type: spawnerStateRef.current.waveData.type,
                          health: health,
                          maxHealth: health,
                          armor: spawnerStateRef.current.waveData.armor,
                          speed: spawnerStateRef.current.waveData.speed,
                          damage: spawnerStateRef.current.waveData.damage,
                          bounty: spawnerStateRef.current.waveData.bounty,
                          path: currentPathRef.current,
                          pathIndex: 0,
                          position: { row: 1, col: 1 },
                          isBlocked: false,
                          effects: [],
                          lastMove: now,
                          wasHit: false,
                          targetNode: { row: GRID_ROWS, col: GRID_COLS },
                          movementPattern: spawnerStateRef.current.waveData.type === 'schnell' ? 'zigzag' : 'wobble'
                      };
                      setEnemies(prev => [...prev, newEnemy]);
                      spawnerStateRef.current.count += 1;
                  }
              }
            }
            
            const newAttacks: Attack[] = [];
            const newDamageNumbers: DamageNumber[] = [];
            const newFiringTowerIds = new Set<string>();

            for (const tower of Object.values(towersByCellRef.current)) {
                if (now - tower.lastAttack >= tower.attackSpeed && enemiesRef.current.length > 0) {
                    let target: Enemy | null = null;
                    let minDistanceSq = tower.range * tower.range;

                    for (const enemy of enemiesRef.current) {
                        const distSq = (tower.position.col - enemy.position.col) ** 2 + (tower.position.row - enemy.position.row) ** 2;
                        if (distSq <= minDistanceSq) {
                            minDistanceSq = distSq;
                            target = enemy;
                        }
                    }

                    if (target) {
                        tower.lastAttack = now;
                        newFiringTowerIds.add(tower.id);
                        
                        const attackId = crypto.randomUUID();
                        const projectileType = tower.specId.includes('-1a') || tower.specId.includes('-2a') ? 'arrow' : 'beam';

                        newAttacks.push({
                            id: attackId,
                            towerId: tower.id,
                            targetId: target.id,
                            targetPosition: target.position,
                            elements: tower.elements,
                            projectile: projectileType,
                        });

                        const damage = tower.damage;
                        target.health -= Math.max(0, damage - target.armor);
                        target.wasHit = true;
                        newDamageNumbers.push({
                            id: crypto.randomUUID(),
                            amount: damage,
                            targetId: target.id,
                            color: '#ffffff',
                        } as DamageNumber);
                    }
                }
            }

            if (newFiringTowerIds.size > 0) {
                setFiringTowerIds(newFiringTowerIds);
                setTimeout(() => setFiringTowerIds(new Set()), 150);
            }
            if (newAttacks.length > 0) {
                setAttacks(newAttacks);
            }
            
            if (newDamageNumbers.length > 0) {
                setDamageNumbers(prev => [...prev, ...newDamageNumbers]);
            }

            setEnemies(prevEnemies => {
                const stillAlive: Enemy[] = [];
                let livesLost = 0;
                let resourcesGained = 0;

                for (const enemy of prevEnemies) {
                    let updatedEnemy = { ...enemy, effects: [...enemy.effects] };
                    
                    const slowEffect = updatedEnemy.effects.find(e => e.type === 'slow' && e.expires > now);
                    const speed = updatedEnemy.speed * (slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1);
                    const stepMs = 1000 / Math.max(0.001, speed);

                    if (now - updatedEnemy.lastMove >= stepMs) {
                      if (updatedEnemy.pathIndex < updatedEnemy.path.length - 1) {
                        updatedEnemy.pathIndex += 1;
                        updatedEnemy.position = updatedEnemy.path[updatedEnemy.pathIndex];
                        updatedEnemy.lastMove = now;
                      }
                    }

                    const burnEffect = updatedEnemy.effects.find(e => e.type === 'burn' && e.expires > now);
                    if (burnEffect && burnEffect.expires > now) {
                        if (!burnEffect.lastTick || now - burnEffect.lastTick >= 1000) {
                            const damage = (burnEffect.potency ?? 0) * updatedEnemy.maxHealth;
                            updatedEnemy.health -= damage;
                            burnEffect.lastTick = now;
                            newDamageNumbers.push({ id: crypto.randomUUID(), amount: damage, targetId: updatedEnemy.id, color: '#f97316' } as DamageNumber);
                        }
                    }
                    updatedEnemy.wasHit = false;

                    if (updatedEnemy.pathIndex >= updatedEnemy.path.length - 1) {
                        livesLost += 1;
                        continue;
                    }
                    if (updatedEnemy.health <= 0) {
                        resourcesGained += updatedEnemy.bounty;
                        continue;
                    }
                    stillAlive.push(updatedEnemy);
                }

                if (livesLost > 0) {
                    setTotalLeaked(prev => prev + livesLost);
                    setGameState(prev => ({...prev, lives: prev.lives - livesLost }));
                    if (gameStateRef.current.lives - livesLost <= 0) {
                        onGameEnd({ playerName: localPlayerRef.current?.name || 'Spieler', playerUid: user?.uid || 'anonymous', difficulty: difficultyRef.current, wave: currentWaveRef.current + 1, won: false, finalTowers: towersByCellRef.current });
                    }
                }
                if (resourcesGained > 0) {
                    setTotalKilled(prev => prev + (prevEnemies.length - stillAlive.length - livesLost));
                    setPlayers(prev => [{...prev[0], resources: prev[0].resources + resourcesGained}]);
                }
                return stillAlive;
            });

            if (spawnerStateRef.current && spawnerStateRef.current.count >= spawnerStateRef.current.waveData.count && enemiesRef.current.length === 0) {
                spawnerStateRef.current = null;
                const nextWave = currentWaveRef.current + 1;
                
                if (waves[nextWave]) {
                  if ((nextWave) % 5 === 0 && localPlayerRef.current && localPlayerRef.current.unlockedElements.length < 8) {
                    setGameStatus('picking-element');
                  } else {
                    setCurrentWave(nextWave);
                    setWaveStartCountdown(INTERMISSION_TIME);
                  }
                } else {
                    onGameEnd({ playerName: localPlayerRef.current?.name || 'Spieler', playerUid: user?.uid || 'anonymous', difficulty: difficultyRef.current, wave: currentWaveRef.current + 1, won: true, finalTowers: towersByCellRef.current });
                }
            }
            
            gameLoopRef.current = requestAnimationFrame(gameLoop);
        };
        gameLoopRef.current = requestAnimationFrame(gameLoop);
        return () => {
            if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
        }
    }, []);

    const LayoutComponent = isMobile ? MobileLayout : DesktopLayout;
    
    if (!localPlayer) return null;
    
    const isIntermission = !spawnerStateRef.current && enemies.length === 0;
    const interactionPrompt = selectedTowerToBuild ? `Wähle Bauplatz für: ${selectedTowerToBuild?.name}` : focusedTower ? `Fokus: ${focusedTower?.name}` : 'Wähle einen Turm zum Bauen';
    
    return (
        <div className="flex flex-col h-full bg-background text-foreground font-body" onClick={() => { if(!hasInteracted) { audioManager.init(); setHasInteracted(true); }}}>
            <LayoutComponent
                players={players} 
                setPlayers={setPlayers} 
                gameState={gameState} 
                localPlayer={localPlayer}
                currentWave={currentWave} 
                totalWaves={waves.length} 
                difficulty={difficulty} 
                handleGameControl={() => setGameStatus(prev => prev === 'playing' ? 'paused' : 'playing')} 
                gameStatus={gameStatus} 
                resetGame={onExit}
                towers={initialTowers} 
                setTowers={() => {}} 
                placedTowers={placedTowers} 
                enemies={enemies} 
                damageNumbers={damageNumbers} 
                splashRings={splashRings}
                currentPath={currentPath} 
                handlePlaceTower={(row, col) => handlePlaceTower(row, col)}
                onFocusTower={onFocusTower} 
                selectedTowerToBuild={selectedTowerToBuild}
                focusedTower={focusedTower}
                gameBoardRef={gameBoardRef}
                interactionPrompt={interactionPrompt} 
                cancelInteractions={cancelInteractions}
                onSelectTowerToBuild={onSelectTowerToBuild} 
                handleUpgradeTower={handleUpgradeTower}
                handleSellTower={handleSellTower}
                setFocusedTower={setFocusedTower}
                spawnedThisWave={spawnerStateRef.current?.count || 0}
                totalEnemiesInWave={spawnerStateRef.current?.waveData.count || 0}
                totalKilled={totalKilled}
                totalLeaked={totalLeaked}
                isIntermission={isIntermission} 
                waveStartCountdown={Math.ceil(waveStartCountdown)}
                intermissionTime={INTERMISSION_TIME} 
                handleStartNextWaveNow={handleStartNextWaveNow}
                lastUpgradedTowerId={lastUpgradedTowerId}
                justPlacedTowerId={justPlacedTowerId}
                isCoop={false} 
                playerRole="player1"
                handleLoadTestLayout={() => {}} 
                handleLoadAllTowersLayout={() => {}}
                isCheating={isCheating} 
                cheat_addResources={() => setPlayers(prev => [{...prev[0], resources: prev[0].resources + 10000}])} 
                cheat_skipWaves={() => setCurrentWave(prev => prev + 5)}
                cheat_heal={() => setGameState(prev => ({...prev, lives: difficultyModifiers[difficulty].startLives}))}
                cheat_unlockAll={() => {}}
                firingTowerIds={firingTowerIds} 
                allTowers={initialTowers}
                attacks={attacks}
            />

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
                <AlertDialogFooter><AlertDialogAction onClick={onExit}>Zum Hauptmenü</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            
            <ElementPickDialog
                isOpen={gameStatus === 'picking-element'}
                unlockedElements={new Set(localPlayer.unlockedElements)}
                onElementPick={handleElementPick}
                playerName={localPlayer.name}
                currentWave={currentWave}
            />
        </div>
    );
}
