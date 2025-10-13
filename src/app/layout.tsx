
import type {Metadata} from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';
import { TooltipProvider } from '@/components/ui/tooltip-provider';

export const metadata: Metadata = {
  title: 'Elementarer Nexus',
  description: 'Ein strategisches Koop-Tower-Defense-Spiel.',
  icons: "",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased">
        <TooltipProvider>
          {children}
        </TooltipProvider>
        <FirebaseErrorListener />
        <Toaster />
      </body>
    </html>
  );
}

    