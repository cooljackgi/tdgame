
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Flame, Droplets, ArrowRight } from 'lucide-react';
import TowerComponent from '@/components/game/Tower';

export default function IntroPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold tracking-tighter mb-2">Willkommen bei Elementarer Nexus</h1>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Tauche ein in die Welt der Elemente und entdecke die Geheimnisse strategischer Turmverteidigung. Dieser Guide macht dich zum Meister-Strategen.
        </p>
      </div>

      <Card className="bg-card/50 border-primary/20">
        <CardHeader>
          <CardTitle>Das Kernprinzip: Elemente kombinieren</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col md:flex-row justify-around items-center gap-6 text-center p-4">
            
            <div className="flex flex-col items-center gap-2">
              <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center border">
                <Flame className="h-10 w-10 text-red-400" />
              </div>
              <p className="font-semibold max-w-[120px]">Basis-Element: Feuer</p>
            </div>

            <div className="text-4xl font-thin text-muted-foreground">+</div>

            <div className="flex flex-col items-center gap-2">
               <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center border">
                <Droplets className="h-10 w-10 text-sky-400" />
              </div>
              <p className="font-semibold max-w-[120px]">Basis-Element: Wasser</p>
            </div>

             <div className="text-4xl font-thin text-muted-foreground hidden md:block">→</div>
             <div className="text-4xl font-thin text-muted-foreground md:hidden">↓</div>

            <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-primary/10 border-primary/30 border">
              <TowerComponent element="fire" variant="basic" isUpgraded size={64}/>
              <p className="font-semibold text-lg">Ergibt: Dampf-Turm</p>
              <p className="text-sm text-muted-foreground max-w-xs">Verursacht Flächenschaden und verlangsamt Gegner.</p>
            </div>

          </div>
          <div className="text-center text-muted-foreground text-sm pt-4">
            (Hier wird bald eine dynamische Animation erscheinen)
          </div>
        </CardContent>
      </Card>
      
      <div className="text-center">
        <Link href="/explainer/elements">
          <Button size="lg">
            Starte mit der interaktiven Karte
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
