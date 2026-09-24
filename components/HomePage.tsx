"use client";

import { useEffect, useState } from "react";
import { Game } from "@/types";
import AppFooter from "@/components/AppFooter";
import GameCard from "@/components/GameCard";
import Logo from "@/components/Logo";
import SparkBatteryBar from "@/components/SparkBatteryBar";
import ActivityLeaderboardButton from "@/components/ActivityLeaderboardButton";
import PromoPopupHost from "@/components/PromoPopupHost";
import {
  readCachedGamesList,
  shouldBackgroundRefreshGamesList,
  writeCachedGamesList,
} from "@/lib/games-list-client-cache";
import { fetchHomeShell } from "@/lib/home-client";
import { getCachedWallet } from "@/lib/player-id";

export default function HomePage() {
  const [games, setGames] = useState<Game[]>(() => {
    return readCachedGamesList()?.games ?? [];
  });
  const [playCounts, setPlayCounts] = useState<Record<string, number>>(() => {
    return readCachedGamesList()?.playCounts ?? {};
  });
  const [testGameId, setTestGameId] = useState<string | null>(() => {
    return readCachedGamesList()?.testGameId ?? null;
  });
  const [loading, setLoading] = useState(() => !readCachedGamesList());
  const [error, setError] = useState("");
  const [activityBoardOpen, setActivityBoardOpen] = useState(false);

  // Fetch games immediately — do not wait for wallet / streak / profile.
  useEffect(() => {
    let cancelled = false;
    const hadCache = Boolean(readCachedGamesList());

    async function loadGames(background = false) {
      if (!background) {
        setLoading(true);
        setError("");
      }

      try {
        const data = await fetchHomeShell(getCachedWallet() ?? undefined);
        if (cancelled) return;

        const nextGames = data.games ?? [];
        const nextPlayCounts = data.playCounts ?? {};
        const nextTestGameId = data.testGameId ?? null;
        setGames(nextGames);
        setPlayCounts(nextPlayCounts);
        setTestGameId(nextTestGameId);
        writeCachedGamesList({
          games: nextGames,
          playCounts: nextPlayCounts,
          testGameId: nextTestGameId,
          fetchedAt: Date.now(),
        });
      } catch (err) {
        if (cancelled) return;
        if (!background || !hadCache) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load games. Please try again."
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
      if (
        document.visibilityState === "visible" &&
        shouldBackgroundRefreshGamesList()
      ) {
        void loadGames(true);
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <div className="home">
      <div className="home-ambient" aria-hidden />
      <div className="home-shell">
        <header className="topbar">
          <Logo variant="header" />
          <div className="topbar-actions">
            <ActivityLeaderboardButton
              open={activityBoardOpen}
              onOpenChange={setActivityBoardOpen}
            />
            <SparkBatteryBar />
          </div>
        </header>

        <main className="home-main">
          {error ? (
            <p className="no-games">{error}</p>
          ) : loading ? (
            <div
              className="games-grid games-grid--loading"
              aria-busy="true"
              aria-label="Loading games"
            >
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="game-card-skeleton" aria-hidden />
              ))}
            </div>
          ) : games.length === 0 ? (
            <p className="no-games">No games yet. Check back soon!</p>
          ) : (
            <div className="games-grid">
              {games.map((game, index) => (
                <GameCard
                  key={game.id}
                  game={game}
                  playCount={playCounts[game.id] ?? 0}
                  priority={index < 4}
                />
              ))}
            </div>
          )}
        </main>

        <AppFooter testGameId={testGameId} />
      </div>

      <PromoPopupHost
        games={games}
        onOpenActivityBoard={() => setActivityBoardOpen(true)}
      />
    </div>
  );
}
