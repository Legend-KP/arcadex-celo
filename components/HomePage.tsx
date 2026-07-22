"use client";

import { useEffect, useState } from "react";
import { Game } from "@/types";
import AppFooter from "@/components/AppFooter";
import GameCard from "@/components/GameCard";
import Logo from "@/components/Logo";
import SparkBatteryBar from "@/components/SparkBatteryBar";
import {
  readCachedGamesList,
  shouldBackgroundRefreshGamesList,
  writeCachedGamesList,
} from "@/lib/games-list-client-cache";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";

export default function HomePage() {
  const { isReady } = usePlayerProfile();
  const [games, setGames] = useState<Game[]>(() => {
    return readCachedGamesList()?.games ?? [];
  });
  const [playCounts, setPlayCounts] = useState<Record<string, number>>(() => {
    return readCachedGamesList()?.playCounts ?? {};
  });
  const [loading, setLoading] = useState(() => !readCachedGamesList());
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isReady) return;

    let cancelled = false;
    const hadCache = Boolean(readCachedGamesList());

    async function loadGames(background = false) {
      if (!background) {
        setLoading(true);
        setError("");
      }

      try {
        const res = await fetch("/api/games");
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

        const nextGames = data.games ?? [];
        const nextPlayCounts = data.playCounts ?? {};
        setGames(nextGames);
        setPlayCounts(nextPlayCounts);
        writeCachedGamesList({
          games: nextGames,
          playCounts: nextPlayCounts,
          fetchedAt: Date.now(),
        });
      } catch (err) {
        if (cancelled) return;
        if (!background || !hadCache) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load games. Check your Firebase configuration."
          );
        }
      } finally {
        if (!cancelled && !background) setLoading(false);
      }
    }

    if (hadCache) {
      void loadGames(true);
    } else {
      void loadGames(false);
    }

    const onVisible = () => {
      if (document.visibilityState === "visible" && shouldBackgroundRefreshGamesList()) {
        void loadGames(true);
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isReady]);

  return (
    <div className="home">
      <div className="home-shell">
        <header className="topbar">
          <Logo variant="header" />
          <SparkBatteryBar />
        </header>

        {error ? (
          <p className="no-games">{error}</p>
        ) : loading ? (
          <div className="games-grid games-grid--loading" aria-busy="true" aria-label="Loading games">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="game-card-skeleton" aria-hidden />
            ))}
          </div>
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

        <AppFooter />
      </div>
    </div>
  );
}
