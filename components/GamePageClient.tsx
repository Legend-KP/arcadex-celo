"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Game, gameContestLive, gameHasLeaderboard, gameIsLive } from "@/types";
import GameClient from "@/components/GameClient";
import GameMenu from "@/components/GameMenu";
import Leaderboard from "@/components/Leaderboard";
import LoadingScreen from "@/components/LoadingScreen";
import NewHighScoreBanner from "@/components/NewHighScoreBanner";
import NoSparksModal from "@/components/NoSparksModal";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { useSparks } from "@/components/SparkProvider";
import { useResolvedWallet } from "@/lib/use-resolved-wallet";

export default function GamePageClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { walletAddress, playerName } = usePlayerProfile();
  const resolvedWallet = useResolvedWallet(walletAddress);
  const { sparks, spendForGame } = useSparks();
  const [game, setGame] = useState<Game | null>(null);
  const [started, setStarted] = useState(false);
  const [lbOpen, setLbOpen] = useState(false);
  const [highScoreBannerOpen, setHighScoreBannerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [sparkError, setSparkError] = useState("");
  const [noSparksOpen, setNoSparksOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadGame() {
      setLoading(true);
      setError("");

      try {
        const res = await fetch(`/api/games/${id}`, { cache: "no-store" });
        const data = (await res.json()) as { game?: Game; error?: string };

        if (!res.ok) {
          throw new Error(data.error ?? "Game not found.");
        }

        if (!cancelled) {
          setGame(data.game ?? null);
          if (data.game && gameIsLive(data.game)) {
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

  const handleStart = useCallback(async () => {
    setSparkError("");

    if (!walletAddress) {
      setSparkError("Connect your wallet in MiniPay to play.");
      return;
    }

    if (!sparks.hasInfinite && sparks.available === 0) {
      setNoSparksOpen(true);
      return;
    }

    setStarting(true);
    try {
      await spendForGame();
      setStarted(true);
    } catch (err) {
      setSparkError(
        err instanceof Error ? err.message : "Could not use a Spark."
      );
    } finally {
      setStarting(false);
    }
  }, [walletAddress, sparks.hasInfinite, sparks.available, spendForGame]);

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

  if (!gameIsLive(game)) {
    return (
      <div className="coming-soon-screen">
        <p className="coming-soon-screen__title">Coming Soon</p>
        <p className="coming-soon-screen__subtitle">{game.name} is not available yet.</p>
        <button
          type="button"
          className="game-menu-btn game-menu-btn--back"
          onClick={() => router.push("/")}
        >
          Back
        </button>
      </div>
    );
  }

  function handleGetSpark() {
    setNoSparksOpen(false);
    sessionStorage.setItem("openSparkPanel", "1");
    router.push("/");
  }

  return (
    <>
      {!started ? (
        <GameMenu
          game={game}
          onStart={handleStart}
          onLeaderboard={() => setLbOpen(true)}
          starting={starting}
          sparkError={sparkError}
        />
      ) : (
        <>
          <GameClient
            game={game}
            onNewHighScore={() => setHighScoreBannerOpen(true)}
          />
          {gameHasLeaderboard(game) && (
            <NewHighScoreBanner
              visible={highScoreBannerOpen}
              onOpenLeaderboard={() => {
                setHighScoreBannerOpen(false);
                setLbOpen(true);
              }}
              onDismiss={() => setHighScoreBannerOpen(false)}
            />
          )}
        </>
      )}
      {gameHasLeaderboard(game) && (
        <Leaderboard
          gameId={game.id}
          gameName={game.name}
          open={lbOpen}
          contestLive={gameContestLive(game)}
          walletAddress={resolvedWallet}
          playerName={playerName}
          onClose={() => setLbOpen(false)}
          onSubmitted={() => setHighScoreBannerOpen(false)}
        />
      )}
      <NoSparksModal
        open={noSparksOpen}
        onClose={() => setNoSparksOpen(false)}
        onGetSpark={handleGetSpark}
      />
    </>
  );
}
