

import { Gem, Smartphone, Monitor, Music, VolumeX, Home } from 'lucide-react';
import { Button } from '../ui/button';

type HeaderProps = {
  onExit: () => void;
  isMuted: boolean;
  toggleMute: () => void;
  fps?: number;
};

export default function Header({ onExit, isMuted, toggleMute, fps }: HeaderProps) {
  return (
    <header className="p-2 border-b bg-card/50 flex-shrink-0">
      <div className="max-w-screen-2xl mx-auto flex items-center justify-between">
        <Button onClick={onExit} variant="ghost" className="flex items-center gap-2 group px-2">
          <Home className="h-5 w-5 text-primary transition-transform group-hover:scale-110" />
          <h1 className="text-xl font-bold tracking-tighter bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent transition-opacity group-hover:opacity-80 hidden sm:block">
            Hauptmenü
          </h1>
        </Button>
        <div className="flex items-center gap-2 text-muted-foreground">
          {fps !== undefined && (
            <div className="font-mono text-xs text-primary font-semibold hidden sm:block">
              {fps} FPS
            </div>
          )}
          <Button variant="ghost" size="icon" onClick={toggleMute} className="h-8 w-8">
            {isMuted ? <VolumeX className="h-5 w-5" /> : <Music className="h-5 w-5" />}
          </Button>
        </div>
      </div>
    </header>
  );
}
