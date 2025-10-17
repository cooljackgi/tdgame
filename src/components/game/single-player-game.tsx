
"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { GameSession } from '@/components/game/game-session';
import type { Difficulty, GameSaveState, User, Player, GameState, PlacedTower, Tower, Node, Element, Enemy, Attack, DamageNumber, SplashRing, MovementPattern } from '@/lib/game-data/types';
import { towers as initialTowers } from '@/lib/game-data/towers';
import { waves } from '@/lib/game-data/enemies';
import { difficultyModifiers, GRID_COLS, GRID_ROWS, LOCAL_STORAGE_KEY, INTERMISSION_TIME } from '@/lib/game-data/constants';
import { findPath } from '@/lib/pathfinding';
import { useToast } from '@/hooks/use-toast';
import { audioManager } from '@/lib/audio/audio-manager';
import type { GameBoardHandle } from './game-board';


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

    // --- Core Game State ---
    const [players, setPlayers] = useState<Player[]>([]);
    const [gameState, setGameState] = useState<GameState>({ lives: 20 });
    const [towersByCell, setTowersByCell] = useState<Record<string, PlacedTower>>({});
    const [currentWave, setCurrentWave] = useState(0);
    const [difficulty, setDifficulty] = useState(initialDifficulty);
    const [enemies, setEnemies] = useState<Enemy[]>([]);
    const [gameStatus, setGameStatus] = useState<"waiting" | "playing" | "paused" | "gameover" | "picking-element">('playing');
    
    // --- UI/Interaction State ---
    const [selectedTowerToBuild, setSelectedTowerToBuild] = useState<Tower | null>(null);
    const [justPlacedTowerId, setJustPlacedTowerId] = useState<string | null>(null);
    const [focusedTower, setFocusedTower] = useState<PlacedTower | null>(null);
    const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string | null>(null);

    // --- VFX State ---
    const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
    const [splashRings, setSplashRings] = useState<SplashRing[]>([]);
    const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());
    
    // --- Game Loop Refs ---
    const gameLoopRef = useRef<number>();
    const lastTickRef = useRef(performance.now());
    const spawnerStateRef = useRef<{ count: number; timer: number; waveData: any } | null>(null);
    const enemyIdCounter = useRef(0);
    const gameBoardRef = useRef<GameBoardHandle>(null);

    const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);

    // --- Refs for stable access in game loop ---
    const playersRef = useRef(players);
    const towersByCellRef = useRef(towersByCell);
    const enemiesRef = useRef(enemies);
    const gameStateRef = useRef(gameState);
    const currentWaveRef = useRef(currentWave);
    const difficultyRef = useRef(difficulty);
    const gameStatusRef = useRef(gameStatus);
    const localPlayerRef = useRef<Player | undefined>(undefined);

    useEffect(() => { playersRef.current = players; localPlayerRef.current = players[0]; }, [players]);
    useEffect(() => { towersByCellRef.current = towersByCell; }, [towersByCell]);
    useEffect(() => { enemiesRef.current = enemies; }, [enemies]);
    useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
    useEffect(() => { currentWaveRef.current = currentWave; }, [currentWave]);
    useEffect(() => { difficultyRef.current = difficulty; }, [difficulty]);
    useEffect(() => { gameStatusRef.current = gameStatus; }, [gameStatus]);

    useMemo(() => {
        if (initialSavedGame) {
            setPlayers([initialSavedGame.players.player1]);
            setGameState(initialSavedGame.gameState);
            setTowersByCell(initialSavedGame.towersByCell);
            setEnemies(initialSavedGame.enemies);
            setCurrentWave(initialSavedGame.currentWave);
            setDifficulty(initialSavedGame.difficulty);
            setGameStatus('playing');
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
    }, [initialSavedGame, initialDifficulty, user]);
    
    const localPlayer = useMemo(() => players.find(p => p.id === 'player1'), [players]);

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

    const placedTowers = useMemo(() => Object.values(towersByCell), [towersByCell]);
    const [currentPath, setCurrentPath] = useState<Node[]>(
        () => findPath({row:1,col:1},{row:GRID_ROWS,col:GRID_COLS}, [], GRID_ROWS, GRID_COLS) ?? []
    );

    const handlePlaceTower = useCallback((row: number, col: number, towerId: string) => {
        const player = localPlayerRef.current;
        const towerSpec = initialTowers.find(t => t.id === towerId);
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
        setJustPlacedTowerId(newTower.id);
        setFocusedTower(newTower);
        setSelectedTowerToBuild(null);
        setTimeout(() => setJustPlacedTowerId(null), 500);

    }, [toast]);

    const handleUpgradeTower = useCallback((row: number, col: number, upgradeId: string) => {
        const player = localPlayerRef.current;
        const cellKey = `${row}_${col}`;
        const focusedTower = towersByCellRef.current[cellKey];

        if (!player || !focusedTower) return;
        
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
    }, [toast]);

    const handleSellTower = useCallback((row: number, col: number) => {
        const player = localPlayerRef.current;
        const cellKey = `${row}_${col}`;
        const focusedTower = towersByCellRef.current[cellKey];

        if (!player || !focusedTower) return;

        const refundPercentage = difficultyRef.current === 'Einfach' ? 1.0 : 0.75;
        const refund = Math.round(focusedTower.cost * refundPercentage);
        
        setTowersByCell(prev => { const newTowers = { ...prev }; delete newTowers[cellKey]; return newTowers; });
        setPlayers(prev => [{ ...prev[0], resources: prev[0].resources + refund }]);
        setFocusedTower(null);
    }, []);
    
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
        }
    }, [isCheating]);

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
                setWaveStartCountdown(prev => {
                    const newTime = prev - delta / 1000;
                    if (newTime <= 0) {
                        handleStartNextWaveNow();
                        return 0;
                    }
                    return newTime;
                });
            }

            if (spawnerStateRef.current && currentPath.length > 0) {
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
                          path: currentPath,
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
            
            const attacksToQueue: Attack[] = [];
            const newDamageNumbers: DamageNumber[] = [];
            const newFiringTowerIds = new Set<string>();

            // Tower attack logic
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

                        attacksToQueue.push({
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
                            position: target.position,
                            color: '#ffffff',
                        });
                    }
                }
            }

            if (newFiringTowerIds.size > 0) {
                setFiringTowerIds(newFiringTowerIds);
                setTimeout(() => setFiringTowerIds(new Set()), 150);
            }
            if (attacksToQueue.length > 0 && gameBoardRef.current) {
                gameBoardRef.current.queueAttacks(attacksToQueue);
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
                      if (updatedEnemy.pathIndex < currentPath.length - 1) {
                        updatedEnemy.pathIndex += 1;
                        updatedEnemy.position = currentPath[updatedEnemy.pathIndex];
                        updatedEnemy.lastMove = now;
                      }
                    }

                    const burnEffect = updatedEnemy.effects.find(e => e.type === 'burn' && e.expires > now);
                    if (burnEffect && burnEffect.expires > now) {
                        if (!burnEffect.lastTick || now - burnEffect.lastTick >= 1000) {
                            const damage = (burnEffect.potency ?? 0) * updatedEnemy.maxHealth;
                            updatedEnemy.health -= damage;
                            burnEffect.lastTick = now;
                            newDamageNumbers.push({ id: crypto.randomUUID(), amount: damage, position: updatedEnemy.position, color: '#f97316' });
                        }
                    }
                    updatedEnemy.wasHit = false;

                    if (updatedEnemy.pathIndex >= currentPath.length - 1) {
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
                    setGameState(prev => ({...prev, lives: prev.lives - livesLost }));
                    if (gameStateRef.current.lives - livesLost <= 0) {
                        onGameEnd({ /* ... */ });
                    }
                }
                if (resourcesGained > 0) {
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
                    onGameEnd({
                      playerName: localPlayerRef.current?.name || 'Spieler',
                      playerUid: user?.uid || 'anonymous',
                      difficulty: difficultyRef.current,
                      wave: currentWaveRef.current + 1,
                      won: true,
                      finalTowers: towersByCellRef.current
                    });
                }
            }
            
            gameLoopRef.current = requestAnimationFrame(gameLoop);
        };
        gameLoopRef.current = requestAnimationFrame(gameLoop);
        return () => {
            if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
        }
    }, []);
    
    return (
        <GameSession
            isCoop={false}
            isGameHost={true}
            localPlayerId="player1"
            isCheating={isCheating}
            user={user}
            allTowers={initialTowers}
            players={players}
            setPlayers={setPlayers}
            gameState={gameState}
            setGameState={setGameState}
            towersByCell={towersByCell}
            setTowersByCell={setTowersByCell}
            enemies={enemies}
            setEnemies={setEnemies}
            currentWave={currentWave}
            setCurrentWave={setCurrentWave}
            difficulty={difficulty}
            gameStatus={gameStatus}
            setGameStatus={setGameStatus}
            initialEnemies={enemies}
            onExit={onExit}
            onFocusTower={onFocusTower}
            cancelInteractions={cancelInteractions}
            onSelectTowerToBuild={onSelectTowerToBuild}
            onElementPick={handleElementPick}
            onStartNextWaveNow={handleStartNextWaveNow}
            waveStartCountdown={Math.ceil(waveStartCountdown)}
            justPlacedTowerId={justPlacedTowerId}
            lastUpgradedTowerId={lastUpgradedTowerId}
            selectedTowerToBuild={selectedTowerToBuild}
            focusedTower={focusedTower}
            onPlaceTower={(r, c, tId) => handlePlaceTower(r, c, tId)}
            onUpgradeTower={(r, c, uId) => handleUpgradeTower(r, c, uId)}
            onSellTower={(r, c) => handleSellTower(r, c)}
            gameBoardRef={gameBoardRef}
        />
    );
}
