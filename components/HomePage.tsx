"use client";

import { useEffect, useMemo, useState } from "react";
import { Game, gameHasContestLive } from "@/types";
import AppFooter from "@/components/AppFooter";
import GameCard from "@/components/GameCard";
import HomeFilterBar, { type HomeSort } from "@/components/HomeFilterBar";
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

function applyHomeBrowse(
  games: Game[],
  sort: HomeSort,
  contestOnly: boolean,
  searchQuery: string,
  recentMap: Record<string, number>
): Game[] {
  let next = games;

  if (contestOnly) {
    next = next.filter((game) => gameHasContestLive(game));
  }

  const q = searchQuery.trim().toLowerCase();
  if (q) {
    next = next.filter((game) => game.name.toLowerCase().includes(q));
  }

  if (sort === "recent") {
    next = [...next]
      .filter((game) => recentMap[game.id] !== undefined)
      .sort((a, b) => (recentMap[b.id] ?? 0) - (recentMap[a.id] ?? 0));
  } else if (sort === "az") {
    next = [...next].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  } else if (sort === "za") {
    next = [...next].sort((a, b) =>
      b.name.localeCompare(a.name, undefined, { sensitivity: "base" })
    );
  } else if (sort === "latest") {
    next = [...next].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }

  return next;
}

function emptyMessage(
  sort: HomeSort,
  contestOnly: boolean,
  searchQuery: string,
  hasAnyGames: boolean
): string {
  if (!hasAnyGames) return "No games yet. Check back soon!";
  if (searchQuery.trim()) {
    return `No games match “${searchQuery.trim()}”.`;
  }
  if (contestOnly) {
    return "No live contests right now. Check back soon!";
  }
  if (sort === "recent") {
    return "No recently played games yet. Open a game to see it here.";
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
  const [sort, setSort] = useState<HomeSort>("default");
  const [contestOnly, setContestOnly] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
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
    () =>
      applyHomeBrowse(
        games,
        sort,
        contestOnly,
        searchOpen ? searchQuery : "",
        recentMap
      ),
    [games, sort, contestOnly, searchOpen, searchQuery, recentMap]
  );

  const handleSortChange = (next: HomeSort) => {
    setSort(next);
    if (next === "recent") {
      setRecentMap(getRecentPlayedMap());
    }
  };

  return (
    <div className="home">
      <div className="home-ambient" aria-hidden />
      <div className="home-shell">
        <header className="topbar home-sticky">
          <Logo variant="header" />
          <div className="topbar-actions">
            <ActivityLeaderboardButton />
            <SparkBatteryBar />
          </div>
        </header>

        <HomeFilterBar
          sort={sort}
          contestOnly={contestOnly}
          searchOpen={searchOpen}
          searchQuery={searchQuery}
          onSortChange={handleSortChange}
          onContestOnlyChange={setContestOnly}
          onSearchOpenChange={setSearchOpen}
          onSearchQueryChange={setSearchQuery}
        />

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
              {emptyMessage(
                sort,
                contestOnly,
                searchOpen ? searchQuery : "",
                games.length > 0
              )}
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
