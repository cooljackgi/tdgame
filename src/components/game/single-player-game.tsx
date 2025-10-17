

"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Tower, PlacedTower, Enemy, Node, Element, Difficulty, Attack, DamageNumber, SplashRing, GameSaveState, GameResult, GameResultWithId, EnemyStatusEffect, MovementPattern } from '@/lib/game-data/types';
import { useToast } from '@/hooks/use-toast';
import { difficultyModifiers, ALL_PICKABLE_ELEMENTS, INTERMISSION_TIME, GRID_ROWS, GRID_COLS, LOCAL_STORAGE_KEY, elementProjectileColors } from '@/lib/game-data/constants';
import type { User } from 'firebase/auth';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { normalizePlayers } from '@/lib/player-utils';
import { audioManager } from '@/lib/audio/audio-manager';
import { findPath } from '@/lib/pathfinding';
import GameSession from './game-session';
import type { Player, GameState, GameStatus } from './game-session';
import { towers as initialTowers } from '@/lib/game-data/towers';
import { waves } from '@/lib/game-data/enemies';


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
    
    // --- State that causes re-renders (UI-related) ---
    const [gameStatus, setGameStatus] = useState<GameStatus>('playing');
    const [finalGameResult, setFinalGameResult] = useState<GameResult | null>(null);
    const [tick, setTick] = useState(0); // Forces re-render for UI updates
    const [fps, setFps] = useState(0);
    const [totalKilled, setTotalKilled] = useState(0);
    const [totalLeaked, setTotalLeaked] = useState(0);

    // --- VFX State (fed by deltas) ---
    const [attacks, setAttacks] = useState<Attack[]>([]);
    const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
    const [splashRings, setSplashRings] = useState<SplashRing[]>([]);
    const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string | null>(null);
    const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());

    
    // --- Refs for game state data (to prevent re-renders in the loop) ---
    const playersRef = useRef<Player[]>([]);
    const gameStateRef = useRef<GameState>({ lives: 20 });
    const difficultyRef = useRef<Difficulty>(initialDifficulty);
    const isIntermissionRef = useRef(true);
    const waveStartCountdownRef = useRef(INTERMISSION_TIME);
    const currentWaveRef = useRef(0);
    const towersByCellRef = useRef<Record<string, PlacedTower>>({});
    const enemiesRef = useRef<Enemy[]>([]);
    const spawnedThisWaveRef = useRef(0);
    const spawnerStateRef = useRef<{ count: number; timer: number; waveData: any } | null>(null);
    const enemyIdCounter = useRef(0);

    const gameLoopRef = useRef<number>();
    const lastTickRef = useRef(performance.now());
    
    const allTowers = useMemo(() => initialTowers.map(t => ({...t})), []);
    const currentPath = useMemo(() => findPath({ row: 1, col: 1 }, { row: GRID_ROWS, col: GRID_COLS }, Object.values(towersByCellRef.current), GRID_ROWS, GRID_COLS) || [], [tick]);
    const currentPathRef = useRef(currentPath);
    useEffect(() => { currentPathRef.current = currentPath; }, [currentPath]);

    useEffect(() => {
        if (initialSavedGame) {
            playersRef.current = normalizePlayers(initialSavedGame.players);
            gameStateRef.current = initialSavedGame.gameState;
            towersByCellRef.current = initialSavedGame.towersByCell;
            enemiesRef.current = initialSavedGame.enemies;
            currentWaveRef.current = initialSavedGame.currentWave;
            difficultyRef.current = initialSavedGame.difficulty;
        } else {
            const difficultyMod = difficultyModifiers[initialDifficulty];
            const startLives = isCheating ? 999 : difficultyMod.startLives;
            const startRes = isCheating ? 99999 : difficultyMod.startResources;
            const startElements = isCheating ? ['neutral', ...ALL_PICKABLE_ELEMENTS] as Element[] : ['neutral'] as Element[];

            const player1: Player = { id: 'player1', name: isCheating ? 'Chaos-Meister' : (user?.displayName || 'Spieler 1'), resources: startRes, unlockedElements: startElements, avatarUrl: user?.photoURL || null };
            playersRef.current = [player1];
            gameStateRef.current = { lives: startLives };
        }
        isIntermissionRef.current = true;
        setGameStatus('playing');
        waveStartCountdownRef.current = INTERMISSION_TIME;
        setTick(t => t + 1); // Force initial render with loaded state

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
          if (gameStatus !== 'gameover' && !isCheating) {
            saveGameState();
          }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            if(gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
        }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialSavedGame, isCheating, startWithTutorial, initialDifficulty, user]);
    
    const saveGameState = useCallback(() => {
        if (gameStatus === 'gameover' || isCheating) return;
        const stateToSave: GameSaveState = {
            players: { player1: playersRef.current[0], player2: null },
            gameState: gameStateRef.current, 
            towersByCell: towersByCellRef.current, 
            enemies: enemiesRef.current, 
            currentWave: currentWaveRef.current, 
            difficulty: difficultyRef.current
        };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stateToSave));
        toast({ title: 'Spiel gespeichert!' });
    }, [gameStatus, isCheating, toast]);
    
    const handleGameEnd = useCallback(async (result: GameResult) => {
        if (gameStatus !== 'gameover') {
            setGameStatus('gameover');
            localStorage.removeItem(LOCAL_STORAGE_KEY);
            if (user && !isCheating) {
                try {
                    const docData = { ...result, date: serverTimestamp() };
                    await addDoc(collection(db, "scores"), docData);
                    setFinalGameResult({ ...result, date: new Date().toISOString() });
                } catch(e) {
                    console.error("Failed to save score", e);
                    setFinalGameResult(result);
                }
            } else {
                setFinalGameResult(result);
            }
        }
    }, [user, isCheating, gameStatus]);

    const handlePlaceTower = useCallback((row: number, col: number, playerId: Player['id'], towerId: string) => {
        const selectedTowerToBuild = allTowers.find(t => t.id === towerId);
        if (!selectedTowerToBuild) return;

        const cellKey = `${row}_${col}`;
        if (towersByCellRef.current[cellKey]) return;
        
        const currentPlacedTowers = Object.values(towersByCellRef.current).map(t => t.position);
        if (!findPath({row:1, col:1}, {row:GRID_ROWS, col:GRID_COLS}, [...currentPlacedTowers, {row, col}], GRID_ROWS, GRID_COLS)) {
            return;
        }

        const player = playersRef.current.find(p => p.id === playerId);
        if (!player || player.resources < selectedTowerToBuild.cost) return;

        const newTower: PlacedTower = {
            ...JSON.parse(JSON.stringify(selectedTowerToBuild)),
            id: `tower-${row}-${col}-${Date.now()}`,
            specId: selectedTowerToBuild.id,
            position: { row, col },
            lastAttack: 0,
            health: selectedTowerToBuild.maxHealth,
            ownerId: player.id,
        };
        
        towersByCellRef.current = { ...towersByCellRef.current, [cellKey]: newTower };
        player.resources -= newTower.cost;
        setTick(t => t + 1);
    }, [allTowers]);

     const handleUpgradeTower = useCallback((row: number, col: number, upgradeId: string, playerId: Player['id']) => {
        const player = playersRef.current.find(p => p.id === playerId);
        const cellKey = `${row}_${col}`;
        const focusedTower = towersByCellRef.current[cellKey];

        if (!player || !focusedTower || focusedTower.ownerId !== playerId) return;

        const upgradeTowerSpec = allTowers.find(t => t.id === upgradeId);
        if (!upgradeTowerSpec) return;

        const refundPercentage = difficultyRef.current === 'Einfach' ? 1.0 : 0.75;
        const cost = Math.max(0, upgradeTowerSpec.cost - Math.floor(focusedTower.cost * refundPercentage));

        if (player.resources < cost) return;

        const newPlacedTower: PlacedTower = { 
            ...JSON.parse(JSON.stringify(focusedTower)), 
            ...JSON.parse(JSON.stringify(upgradeTowerSpec)), 
            specId: upgradeTowerSpec.id, 
            health: upgradeTowerSpec.maxHealth 
        };
        
        towersByCellRef.current[cellKey] = newPlacedTower;
        player.resources -= cost;

        setLastUpgradedTowerId(newPlacedTower.id);
        setTimeout(() => setLastUpgradedTowerId(null), 1000);
        setTick(t => t + 1);
    }, [allTowers]);

    const handleSellTower = useCallback((row: number, col: number, playerId: Player['id']) => {
        const player = playersRef.current.find(p => p.id === playerId);
        const cellKey = `${row}_${col}`;
        const focusedTower = towersByCellRef.current[cellKey];

        if (!player || !focusedTower || focusedTower.ownerId !== playerId) return;

        const refundPercentage = difficultyRef.current === 'Einfach' ? 1.0 : 0.75;
        const refund = Math.round(focusedTower.cost * refundPercentage);

        delete towersByCellRef.current[cellKey];
        player.resources += refund;
        setTick(t => t + 1);
    }, []);

    const onLocalAction = useCallback((action: 'build' | 'upgrade' | 'sell', payload: any) => {
        const selectedTowerId = (document as any).__SELECTED_TOWER_ID;
        const { row, col, upgradeId } = payload;
        switch(action) {
            case 'build':
                handlePlaceTower(row, col, 'player1', selectedTowerId);
                // Multi-build: Do not cancel interaction here
                break;
            case 'upgrade':
                handleUpgradeTower(row, col, upgradeId, 'player1');
                break;
            case 'sell':
                handleSellTower(row, col, 'player1');
                break;
        }
    }, [handlePlaceTower, handleUpgradeTower, handleSellTower]);
    
    // --- Game Loop ---
    useEffect(() => {
        const gameLoop = (now: number) => {
            gameLoopRef.current = requestAnimationFrame(gameLoop);
            if (gameStatus !== 'playing') {
                lastTickRef.current = now;
                return;
            }

            const delta = now - lastTickRef.current;
            if (delta < 1000/65) return; // ~60fps cap
            lastTickRef.current = now;
            setFps(Math.round(1000 / delta));
            
            if (isIntermissionRef.current) {
                waveStartCountdownRef.current -= delta / 1000;
                if (waveStartCountdownRef.current <= 0) {
                    isIntermissionRef.current = false;
                    waveStartCountdownRef.current = 0;
                    audioManager.playWaveMusic();
                }
                setTick(t => t+1);
                return;
            }

            if (!spawnerStateRef.current) {
                const waveData = waves[currentWaveRef.current];
                if (waveData) {
                    spawnerStateRef.current = { count: 0, timer: 0, waveData: waveData.enemies };
                    spawnedThisWaveRef.current = 0;
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
                            ...spawnerStateRef.current.waveData,
                            health,
                            maxHealth: health,
                            path: currentPathRef.current,
                            pathIndex: 0,
                            position: {row: 1, col: 1},
                            isBlocked: false,
                            effects: [],
                            lastMove: now,
                            wasHit: false,
                            targetNode: {row: GRID_ROWS, col: GRID_COLS},
                            movementPattern: spawnerStateRef.current.waveData.type === 'schnell' ? 'zigzag' : 'wobble'
                        };
                        enemiesRef.current.push(newEnemy);
                        spawnedThisWaveRef.current++;
                        spawnerStateRef.current.count++;
                    }
                }
            }

            const newAttacks: Attack[] = [];
            const newDamageNumbers: DamageNumber[] = [];
            const newSplashRings: SplashRing[] = [];
            const newFiringTowerIds = new Set<string>();

            // Tower attacks
            Object.values(towersByCellRef.current).forEach(tower => {
                if (now - tower.lastAttack >= tower.attackSpeed) {
                    const targets = enemiesRef.current.filter(e => {
                        const towerPos = { x: tower.position.col, y: tower.position.row };
                        const enemyPos = { x: e.position.col, y: e.position.row };
                        const distSq = (towerPos.x - enemyPos.x) ** 2 + (towerPos.y - enemyPos.y) ** 2;
                        return distSq <= tower.range ** 2;
                    });
                    
                    if (targets.length > 0) {
                        const mainTarget = targets.sort((a,b) => b.pathIndex - a.pathIndex)[0];
                        tower.lastAttack = now;
                        
                        newAttacks.push({ id: `attack-${now}-${Math.random()}`, towerId: tower.id, targetId: mainTarget.id, targetPosition: mainTarget.position, elements: tower.elements, projectile: 'beam' });
                        newFiringTowerIds.add(tower.id);
                        audioManager.playSfx('shoot', 0.3);
                        
                        // Direct damage
                        const damage = tower.damage;
                        mainTarget.health -= damage;
                        mainTarget.wasHit = true;
                        newDamageNumbers.push({ id: `dmg-${now}-${Math.random()}`, targetId: mainTarget.id, amount: damage, color: elementProjectileColors[tower.elements[0]] || 'white', position: mainTarget.position });
                    }
                }
            });

            setAttacks(prev => [...prev.slice(-100), ...newAttacks]);
            setDamageNumbers(prev => [...prev.slice(-100), ...newDamageNumbers]);
            setSplashRings(prev => [...prev.slice(-50), ...newSplashRings]);
            setFiringTowerIds(newFiringTowerIds);
            setTimeout(() => setFiringTowerIds(new Set()), 150);

            // Enemy movement & state updates
            const nextEnemies: Enemy[] = [];
            let livesLost = 0;

            for (const enemy of enemiesRef.current) {
                if (enemy.health <= 0) {
                    playersRef.current[0].resources += enemy.bounty;
                    setTotalKilled(k => k + 1);
                    continue; // dead
                }

                if (enemy.pathIndex >= currentPathRef.current.length - 1) {
                    livesLost++;
                    setTotalLeaked(l => l + 1);
                    continue; // reached end
                }

                const slowEffect = enemy.effects.find(e => e.type === 'slow' && e.expires > now);
                const effectiveSpeed = enemy.speed * (slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1);
                
                if (now - enemy.lastMove >= 1000 / effectiveSpeed) {
                    enemy.pathIndex++;
                    enemy.position = currentPathRef.current[enemy.pathIndex];
                    enemy.lastMove = now;
                }
                
                enemy.wasHit = false;
                nextEnemies.push(enemy);
            }
            enemiesRef.current = nextEnemies;

            if (livesLost > 0) {
                gameStateRef.current.lives -= livesLost;
                if (gameStateRef.current.lives <= 0) {
                    gameStateRef.current.lives = 0;
                    handleGameEnd({ playerName: playersRef.current[0].name, playerUid: playersRef.current[0].id, date: new Date().toISOString(), difficulty: difficultyRef.current, wave: currentWaveRef.current + 1, won: false, finalTowers: towersByCellRef.current });
                }
            }

            if (spawnerStateRef.current && spawnerStateRef.current.count >= spawnerStateRef.current.waveData.count && enemiesRef.current.length === 0) {
                spawnerStateRef.current = null;
                const nextWave = currentWaveRef.current + 1;
                if (nextWave >= waves.length) {
                    handleGameEnd({ playerName: playersRef.current[0].name, playerUid: playersRef.current[0].id, date: new Date().toISOString(), difficulty: difficultyRef.current, wave: waves.length, won: true, finalTowers: towersByCellRef.current });
                } else {
                    if ((nextWave + 1) % 5 === 0 && ALL_PICKABLE_ELEMENTS.some(e => !playersRef.current[0].unlockedElements.includes(e))) {
                        setGameStatus('picking-element');
                    } else {
                        currentWaveRef.current = nextWave;
                        isIntermissionRef.current = true;
                        waveStartCountdownRef.current = INTERMISSION_TIME;
                        if (!isCheating) saveGameState();
                    }
                }
            }
            setTick(t => t + 1);
        };
        gameLoopRef.current = requestAnimationFrame(gameLoop);
        return () => { if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current); };
    }, [gameStatus, handleGameEnd, isCheating, saveGameState]);


    const handleElementPick = (element: Element) => {
        playersRef.current[0].unlockedElements.push(element);
        currentWaveRef.current++;
        isIntermissionRef.current = true;
        waveStartCountdownRef.current = INTERMISSION_TIME;
        setGameStatus('playing');
        if (!isCheating) saveGameState();
    };

    const handleStartNextWaveNow = () => {
        if(isIntermissionRef.current && gameStatus === 'playing') {
            isIntermissionRef.current = false;
            waveStartCountdownRef.current = 0;
            audioManager.playWaveMusic();
        }
    };
    
    if (!playersRef.current[0]) return null;

    // Use dummy functions for coop-specific props
    const dummyBroadcast = () => {};
    const dummyApplyDeltas = () => {};

    return (
        <GameSession
            players={playersRef.current} setPlayers={(updater) => { if (typeof updater === 'function') playersRef.current = updater(playersRef.current); else playersRef.current = updater; setTick(t=>t+1); }}
            gameState={gameStateRef.current} setGameState={(updater) => { if (typeof updater === 'function') gameStateRef.current = updater(gameStateRef.current); else gameStateRef.current = updater; setTick(t=>t+1); }}
            towersByCell={towersByCellRef.current} setTowersByCell={(updater) => { if (typeof updater === 'function') towersByCellRef.current = updater(towersByCellRef.current); else towersByCellRef.current = updater; setTick(t=>t+1); }}
            currentWave={currentWaveRef.current} setCurrentWave={(val) => currentWaveRef.current = typeof val === 'function' ? val(currentWaveRef.current) : val}
            gameStatus={gameStatus} setGameStatus={setGameStatus}
            difficulty={difficultyRef.current} setDifficulty={(d) => difficultyRef.current = d}
            isIntermission={isIntermissionRef.current} setIsIntermission={(val) => isIntermissionRef.current = val}
            waveStartCountdown={Math.round(waveStartCountdownRef.current)} setWaveStartCountdown={(val) => waveStartCountdownRef.current = typeof val === 'function' ? val(waveStartCountdownRef.current) : val}
            currentPath={currentPath}
            enemies={enemiesRef.current} setEnemies={(updater) => { if (typeof updater === 'function') enemiesRef.current = updater(enemiesRef.current); else enemiesRef.current = updater; setTick(t=>t+1);}}
            spawnedThisWave={spawnedThisWaveRef.current} setSpawnedThisWave={(val) => spawnedThisWaveRef.current = typeof val === 'function' ? val(spawnedThisWaveRef.current) : val}
            isCoop={false} isGameHost={true} localPlayerId="player1"
            broadcastGameData={dummyBroadcast} applyDeltas={dummyApplyDeltas} onGameEnd={handleGameEnd}
            onExit={onExit} onLocalAction={onLocalAction}
            attacks={attacks} damageNumbers={damageNumbers} splashRings={splashRings}
            lastUpgradedTowerId={lastUpgradedTowerId} setLastUpgradedTowerId={setLastUpgradedTowerId}
            firingTowerIds={firingTowerIds} setFiringTowerIds={setFiringTowerIds}
            fps={fps} setFps={setFps}
            totalKilled={totalKilled} setTotalKilled={setTotalKilled}
            totalLeaked={totalLeaked} setTotalLeaked={setTotalLeaked}
            finalGameResult={finalGameResult}
            allTowers={allTowers}
            handleStartNextWaveNow={handleStartNextWaveNow}
        />
    )
}
