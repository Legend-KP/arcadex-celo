"use client";

import { useEffect, useMemo, useState } from "react";
import { Game, gameHasContestLive, gameIsLive } from "@/types";
import AchievementsView from "@/components/AchievementsView";
import ActivityLeaderboardButton from "@/components/ActivityLeaderboardButton";
import ActivityLeaderboardView from "@/components/ActivityLeaderboardView";
import AppDrawer, { type AppView } from "@/components/AppDrawer";
import GameCard from "@/components/GameCard";
import HomeFilterBar, { type HomeSort } from "@/components/HomeFilterBar";
import Logo from "@/components/Logo";
import SparkBatteryBar from "@/components/SparkBatteryBar";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
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

function formatRelativePlayed(playedAt: number): string {
  const dayMs = 24 * 60 * 60 * 1000;
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const start = startToday.getTime();
  if (playedAt >= start) return "Last played today";
  if (playedAt >= start - dayMs) return "Last played yesterday";
  return "Recently played";
}

function openSparkPanel() {
  try {
    sessionStorage.setItem("openSparkPanel", "1");
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event("arcadex:open-spark-panel"));
}

function GamesCatalog({
  games,
  playCounts,
  loading,
  error,
  empty,
  priorityCount = 4,
}: {
  games: Game[];
  playCounts: Record<string, number>;
  loading: boolean;
  error: string;
  empty: string;
  priorityCount?: number;
}) {
  if (error) return <p className="no-games">{error}</p>;
  if (loading) {
    return (
      <div
        className="games-grid games-grid--loading"
        aria-busy="true"
        aria-label="Loading games"
      >
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="game-card-skeleton" aria-hidden />
        ))}
      </div>
    );
  }
  if (games.length === 0) return <p className="no-games">{empty}</p>;
  return (
    <div className="games-grid">
      {games.map((game, index) => (
        <GameCard
          key={game.id}
          game={game}
          playCount={playCounts[game.id] ?? 0}
          priority={index < priorityCount}
        />
      ))}
    </div>
  );
}

function HorizontalGameRow({
  title,
  badge,
  games,
  playCounts,
  recentMap,
  showContestTimer,
  empty,
}: {
  title: string;
  badge?: string | number;
  games: Game[];
  playCounts: Record<string, number>;
  recentMap?: Record<string, number>;
  showContestTimer?: boolean;
  empty?: string;
}) {
  if (games.length === 0) {
    return empty ? (
      <section className="home-section">
        <div className="home-section__head">
          <h2 className="home-section__title">{title}</h2>
        </div>
        <p className="home-section__empty">{empty}</p>
      </section>
    ) : null;
  }

  return (
    <section className="home-section">
      <div className="home-section__head">
        <h2 className="home-section__title">
          {title}
          {badge !== undefined && (
            <span className="home-section__badge">{badge}</span>
          )}
        </h2>
      </div>
      <div className="home-rail" role="list">
        {games.map((game, index) => (
          <div key={game.id} className="home-rail__item" role="listitem">
            <GameCard
              game={game}
              variant="square"
              playCount={playCounts[game.id] ?? 0}
              priority={index < 3}
              showContestTimer={showContestTimer}
              subtitle={
                recentMap?.[game.id]
                  ? formatRelativePlayed(recentMap[game.id])
                  : undefined
              }
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function HomePage() {
  const { playerName, walletAddress, openOnboarding } = usePlayerProfile();
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [view, setView] = useState<AppView>("home");

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

  const liveGames = useMemo(
    () => games.filter((g) => gameIsLive(g)),
    [games]
  );
  const contestGames = useMemo(
    () => games.filter((g) => gameHasContestLive(g)),
    [games]
  );
  const comingSoonGames = useMemo(
    () => games.filter((g) => !gameIsLive(g)),
    [games]
  );
  const continueGames = useMemo(() => {
    const ids = Object.keys(recentMap).sort(
      (a, b) => (recentMap[b] ?? 0) - (recentMap[a] ?? 0)
    );
    const byId = new Map(liveGames.map((g) => [g.id, g]));
    return ids
      .map((id) => byId.get(id))
      .filter((g): g is Game => Boolean(g))
      .slice(0, 12);
  }, [liveGames, recentMap]);

  const catalogGames = useMemo(() => {
    const source =
      view === "contests"
        ? contestGames
        : view === "games"
          ? liveGames
          : liveGames;
    return applyHomeBrowse(
      source,
      sort,
      view === "home" ? contestOnly : view === "contests",
      searchOpen ? searchQuery : "",
      recentMap
    );
  }, [
    view,
    contestGames,
    liveGames,
    sort,
    contestOnly,
    searchOpen,
    searchQuery,
    recentMap,
  ]);

  const gameNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of games) map[g.id] = g.name;
    return map;
  }, [games]);

  const handleSortChange = (next: HomeSort) => {
    setSort(next);
    if (next === "recent") {
      setRecentMap(getRecentPlayedMap());
    }
  };

  const showCatalogFilters = view === "home" || view === "games" || view === "contests";

  return (
    <div className="home">
      <div className="home-ambient" aria-hidden />
      <AppDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        view={view}
        onNavigate={setView}
        onOpenSparks={openSparkPanel}
        onOpenTutorial={openOnboarding}
        playerName={playerName}
        walletAddress={walletAddress}
      />

      <div className="home-shell">
        <header className="topbar home-sticky">
          <button
            type="button"
            className="home-menu-btn"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
          >
            <span className="home-menu-btn__bars" aria-hidden />
          </button>
          <Logo variant="header" />
          <div className="topbar-actions">
            <ActivityLeaderboardButton />
            <SparkBatteryBar />
          </div>
        </header>

        {showCatalogFilters && view !== "home" && (
          <HomeFilterBar
            sort={sort}
            contestOnly={view === "contests" ? true : contestOnly}
            searchOpen={searchOpen}
            searchQuery={searchQuery}
            onSortChange={handleSortChange}
            onContestOnlyChange={
              view === "contests" ? () => undefined : setContestOnly
            }
            onSearchOpenChange={setSearchOpen}
            onSearchQueryChange={setSearchQuery}
          />
        )}

        <main className="home-main">
          {view === "home" && (
            <>
              <HorizontalGameRow
                title="Live contests"
                badge={contestGames.length || undefined}
                games={contestGames}
                playCounts={playCounts}
                showContestTimer
              />
              <HorizontalGameRow
                title="Continue playing"
                games={continueGames}
                playCounts={playCounts}
                recentMap={recentMap}
              />

              <section className="home-section home-section--catalog">
                <div className="home-section__head">
                  <h2 className="home-section__title">All games</h2>
                </div>
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
                <GamesCatalog
                  games={applyHomeBrowse(
                    liveGames,
                    sort,
                    contestOnly,
                    searchOpen ? searchQuery : "",
                    recentMap
                  )}
                  playCounts={playCounts}
                  loading={loading}
                  error={error}
                  empty={emptyMessage(
                    sort,
                    contestOnly,
                    searchOpen ? searchQuery : "",
                    liveGames.length > 0
                  )}
                />
              </section>

              <HorizontalGameRow
                title="Coming soon"
                games={comingSoonGames}
                playCounts={playCounts}
              />
            </>
          )}

          {(view === "games" || view === "contests") && (
            <GamesCatalog
              games={catalogGames}
              playCounts={playCounts}
              loading={loading}
              error={error}
              empty={emptyMessage(
                sort,
                view === "contests" || contestOnly,
                searchOpen ? searchQuery : "",
                (view === "contests" ? contestGames : liveGames).length > 0
              )}
            />
          )}

          {view === "leaderboard" && <ActivityLeaderboardView />}
          {view === "achievements" && (
            <AchievementsView gameNames={gameNames} />
          )}
        </main>
      </div>
    </div>
  );
}
