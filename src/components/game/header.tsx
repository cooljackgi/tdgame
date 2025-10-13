

import { Gem, Smartphone, Monitor, Music, VolumeX } from 'lucide-react';
import { Button } from '../ui/button';

type HeaderProps = {
  isMobile: boolean;
  onExit: () => void;
  fps: number;
  isMuted: boolean;
  toggleMute: () => void;
};

export default function Header({ isMobile, onExit, fps, isMuted, toggleMute }: HeaderProps) {
  return (
    <header className="p-4 border-b">
      <div className="max-w-screen-2xl mx-auto flex items-center justify-between">
        <button onClick={onExit} className="flex items-center gap-3 group">
          <Gem className="h-7 w-7 text-primary transition-transform group-hover:scale-110" />
          <h1 className="text-2xl font-bold tracking-tighter bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent transition-opacity group-hover:opacity-80">
            Elementarer Nexus
          </h1>
        </button>
        <div className="flex items-center gap-2 text-muted-foreground">
          {isMobile ? <Smartphone className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
          <div className="text-xs font-mono bg-muted/50 px-2 py-1 rounded-md hidden sm:block">
            {fps} FPS
          </div>
          <Button variant="ghost" size="icon" onClick={toggleMute} className="h-8 w-8">
            {isMuted ? <VolumeX className="h-5 w-5" /> : <Music className="h-5 w-5" />}
          </Button>
        </div>
      </div>
    </header>
  );
}
