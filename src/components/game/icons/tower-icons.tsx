import * as React from "react";

/** Grundstil: 24x24, monoline, runde Kappen, currentColor */
const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Optionaler Duotone-Fill (leichte Fläche unter der Linie) */
function Tone({ children }: { children: React.ReactNode }) {
  return <g opacity={0.14}>{children}</g>;
}

/* ------------------- ELEMENT-ICONs (einheitlicher Stil) ------------------- */

export const IconFire: React.FC<React.SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p} aria-label="Feuer">
    <Tone><path d="M12 4c3 4-1 5 2 8 2 2 1 6-2 6-3 0-5-2-5-5 0-3 2-5 5-9Z" fill="currentColor"/></Tone>
    <path d="M12 4c3 4-1 5 2 8 2 2 1 6-2 6-3 0-5-2-5-5 0-3 2-5 5-9Z" />
  </svg>
);

export const IconWater: React.FC<React.SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p} aria-label="Wasser">
    <Tone><path d="M12 4s5 6 5 9a5 5 0 1 1-10 0c0-3 5-9 5-9Z" fill="currentColor"/></Tone>
    <path d="M12 4s5 6 5 9a5 5 0 1 1-10 0c0-3 5-9 5-9Z" />
  </svg>
);

export const IconEarth: React.FC<React.SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p} aria-label="Erde">
    <Tone><path d="M4 14l8-8 8 8-8 4-8-4Z" fill="currentColor"/></Tone>
    <path d="M4 14l8-8 8 8-8 4-8-4Z" />
    <path d="M12 6v8" />
  </svg>
);

export const IconAir: React.FC<React.SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p} aria-label="Luft">
    <Tone><path d="M4 9h10a3 3 0 1 0 0-6" fill="currentColor"/></Tone>
    <path d="M4 9h10a3 3 0 1 0 0-6" />
    <path d="M4 15h12a3 3 0 1 1 0 6" />
  </svg>
);

export const IconNature: React.FC<React.SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p} aria-label="Natur">
    <Tone><path d="M12 3c2 3 2 6 0 9s-2 6 0 9" fill="currentColor"/></Tone>
    <path d="M12 3c2 3 2 6 0 9s-2 6 0 9" />
    <path d="M6 12h12M8 8h8M9 16h6" />
  </svg>
);

export const IconLight: React.FC<React.SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p} aria-label="Licht">
    <Tone><circle cx="12" cy="10" r="4" fill="currentColor"/></Tone>
    <circle cx="12" cy="10" r="4" />
    <path d="M12 14v6M9 20h6" />
    <path d="M12 2v2M4 10h2M18 10h2M6 6l1.5 1.5M16.5 7.5 18 6" />
  </svg>
);

export const IconDark: React.FC<React.SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p} aria-label="Dunkel">
    <Tone><path d="M14 4a8 8 0 1 0 6 12 7 7 0 0 1-6-12Z" fill="currentColor"/></Tone>
    <path d="M14 4a8 8 0 1 0 6 12 7 7 0 0 1-6-12Z" />
  </svg>
);

export const IconNeutral: React.FC<React.SVGProps<SVGSVGElement>> = (p) => (
    <svg {...base} {...p} aria-label="Neutral">
        <Tone><circle cx="12" cy="12" r="6" fill="currentColor"/></Tone>
        <circle cx="12" cy="12" r="8" />
    </svg>
);
