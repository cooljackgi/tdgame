
'use client';

import { Construction } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkerState } from '@/lib/game-data/types';

type WorkerDroneProps = {
  workerState: WorkerState;
};

export default function WorkerDrone({ workerState }: WorkerDroneProps) {
  const { position, task } = workerState;

  return (
    <div
      className="absolute z-20 pointer-events-none transition-all duration-100"
      style={{
        left: position.x,
        top: position.y,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div className="relative">
        <Construction
          className={cn(
            'h-8 w-8 text-primary drop-shadow-[0_2px_4px_rgba(34,211,238,0.7)] transition-all duration-300',
            task === 'moving' && 'animate-bounce',
            task === 'building' && 'animate-spin'
          )}
        />
        {task === 'building' && (
            <div className="absolute -inset-2 animate-ping rounded-full border-2 border-primary/50" />
        )}
      </div>
    </div>
  );
}
