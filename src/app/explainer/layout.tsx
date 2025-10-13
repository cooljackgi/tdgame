
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Home, Zap, Flame, Droplets, Mountain, Wind, Leaf, Sun, Moon, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';

const navItems = [
  { href: '/explainer/intro', icon: BookOpen, label: 'Einführung' },
  { href: '/explainer/elements', icon: Flame, label: 'Elemente' },
  { href: '/explainer/towers', icon: Zap, label: 'Türme & Upgrades' },
  { href: '/explainer/synergies', icon: Zap, label: 'Synergien' },
];


export default function ExplainerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="w-64 flex-shrink-0 border-r border-border p-4 hidden md:flex flex-col">
        <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold tracking-tight">Erklär-Center</h2>
             <Link href="/">
                <Button variant="ghost" size="icon" asChild>
                    <Home className="h-5 w-5" />
                </Button>
            </Link>
        </div>
        <nav className="flex flex-col gap-2">
          {navItems.map(item => (
            <Link href={item.href} key={item.href} passHref>
                <Button variant="ghost" className="w-full justify-start gap-2" asChild>
                    <>
                        <item.icon className="h-4 w-4" />
                        <span>{item.label}</span>
                    </>
                </Button>
            </Link>
          ))}
        </nav>
      </aside>

      <main className="flex-1 p-4 md:p-8 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
