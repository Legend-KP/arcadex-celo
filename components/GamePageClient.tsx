"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Game, gameHasLeaderboard } from "@/types";
import GameClient from "@/components/GameClient";
import GameMenu from "@/components/GameMenu";
import Leaderboard from "@/components/Leaderboard";
import LoadingScreen from "@/components/LoadingScreen";

export default function GamePageClient() {
  const { id } = useParams<{ id: string }>();
  const [game, setGame] = useState<Game | null>(null);
  const [started, setStarted] = useState(false);
  const [lbOpen, setLbOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadGame() {
      try {
        const res = await fetch(`/api/games/${id}`, { cache: "no-store" });
        const data = (await res.json()) as { game?: Game; error?: string };

        if (!res.ok) {
          throw new Error(data.error ?? "Game not found.");
        }

        if (!cancelled) {
          setGame(data.game ?? null);
          if (data.game) {
            fetch(`/api/games/${id}/play`, { method: "POST" }).catch(() => {
              // Play tracking is best-effort
            });
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Game not found.");
          setGame(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadGame();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return <LoadingScreen message="Loading game" />;
  }

  if (!game) {
    return (
      <div className="loading-screen">
        <p className="loading-screen__text">{error || "Game not found."}</p>
      </div>
    );
  }

  return (
    <>
      {!started ? (
        <GameMenu
          game={game}
          onStart={() => setStarted(true)}
          onLeaderboard={() => setLbOpen(true)}
        />
      ) : (
        <GameClient game={game} />
      )}
      {gameHasLeaderboard(game) && (
        <Leaderboard
          gameId={game.id}
          gameName={game.name}
          open={lbOpen}
          onClose={() => setLbOpen(false)}
        />
      )}
    </>
  );
}
