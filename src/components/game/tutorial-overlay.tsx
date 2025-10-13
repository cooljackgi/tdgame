
'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

type TutorialStep = {
  elementId: string;
  title: string;
  text: string;
  placement: 'top' | 'bottom' | 'left' | 'right';
};

const tutorialSteps: TutorialStep[] = [
  {
    elementId: 'tutorial-build-menu',
    title: 'Das Bau-Menü',
    text: 'Hier findest du alle Türme, die du bauen kannst. Klicke auf einen Turm, um ihn auszuwählen.',
    placement: 'right',
  },
  {
    elementId: 'tutorial-player-stats',
    title: 'Deine Ressourcen',
    text: 'Das sind deine Leben und Ressourcen. Jeder durchgekommene Gegner kostet dich ein Leben. Besiegte Gegner bringen Ressourcen.',
    placement: 'right',
  },
  {
    elementId: 'tutorial-wave-tracker',
    title: 'Wellen-Anzeige',
    text: 'Hier siehst du, in welcher Welle du dich befindest und welche Gegner als nächstes kommen.',
    placement: 'right',
  },
  {
    elementId: 'tutorial-game-board',
    title: 'Das Spielfeld',
    text: 'Platziere deine Türme auf dem Feld, um die Gegner aufzuhalten, die oben links starten und unten rechts entkommen wollen.',
    placement: 'bottom',
  },
  {
    elementId: 'tutorial-start-wave-button',
    title: 'Welle starten',
    text: 'Wenn du bereit bist, klicke hier, um die nächste Welle zu starten. Viel Erfolg!',
    placement: 'top',
  },
];

const getElementRect = (id: string): DOMRect | null => {
  const element = document.getElementById(id);
  return element ? element.getBoundingClientRect() : null;
};

export default function TutorialOverlay({ onFinish }: { onFinish: () => void }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});

  const currentStep = tutorialSteps[stepIndex];

  useEffect(() => {
    const updateRect = () => {
      if (currentStep) {
        let rect = getElementRect(currentStep.elementId);
        
        // Retry mechanism if element is not found immediately
        if (!rect) {
            setTimeout(() => {
                const retryRect = getElementRect(currentStep.elementId);
                if (retryRect) setHighlightRect(retryRect);
            }, 200);
            return;
        }

        setHighlightRect(rect);

        if (rect) {
            const PADDING = 16;
            const TOOLTIP_WIDTH = 256; // w-64
            const TOOLTIP_HEIGHT = 180; // Approximate height
            const { top, left, width, height } = rect;
            
            let finalStyle: React.CSSProperties = {};
            let placement = currentStep.placement;

            // Pre-calculate positions
            const positions = {
                right: { top: top + height / 2, left: left + width + PADDING, transform: 'translateY(-50%)' },
                left: { top: top + height / 2, left: left - PADDING, transform: 'translate(-100%, -50%)' },
                bottom: { top: top + height + PADDING, left: left + width / 2, transform: 'translateX(-50%)' },
                top: { top: top - PADDING, left: left + width / 2, transform: 'translate(-50%, -100%)' },
            };

            // Check boundaries and adjust placement if necessary
            if (placement === 'right' && left + width + PADDING + TOOLTIP_WIDTH > window.innerWidth) placement = 'left';
            if (placement === 'left' && left - PADDING - TOOLTIP_WIDTH < 0) placement = 'right';
            if (placement === 'bottom' && top + height + PADDING + TOOLTIP_HEIGHT > window.innerHeight) placement = 'top';
            if (placement === 'top' && top - PADDING - TOOLTIP_HEIGHT < 0) placement = 'bottom';
            
            finalStyle = positions[placement];
            
            // Final boundary checks to clamp the position inside the viewport
            let finalTop = finalStyle.top as number;
            let finalLeft = finalStyle.left as number;
            
            if (typeof finalTop === 'number') {
               if (finalTop < PADDING) finalTop = PADDING;
               if (finalTop + TOOLTIP_HEIGHT > window.innerHeight - PADDING) finalTop = window.innerHeight - PADDING - TOOLTIP_HEIGHT;
            }
            if (typeof finalLeft === 'number') {
                if (finalLeft < PADDING) finalLeft = PADDING;
                if (finalLeft + TOOLTIP_WIDTH > window.innerWidth - PADDING) finalLeft = window.innerWidth - PADDING - TOOLTIP_WIDTH;
            }

            setTooltipStyle({
                top: `${finalTop}px`,
                left: `${finalLeft}px`,
                transform: 'none' // We handled translation manually
            });
        }
      }
    };
    
    updateRect();
    const timeoutId = setTimeout(updateRect, 100); // Recalculate after a short delay for layout shifts

    window.addEventListener('resize', updateRect);
    return () => {
        window.removeEventListener('resize', updateRect);
        clearTimeout(timeoutId);
    }
  }, [currentStep]);

  const handleNext = () => {
    if (stepIndex < tutorialSteps.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      onFinish();
    }
  };

  const getClipPath = () => {
    if (!highlightRect) {
      return 'polygon(0 0, 100% 0, 100% 100%, 0 100%)'; // Full overlay
    }
    const { top, left, width, height } = highlightRect;
    const padding = 12;

    const x1 = left - padding;
    const y1 = top - padding;
    const x2 = left + width + padding;
    const y2 = top + height + padding;

    return `polygon(
      0 0, 100% 0, 100% 100%, 0 100%, 0 ${y1}px, 
      ${x1}px ${y1}px, ${x1}px ${y2}px, ${x2}px ${y2}px, ${x2}px ${y1}px, 0 ${y1}px
    )`;
  };

  return (
    <AnimatePresence>
      {currentStep && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] pointer-events-auto"
        >
          {/* Background overlay with clip-path */}
          <div
            className="absolute inset-0 bg-black/70 transition-all duration-300 ease-in-out"
            style={{ clipPath: getClipPath() }}
          />

          {/* Tooltip */}
          {highlightRect && (
            <motion.div
              key={stepIndex}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.2 }}
              className="absolute w-64 p-4 bg-card border rounded-lg shadow-2xl transition-all duration-300 ease-in-out"
              style={tooltipStyle}
            >
              <h3 className="font-bold text-lg mb-2">{currentStep.title}</h3>
              <p className="text-sm text-muted-foreground mb-4">{currentStep.text}</p>
              <Button onClick={handleNext} className="w-full">
                {stepIndex === tutorialSteps.length - 1 ? (
                  <>Verstanden! <Check className="ml-2 h-4 w-4" /></>
                ) : (
                  <>Weiter <ArrowRight className="ml-2 h-4 w-4" /></>
                )}
              </Button>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
