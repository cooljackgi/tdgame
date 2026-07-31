
import { towers } from '@/lib/game-data/towers';
import { ALL_PICKABLE_ELEMENTS } from '@/lib/game-data/constants';
import type { Tower as GameTower, Element as GameElement } from '@/lib/game-data/types';

export type ExplainerNode = {
  id: string;
  label: string;
  kind: "element" | "tower" | "effect";
  color: string;
  x: number;
  y: number;
  summary?: string;
  tags?: string[];
};

export type ExplainerLink = {
  source: string;
  target: string;
  type?: "requires" | "synergy" | "upgrade";
};

const C = {
  tower: "hsl(var(--accent))",
  effect: "hsl(var(--warning))", // Updated to use the variable
  subtle: "hsl(var(--muted-foreground)/0.5)"
};

const elementHslColors: Record<GameElement, string> = {
  fire: "hsl(0 84% 60%)",
  water: "hsl(217 91% 60%)",
  earth: "hsl(35 91% 50%)",
  air: "hsl(240 5% 65%)",
  nature: "hsl(142 71% 45%)",
  light: "hsl(53 98% 50%)",
  dark: "hsl(271 91% 65%)",
  neutral: "hsl(var(--primary))",
};


const buildGraphData = () => {
    const nodes: ExplainerNode[] = [];
    const links: ExplainerLink[] = [];
    const initialX = 1400 / 2;
    const initialY = 800 / 2;

    // --- Elemente ---
    const allGameElements: GameElement[] = ['neutral', ...ALL_PICKABLE_ELEMENTS];
    const elementDescriptions: Record<GameElement, string> = {
      neutral: "Basis für alle Türme. Keine Spezialisierung.",
      fire: "Hoher Schaden über Zeit (DoT) und Flächenschaden (AoE). Ideal gegen Gruppen und ungepanzerte Ziele.",
      water: "Kontrolliert Gegner durch Verlangsamung und Einfrieren. Perfekt, um schnelle Gegner auszubremsen.",
      earth: "Durchbricht Rüstung und kann Gegner betäuben. Sehr effektiv gegen Bosse und gepanzerte Einheiten.",
      air: "Fokussiert auf schnelle Angriffe und Kettenblitze, die auf mehrere Ziele überspringen.",
      light: "Unterstützt andere Türme mit Buffs oder verursacht massiven, kritischen Einzelzielschaden.",
      dark: "Schwächt Gegner oder verursacht Schaden basierend auf ihrem maximalen Leben. Stark gegen Elite-Gegner.",
      nature: "Greift mehrere Ziele gleichzeitig an und kann Lebensraub besitzen. Gut gegen Horden.",
    };

    allGameElements.forEach((el, i) => {
        nodes.push({
            id: `el-${el}`,
            label: el.charAt(0).toUpperCase() + el.slice(1),
            kind: "element",
            color: elementHslColors[el] ?? C.tower,
            x: initialX + Math.cos(i / allGameElements.length * 2 * Math.PI) * 400,
            y: initialY + Math.sin(i / allGameElements.length * 2 * Math.PI) * 400,
            summary: elementDescriptions[el],
            tags: [el, 'element'],
        });
    });

    // --- Türme ---
    towers.forEach((tower, i) => {
      nodes.push({
        id: `tw-${tower.id}`,
        label: tower.name,
        kind: 'tower',
        color: C.tower,
        x: initialX + Math.random() * 200 - 100,
        y: initialY + Math.random() * 200 - 100,
        summary: tower.description,
        tags: [...tower.elements, 'turm'],
      });
    });


    // --- Effekte ---
    const effects = [
      { id: "ef-burn", label: "Brennen", summary: "Verursacht über Zeit Schaden. Ignoriert teilweise Rüstung." },
      { id: "ef-slow", label: "Verlangsamen", summary: "Reduziert die Bewegungsgeschwindigkeit von Gegnern." },
      { id: "ef-stun", label: "Betäuben", summary: "Hält Gegner für eine kurze Zeit komplett an." },
      { id: "ef-vuln", label: "Verwundbar", summary: "Erhöht den Schaden, den ein Ziel aus allen Quellen erleidet." },
      { id: "ef-chain", label: "Kettenblitz", summary: "Ein Angriff, der auf nahestehende Gegner überspringt." },
    ];

    effects.forEach((ef, i) => {
      nodes.push({ 
        ...ef, 
        id: ef.id,
        x: initialX + Math.cos(i / effects.length * 2 * Math.PI) * 600,
        y: initialY + Math.sin(i / effects.length * 2 * Math.PI) * 600,
        kind: "effect", 
        color: C.effect, 
        tags: [ef.label.toLowerCase(), 'effekt'] 
      });
    });

    // --- Links/Kanten ---
    towers.forEach(tower => {
      // Upgrade-Pfade
      if (tower.upgradesTo) {
        tower.upgradesTo.forEach(upgradeId => {
            links.push({ source: `tw-${tower.id}`, target: `tw-${upgradeId}`, type: "upgrade" });
        });
      }

      // Element-Anforderungen
      tower.elements.forEach(element => {
         if (element !== 'neutral') {
            links.push({ source: `el-${element}`, target: `tw-${tower.id}`, type: "requires" });
         }
      });

      // Turm -> Effekt
      tower.effects?.forEach((effect) => {
        const effectType = effect.type;
        if (effectType === 'burn') links.push({ source: `tw-${tower.id}`, target: 'ef-burn', type: "synergy" });
        if (effectType === 'slow') links.push({ source: `tw-${tower.id}`, target: 'ef-slow', type: "synergy" });
        if (effectType === 'stun') links.push({ source: `tw-${tower.id}`, target: 'ef-stun', type: "synergy" });
        if (effectType === 'vulnerability') links.push({ source: `tw-${tower.id}`, target: 'ef-vuln', type: "synergy" });
        if (effectType === 'chain') links.push({ source: `tw-${tower.id}`, target: 'ef-chain', type: "synergy" });
      });
    });

    return { nodes, links };
}

export const { nodes: ALL_NODES, links: ALL_LINKS } = buildGraphData();
