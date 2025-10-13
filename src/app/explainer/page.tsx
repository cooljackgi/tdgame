
import { redirect } from 'next/navigation';

// Die Hauptseite des Explainers leitet nun direkt zum ersten Abschnitt, dem Intro, weiter.
// Dies sorgt für eine saubere URL-Struktur und einen klaren Einstiegspunkt.
export default function ExplainerPage() {
  redirect('/explainer/intro');
}
