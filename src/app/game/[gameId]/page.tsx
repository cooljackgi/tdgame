

"use client";

import CoopGameLoader from "@/components/game/coop-game-loader";

// This component now just acts as a wrapper for the actual coop game loader.
// This clean separation prevents module loading conflicts between singleplayer and coop modes.
function CoopGame() {
  return <CoopGameLoader />;
}

export default CoopGame;
