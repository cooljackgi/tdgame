// components/explainer/ExplainerGraph.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExplainerNode, ExplainerLink } from "@/lib/explainer-data";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ExternalLink, Play, Pause } from "lucide-react";
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type Simulation, type SimulationNodeDatum } from 'd3-force';
import { Button } from "../ui/button";

type SimulationNode = ExplainerNode & SimulationNodeDatum;

type Props = {
  nodes: ExplainerNode[];
  links: ExplainerLink[];
  focusedId?: string | null;
  onFocus?: (id: string | null) => void;
  onDeepLink?: (id: string) => void;
  onNodeMove?: (id: string, x: number, y: number) => void;
};

const WIDTH = 1400;
const HEIGHT = 800;

export default function ExplainerGraph({ nodes: initialNodes, links: initialLinks, focusedId, onFocus, onDeepLink, onNodeMove }: Props) {
  const nodesRef = useRef<SimulationNode[]>([]); // Initialize an empty ref
  const [links] = useState(initialLinks);
  
  const simulationRef = useRef<Simulation<SimulationNode, ExplainerLink>>();
  const [isSimRunning, setIsSimRunning] = useState(true);
  
  // Dummy state to force re-renders on simulation tick
  const [, setTick] = useState(0);

  // pan/zoom state (world transform)
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  const draggedNodeRef = useRef<SimulationNode | null>(null);

  const worldToScreen = (x: number, y: number) => ({ sx: x * scale + tx, sy: y * scale + ty });
  const screenToWorld = (sx: number, sy: number) => ({ x: (sx - tx) / scale, y: (sy - ty) / scale });

  // EFFECT 1: Initialize simulation only ONCE on component mount.
  // The dependency array is empty. This is the key change.
  useEffect(() => {
    const simulation = forceSimulation<SimulationNode, ExplainerLink>()
      .force('link', forceLink<SimulationNode, ExplainerLink>(initialLinks).id(d => d.id).distance(d => (d.type === 'requires' ? 120 : 180)).strength(0.6))
      .force('charge', forceManyBody<SimulationNode>().strength(-400))
      .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))
      .force('collide', forceCollide<SimulationNode>().radius(40))
      .on('tick', () => {
        setTick(t => t + 1);
      });

    simulationRef.current = simulation;
    
    return () => {
      simulation.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // EFFECT 2: Update simulation nodes when initialNodes prop changes.
  // This effect handles data updates separately from initialization.
  useEffect(() => {
    const sim = simulationRef.current;
    if (sim) {
      // Create a map of existing node positions and velocities
      const nodeMap = new Map(nodesRef.current.map(n => [n.id, n]));

      // Update the data in the ref first
      nodesRef.current = initialNodes.map(n => {
        const existing = nodeMap.get(n.id);
        return existing ? { ...n, x: existing.x, y: existing.y, vx: existing.vx, vy: existing.vy } : { ...n };
      });
      
      // Then pass the new data to the running simulation
      sim.nodes(nodesRef.current);
      
      // Restart the simulation with the new data
      if (isSimRunning) {
        sim.alpha(0.3).restart();
      } else {
        // If paused, just update the positions without a restart
        setTick(t => t + 1);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNodes]);

  // auto-fit on mount (same as before)
  useEffect(() => {
    const c = containerRef.current;
    if (!c || nodesRef.current.length === 0) return;
    const currentNodes = nodesRef.current;
    
    // Defer fitting until the simulation has had a moment to settle
    const timeoutId = setTimeout(() => {
      if(!containerRef.current) return; // check if component is still mounted

      const xs = currentNodes.map(n => n.x ?? WIDTH/2);
      const ys = currentNodes.map(n => n.y ?? HEIGHT/2);

      if (xs.length === 0) return;
      
      const minX = Math.min(...xs) - 80;
      const maxX = Math.max(...xs) + 80;
      const minY = Math.min(...ys) - 80;
      const maxY = Math.max(...ys) + 80;

      const vw = c.clientWidth;
      const vh = c.clientHeight;
      const s = Math.min(vw / (maxX - minX || 1), vh / (maxY - minY || 1), 1.2);
      setScale(s);
      setTx(vw / 2 - ((minX + maxX) / 2) * s);
      setTy(vh / 2 - ((minY + maxY) / 2) * s);
    }, 100);

    return () => clearTimeout(timeoutId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // zoom wheel
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const world = screenToWorld(mx, my);
    const delta = -e.deltaY * 0.001;
    const nextScale = Math.min(2.2, Math.max(0.4, scale * (1 + delta)));

    // keep mouse position stable
    const nx = world.x * nextScale + tx;
    const ny = world.y * nextScale + ty;
    setTx(tx + (mx - nx));
    setTy(ty + (my - ny));
    setScale(nextScale);
  };

  // pan (mouse)
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || draggedNodeRef.current) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY, tx, ty };
  };
  
  const onMouseMove = (e: React.MouseEvent) => {
    const sim = simulationRef.current;
    if (draggedNodeRef.current && sim) {
        const rect = containerRef.current!.getBoundingClientRect();
        const { x: newWorldX, y: newWorldY } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        draggedNodeRef.current.fx = newWorldX;
        draggedNodeRef.current.fy = newWorldY;
        if(isSimRunning) sim.alpha(0.1).restart();
    } else if (isPanning.current) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      setTx(panStart.current.tx + dx);
      setTy(panStart.current.ty + dy);
    }
  };

  const onMouseUp = () => {
    const sim = simulationRef.current;
    if (draggedNodeRef.current && sim) {
        if (!isSimRunning) { // If sim is paused, unfix node on release
            onNodeMove?.(draggedNodeRef.current.id, draggedNodeRef.current.x!, draggedNodeRef.current.y!);
            draggedNodeRef.current.fx = null;
            draggedNodeRef.current.fy = null;
        }
    }
    draggedNodeRef.current = null;
    isPanning.current = false;
  };

  const onNodeMouseDown = (e: React.MouseEvent, node: SimulationNode) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    draggedNodeRef.current = node;
    const sim = simulationRef.current;
    if (sim) {
        node.fx = node.x;
        node.fy = node.y;
        if(isSimRunning) sim.alpha(0.1).restart();
    }
  };

  const handleNodeClick = (e: React.MouseEvent, node: SimulationNode) => {
    e.stopPropagation();
    // Check if the mouse moved significantly between mousedown and click
    const moved = Math.hypot(e.clientX - panStart.current.x, e.clientY - panStart.current.y);
    if (moved > 5) return;
    focusAndCenter(node.id);
  }


  // pan/zoom (touch)
  const lastTouch = useRef<{dist: number; cx: number; cy: number} | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      isPanning.current = true;
      panStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx, ty };
    } else if (e.touches.length === 2) {
      const [a,b] = [e.touches[0], e.touches[1]];
      const dx = a.clientX - b.clientX;
      const dy = a.clientY - b.clientY;
      const dist = Math.hypot(dx, dy);
      const cx = (a.clientX + b.clientX)/2;
      const cy = (a.clientY + b.clientY)/2;
      lastTouch.current = { dist, cx, cy };
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && isPanning.current) {
      const t = e.touches[0];
      const dx = t.clientX - panStart.current.x;
      const dy = t.clientY - panStart.current.y;
      setTx(panStart.current.tx + dx);
      setTy(panStart.current.ty + dy);
    } else if (e.touches.length === 2 && lastTouch.current) {
      const [a,b] = [e.touches[0], e.touches[1]];
      const dx = a.clientX - b.clientX;
      const dy = a.clientY - b.clientY;
      const dist = Math.hypot(dx, dy);
      const cx = (a.clientX + b.clientX)/2;
      const cy = (a.clientY + b.clientY)/2;

      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      const mx = cx - rect.left;
      const my = cy - rect.top;
      const world = screenToWorld(mx, my);

      const factor = dist / (lastTouch.current.dist || dist);
      const nextScale = Math.min(2.2, Math.max(0.4, scale * factor));

      const nx = world.x * nextScale + tx;
      const ny = world.y * nextScale + ty;
      setTx(tx + (mx - nx));
      setTy(ty + (my - ny));
      setScale(nextScale);

      lastTouch.current = { dist, cx, cy };
    }
  };
  const onTouchEnd = () => {
    isPanning.current = false;
    lastTouch.current = null;
  };

  // focus helpers
  const focusedNode = useMemo(() => nodesRef.current.find(n => n.id === focusedId) || null, [focusedId, setTick]);

  const focusAndCenter = useCallback((id: string) => {
    const n = nodesRef.current.find(x => x.id === id);
    if (!n) return;
    onFocus?.(id);

    const c = containerRef.current;
    if (!c) return;
    const vw = c.clientWidth;
    const vh = c.clientHeight;
    const targetScale = Math.min(1.6, Math.max(0.7, scale < 0.9 ? 1.0 : scale));
    setScale(targetScale);
    setTx(vw / 2 - (n.x || 0) * targetScale);
    setTy(vh / 2 - (n.y || 0) * targetScale);
  }, [onFocus, scale]);
  
  const handleToggleSimulation = () => {
      const sim = simulationRef.current;
      if (!sim) return;
      if (isSimRunning) {
          sim.stop();
      } else {
          sim.alpha(0.3).restart();
      }
      setIsSimRunning(!isSimRunning);
  };

  // draw
  return (
    <div
      ref={containerRef}
      className="relative h-[calc(100dvh-240px)] min-h-[500px] w-full cursor-grab overflow-hidden rounded-lg border bg-muted/20 active:cursor-grabbing"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseUp}
      onMouseUp={onMouseUp}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* grid */}
      <div className="absolute inset-0 -z-10 opacity-70">
        <svg className="h-full w-full">
          <defs>
            <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M 28 0 L 0 0 0 28" fill="none" stroke="hsl(var(--muted-foreground)/0.1)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      {/* world */}
      <div className="h-full w-full" style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})`, transformOrigin: "0 0" }}>
        <svg className="h-full w-full overflow-visible">
          {/* Links */}
          <g strokeLinecap="round">
            {links.map((l, i) => {
              const source = l.source as SimulationNode;
              const target = l.target as SimulationNode;
              if (!source.x || !target.x) return null;

              const isDim = focusedId && !(source.id === focusedId || target.id === focusedId);
              
              const color = l.type === 'upgrade' ? 'hsl(var(--primary))' 
                          : l.type === 'synergy' ? 'hsl(var(--warning))'
                          : 'hsl(var(--muted-foreground)/0.6)';

              return (
                <g key={i} opacity={isDim ? 0.3 : 1} className="transition-opacity">
                  <path
                    d={`M ${source.x} ${source.y} L ${target.x} ${target.y}`}
                    stroke={color}
                    strokeWidth={l.type === 'requires' ? 2 : 2.5}
                    strokeDasharray={l.type === 'requires' ? '4 4' : 'none'}
                  />
                  {l.type !== 'requires' && <circle cx={target.x} cy={target.y} r={3} fill={color} />}
                </g>
              );
            })}
          </g>

          {/* Nodes */}
          <g>
            {nodesRef.current.map(n => {
              if (!n.x) return null;
              const isFocused = n.id === focusedId;
              const cls = cn(
                "cursor-pointer transition-all",
                isFocused ? "drop-shadow-[0_0_0.75rem_hsl(var(--primary)/0.65)]" : "hover:opacity-90"
              );
              const r = n.kind === "element" ? 18 : n.kind === "tower" ? 14 : 12;
              const stroke = isFocused ? "hsl(var(--primary))" : "hsl(var(--foreground)/0.6)";

              return (
                <g 
                    key={n.id} 
                    transform={`translate(${n.x}, ${n.y})`}
                    onMouseDown={(e) => onNodeMouseDown(e, n)}
                    onClick={(e) => handleNodeClick(e, n)}
                 >
                  <circle cx={0} cy={0} r={r + 5} fill="hsl(var(--background))" opacity={0.85} />
                  <circle className={cls} cx={0} cy={0} r={r} fill={n.color} stroke={stroke} strokeWidth={1.5} />
                  <text
                    x={0}
                    y={r + 16}
                    textAnchor="middle"
                    fontSize={12}
                    className="fill-foreground pointer-events-none select-none"
                  >
                    {n.label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>


      {/* Side-Panel */}
      <div className="pointer-events-none absolute right-2 top-2 z-10 w-[min(360px,calc(100%-1rem))]">
        <Card className="pointer-events-auto border bg-background/80 backdrop-blur p-3 transition-all duration-300">
          {focusedNode ? (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{focusedNode.kind}</div>
                  <div className="text-base font-semibold">{focusedNode.label}</div>
                </div>
                {onDeepLink && (
                  <button
                    className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => onDeepLink(focusedNode.id)}
                    title="Fokus & Link zur Suche"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                )}
              </div>
              {focusedNode.summary && (
                <p className="text-sm text-muted-foreground">{focusedNode.summary}</p>
              )}
              {focusedNode.tags && focusedNode.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {focusedNode.tags.map(t => (
                    <span key={t} className="rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">{t}</span>
                  ))}
                </div>
              )}
              <div className="text-xs text-muted-foreground pt-1">
                Klicke auf einen leeren Bereich, um die Auswahl aufzuheben.
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-base font-semibold">Legende & Hinweise</div>
              <ul className="text-sm text-muted-foreground list-disc pl-4 space-y-1">
                <li>Suche oben, um Knoten zu filtern – Klick fokussiert & zoomt.</li>
                <li><span className="h-2 w-2 inline-block rounded-full bg-primary mr-1"></span> <span className="font-medium text-foreground">Upgrade-Pfade</span></li>
                <li><span className="h-2 w-2 inline-block rounded-full bg-warning mr-1"></span> <span className="font-medium text-foreground">Synergien & Effekte</span></li>
                <li><span className="font-medium text-foreground">Gestrichelte Linien</span> sind Voraussetzungen</li>
              </ul>
            </div>
          )}
        </Card>
      </div>

       {/* Controls */}
       <div className="absolute bottom-2 left-2 z-10">
            <Button
                variant="outline"
                size="icon"
                onClick={handleToggleSimulation}
                className="bg-background/50 backdrop-blur"
                title={isSimRunning ? "Simulation pausieren" : "Simulation fortsetzen"}
            >
                {isSimRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
        </div>
    </div>
  );
}
