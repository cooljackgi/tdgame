'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function AdminLoginPage() {
  const router = useRouter();
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Anmeldung fehlgeschlagen.');
      router.replace('/admin');
      router.refresh();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Anmeldung fehlgeschlagen.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-background px-4 py-12 flex items-center justify-center">
      <Card className="w-full max-w-md border-primary/20 shadow-xl">
        <CardHeader className="space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <ShieldCheck className="h-7 w-7 text-primary" />
          </div>
          <div className="text-center">
            <CardTitle className="text-2xl">Nexus Admin Center</CardTitle>
            <CardDescription className="mt-2">
              Geschützter Zugriff auf Systemstatus, Spieldaten und Balancing-Werkzeuge.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              className="sr-only"
              name="username"
              value="nexus-admin"
              readOnly
              tabIndex={-1}
              autoComplete="username"
              aria-hidden="true"
            />
            <div className="space-y-2">
              <Label htmlFor="admin-key">Admin-Schlüssel</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="admin-key"
                  type="password"
                  autoComplete="current-password"
                  className="pl-9"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  required
                  autoFocus
                />
              </div>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || !key.trim()}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Sicher anmelden
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
