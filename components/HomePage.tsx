"use client";

import { useEffect, useState } from "react";
import { Game } from "@/types";
import GameCard from "@/components/GameCard";
import LoadingScreen from "@/components/LoadingScreen";
import Logo from "@/components/Logo";

export default function HomePage() {
  const [games, setGames] = useState<Game[]>([]);
  const [playCounts, setPlayCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadGames() {
      setLoading(true);
      setError("");

      try {
        const res = await fetch("/api/games", { cache: "no-store" });
        const text = await res.text();
        let data: { games?: Game[]; playCounts?: Record<string, number>; error?: string };
        try {
          data = JSON.parse(text) as {
            games?: Game[];
            playCounts?: Record<string, number>;
            error?: string;
          };
        } catch {
          throw new Error(
            "Server returned an invalid response. Check Cloudflare Worker secrets and redeploy."
          );
        }

        if (!res.ok) {
          throw new Error(data.error ?? "Could not load games.");
        }

        if (cancelled) return;

        const active = data.games ?? [];
        setGames(active);
        setPlayCounts(data.playCounts ?? {});
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "Could not load games. Check your Firebase configuration."
        );
        setLoading(false);
      }
    }

    loadGames();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <div className="home">
      <div className="home-shell">
        <header className="topbar">
          <Logo variant="header" />
        </header>

        {error ? (
          <p className="no-games">{error}</p>
        ) : games.length === 0 ? (
          <p className="no-games">No games yet. Check back soon!</p>
        ) : (
          <div className="games-grid">
            {games.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                playCount={playCounts[game.id] ?? 0}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
