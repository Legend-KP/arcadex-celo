"use client";

import { useEffect, useMemo, useState } from "react";
import { Game, gameHasContestLive } from "@/types";
import AppFooter from "@/components/AppFooter";
import GameCard from "@/components/GameCard";
import HomeFilterBar, { type HomeFilter } from "@/components/HomeFilterBar";
import Logo from "@/components/Logo";
import SparkBatteryBar from "@/components/SparkBatteryBar";
import ActivityLeaderboardButton from "@/components/ActivityLeaderboardButton";
import {
  readCachedGamesList,
  writeCachedGamesList,
} from "@/lib/games-list-client-cache";
import { fetchHomeShell } from "@/lib/home-client";
import { getCachedWallet } from "@/lib/player-id";
import { getRecentPlayedMap } from "@/lib/recent-played";

function filterGames(
  games: Game[],
  filter: HomeFilter,
  searchQuery: string,
  recentMap: Record<string, number>
): Game[] {
  if (filter === "contest") {
    return games.filter((game) => gameHasContestLive(game));
  }

  if (filter === "recent") {
    return games
      .filter((game) => recentMap[game.id] !== undefined)
      .sort((a, b) => (recentMap[b.id] ?? 0) - (recentMap[a.id] ?? 0));
  }

  if (filter === "search") {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return games;
    return games.filter((game) => game.name.toLowerCase().includes(q));
  }

  return games;
}

function emptyMessage(
  filter: HomeFilter,
  searchQuery: string,
  hasAnyGames: boolean
): string {
  if (!hasAnyGames) return "No games yet. Check back soon!";
  if (filter === "recent") {
    return "No recently played games yet. Open a game to see it here.";
  }
  if (filter === "contest") {
    return "No live contests right now. Check back soon!";
  }
  if (filter === "search" && searchQuery.trim()) {
    return `No games match “${searchQuery.trim()}”.`;
  }
  if (filter === "search") {
    return "Type a game name to search.";
  }
  return "No games yet. Check back soon!";
}

export default function HomePage() {
  const [games, setGames] = useState<Game[]>(() => {
    return readCachedGamesList()?.games ?? [];
  });
  const [playCounts, setPlayCounts] = useState<Record<string, number>>(() => {
    return readCachedGamesList()?.playCounts ?? {};
  });
  const [loading, setLoading] = useState(() => !readCachedGamesList());
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<HomeFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [recentMap, setRecentMap] = useState<Record<string, number>>({});

  useEffect(() => {
    setRecentMap(getRecentPlayedMap());

    const refreshRecent = () => setRecentMap(getRecentPlayedMap());
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshRecent();
    };

    window.addEventListener("focus", refreshRecent);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refreshRecent);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

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
      if (document.visibilityState === "visible") {
        void loadGames(true);
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const visibleGames = useMemo(
    () => filterGames(games, filter, searchQuery, recentMap),
    [games, filter, searchQuery, recentMap]
  );

  const handleFilterChange = (next: HomeFilter) => {
    setFilter(next);
    if (next === "recent") {
      setRecentMap(getRecentPlayedMap());
    }
    if (next !== "search") {
      setSearchQuery("");
    }
  };

  return (
    <div className="home">
      <div className="home-ambient" aria-hidden />
      <div className="home-shell">
        <div className="home-sticky">
          <header className="topbar">
            <Logo variant="header" />
            <div className="topbar-actions">
              <ActivityLeaderboardButton />
              <SparkBatteryBar />
            </div>
          </header>

          <HomeFilterBar
            filter={filter}
            searchQuery={searchQuery}
            onFilterChange={handleFilterChange}
            onSearchQueryChange={setSearchQuery}
          />
        </div>

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
          ) : visibleGames.length === 0 ? (
            <p className="no-games">
              {emptyMessage(filter, searchQuery, games.length > 0)}
            </p>
          ) : (
            <div className="games-grid">
              {visibleGames.map((game, index) => (
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

        <AppFooter />
      </div>
    </div>
  );
}
