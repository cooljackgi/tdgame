'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Home, Trophy, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { GameResultWithId } from '@/lib/game-data/types';
import { collection, getDocs, query, orderBy, limit, Timestamp, doc, deleteDoc, writeBatch } from 'firebase/firestore';
import { db, auth, onAuthStateChanged, type User } from '@/lib/firebase';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import ScoreboardMiniMap from '@/components/game/ScoreboardMiniMap';
import { useToast } from '@/hooks/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";


const ADMIN_EMAILS = ['db@hudb.de', 'becker.bubenrod@gmail.com'];

export default function ScoreboardPage() {
  const [results, setResults] = useState<GameResultWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [scoreToDelete, setScoreToDelete] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  
  const isAdmin = user && ADMIN_EMAILS.includes(user.email || '');

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
        setUser(currentUser);
    });

    const fetchScores = async () => {
        try {
            const scoresQuery = query(
                collection(db, "scores"),
                orderBy("wave", "desc"),
                orderBy("date", "desc"),
                limit(50)
            );
            const querySnapshot = await getDocs(scoresQuery);
            const fetchedScores = querySnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    playerName: data.playerName,
                    playerUid: data.playerUid,
                    date: (data.date as Timestamp).toDate().toISOString(),
                    difficulty: data.difficulty,
                    wave: data.wave,
                    won: data.won,
                    finalTowers: data.finalTowers,
                } as GameResultWithId;
            });
            setResults(fetchedScores);
        } catch (e) {
            console.error("Could not load scoreboard data from Firestore", e);
        } finally {
            setLoading(false);
        }
    };
    
    fetchScores();

    return () => unsubscribeAuth();
  }, []);

  const handleToggleSelection = (id: string) => {
    setSelectedIds(prev => {
        const newSet = new Set(prev);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        return newSet;
    });
  };

  const handleToggleAll = () => {
    if (selectedIds.size === results.length) {
        setSelectedIds(new Set());
    } else {
        setSelectedIds(new Set(results.map(r => r.id)));
    }
  };
  
  const handleDelete = async () => {
    if (!scoreToDelete) return;

    if (scoreToDelete === 'multiple') {
        const batch = writeBatch(db);
        selectedIds.forEach(id => {
            batch.delete(doc(db, 'scores', id));
        });
        try {
            await batch.commit();
            setResults(prev => prev.filter(r => !selectedIds.has(r.id)));
            setSelectedIds(new Set());
            toast({ title: 'Erfolg', description: `${selectedIds.size} Einträge wurden gelöscht.` });
        } catch (e) {
            toast({ title: 'Fehler', description: 'Einträge konnten nicht gelöscht werden.', variant: 'destructive' });
            console.error("Error deleting multiple scores:", e);
        }
    } else {
         try {
            const scoreRef = doc(db, 'scores', scoreToDelete);
            await deleteDoc(scoreRef);
            setResults(prev => prev.filter(r => r.id !== scoreToDelete));
            toast({ title: 'Erfolg', description: 'Eintrag wurde gelöscht.' });
        } catch (e) {
            toast({ title: 'Fehler', description: 'Eintrag konnte nicht gelöscht werden.', variant: 'destructive' });
            console.error("Error deleting score:", e);
        }
    }
    setScoreToDelete(null);
  };


  return (
    <>
    <main className="mx-auto max-w-4xl px-4 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Trophy className="text-primary" />
            Globale Highscores
          </h1>
          <p className="text-muted-foreground">Die besten Ergebnisse aller Einzelspieler-Partien.</p>
        </div>
        <Link href="/">
            <Button variant="outline">
                <Home className="mr-2 h-4 w-4" />
                Zurück zum Menü
            </Button>
        </Link>
      </div>

      <Card>
         <CardHeader>
            <CardTitle>Rangliste</CardTitle>
            <CardDescription>
                {isAdmin ? "Admin-Ansicht: Wähle Einträge aus, um sie zu löschen." : "Die Top 50 Ergebnisse, sortiert nach Welle."}
            </CardDescription>
             {isAdmin && (
                <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-2">
                        <Checkbox 
                            id="select-all" 
                            checked={selectedIds.size > 0 && selectedIds.size === results.length}
                            onCheckedChange={handleToggleAll}
                            aria-label="Alle auswählen"
                        />
                        <label htmlFor="select-all" className="text-sm font-medium">Alle auswählen</label>
                    </div>
                    <Button 
                        variant="destructive" 
                        size="sm"
                        onClick={() => setScoreToDelete('multiple')}
                        disabled={selectedIds.size === 0}
                    >
                        <Trash2 className="mr-2 h-4 w-4"/>
                        {selectedIds.size} Ausgewählte löschen
                    </Button>
                </div>
            )}
         </CardHeader>
         <CardContent>
            {loading ? (
                <div className="flex justify-center items-center py-20">
                    <Loader2 className="h-8 w-8 animate-spin mr-3" />
                    <p>Lade Highscores...</p>
                </div>
            ) : results.length === 0 ? (
                <div className="text-center py-20">
                    <p className="text-muted-foreground">Noch keine Spiele abgeschlossen.</p>
                    <p className="text-muted-foreground">Schließe eine Einzelspieler-Partie ab, um der Erste zu sein!</p>
                </div>
            ) : (
                <ol className="space-y-4">
                   {results.map((result, index) => (
                       <li key={result.id} className={cn(
                           "flex items-center gap-4 p-3 rounded-lg border",
                           index === 0 && "border-yellow-400 bg-yellow-400/10",
                           index === 1 && "border-slate-400 bg-slate-400/10",
                           index === 2 && "border-amber-600 bg-amber-600/10",
                           selectedIds.has(result.id) && "bg-primary/20 border-primary"
                       )}>
                            {isAdmin && (
                                <Checkbox
                                    checked={selectedIds.has(result.id)}
                                    onCheckedChange={() => handleToggleSelection(result.id)}
                                    className="flex-shrink-0"
                                />
                           )}
                           <div className="text-xl font-bold w-8 text-center text-muted-foreground">
                               {index + 1}
                           </div>
                           <div className="flex-grow">
                               <p className="font-semibold">{result.playerName}</p>
                               <p className="text-xs text-muted-foreground">{new Date(result.date).toLocaleString('de-DE')}</p>
                           </div>
                           {result.finalTowers && <ScoreboardMiniMap towersByCell={result.finalTowers} />}
                           <div className="flex items-center gap-4">
                              <Badge variant="outline">{result.difficulty}</Badge>
                              <div className="text-right">
                                  <p className="text-lg font-bold">Welle {result.wave}</p>
                                  {result.won && <p className="text-xs text-green-400 font-semibold">GEWONNEN</p>}
                              </div>
                           </div>
                           {isAdmin && (
                                <Button variant="destructive" size="icon" onClick={() => setScoreToDelete(result.id)}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                           )}
                       </li>
                   ))}
                </ol>
            )}
         </CardContent>
      </Card>
    </main>

    <AlertDialog open={!!scoreToDelete} onOpenChange={(open) => !open && setScoreToDelete(null)}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Bist du sicher?</AlertDialogTitle>
                <AlertDialogDescription>
                    {scoreToDelete === 'multiple' ? `Sollen ${selectedIds.size} Einträge wirklich endgültig gelöscht werden?` : 'Dieser Eintrag wird endgültig gelöscht.'} Diese Aktion kann nicht rückgängig gemacht werden.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>Löschen</AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
