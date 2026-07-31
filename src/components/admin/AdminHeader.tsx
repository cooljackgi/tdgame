'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Activity, BarChart3, Gauge, Home, LogOut, SlidersHorizontal, Waves } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const navigation = [
  { href: '/admin', label: 'System', icon: Gauge },
  { href: '/admin/analytics', label: 'Spiele', icon: BarChart3 },
  { href: '/balancing', label: 'Türme', icon: SlidersHorizontal },
  { href: '/balancing/waves', label: 'Wellen', icon: Waves },
];

export default function AdminHeader() {
  const pathname = usePathname();
  const router = useRouter();

  const logout = async () => {
    await fetch('/api/admin/session', { method: 'DELETE' });
    router.replace('/admin-login');
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
        <Link href="/admin" className="mr-auto flex items-center gap-2 font-semibold">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Activity className="h-5 w-5 text-primary" />
          </span>
          <span className="hidden sm:inline">Nexus Admin</span>
        </Link>
        <nav className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
          {navigation.map(({ href, label, icon: Icon }) => {
            const active = href === '/admin' ? pathname === href : pathname.startsWith(href);
            return (
              <Button key={href} asChild variant={active ? 'secondary' : 'ghost'} size="sm">
                <Link href={href} className={cn(active && 'text-primary')}>
                  <Icon className="mr-2 h-4 w-4" />{label}
                </Link>
              </Button>
            );
          })}
        </nav>
        <Button asChild variant="ghost" size="icon" title="Zum Spiel">
          <Link href="/"><Home className="h-4 w-4" /></Link>
        </Button>
        <Button variant="ghost" size="icon" onClick={logout} title="Abmelden">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
