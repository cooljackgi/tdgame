// src/app/explainer/elements/page.tsx
"use client";

import { useState, useMemo } from 'react';
import ExplainerGraph from '@/components/explainer/ExplainerGraph';
import { ALL_NODES, ALL_LINKS } from '@/lib/explainer-data';
import type { ExplainerNode } from '@/lib/explainer-data';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function ElementsMapPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const filteredNodes = useMemo(() => {
    if (!searchTerm.trim()) return ALL_NODES;
    const lowerSearch = searchTerm.toLowerCase();
    return ALL_NODES.filter(node => 
        node.label.toLowerCase().includes(lowerSearch) || 
        node.tags?.some(tag => tag.toLowerCase().includes(lowerSearch))
    );
  }, [searchTerm]);

  const handleNodeUpdate = (id: string, x: number, y: number) => {
    // This is a placeholder. In a real scenario, you might want to save
    // the new positions to localStorage or a database.
    // This functionality is currently disabled to prevent data drift.
    // console.log(`Node ${id} moved to (${x}, ${y}) - (Position saving not implemented)`);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold tracking-tighter mb-2">Interaktive Wissens-Karte</h1>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Erkunde die Verbindungen zwischen Elementen, Türmen und Effekten. Klicke auf Knoten, um Details anzuzeigen, und nutze die Suche, um gezielt zu filtern.
        </p>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
           <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Suche nach Türmen, Elementen oder Effekten..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 max-w-sm"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0" onClick={() => setFocusedId(null)}>
           <ExplainerGraph 
              nodes={filteredNodes}
              links={ALL_LINKS}
              focusedId={focusedId}
              onFocus={setFocusedId}
              onNodeMove={handleNodeUpdate}
              onDeepLink={(id) => {
                const node = ALL_NODES.find(n => n.id === id);
                setSearchTerm(node?.label || '');
                setTimeout(() => setFocusedId(id), 50);
              }}
           />
        </CardContent>
      </Card>
    </div>
  );
}
