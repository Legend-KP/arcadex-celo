"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Game, gameHasLeaderboard, gameHasContestLive, gameIsLive } from "@/types";
import GameClient from "@/components/GameClient";
import GameMenu from "@/components/GameMenu";
import Leaderboard from "@/components/Leaderboard";
import SubmitScorePanel from "@/components/SubmitScorePanel";
import LoadingScreen from "@/components/LoadingScreen";
import NoSparksModal from "@/components/NoSparksModal";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { useSparks } from "@/components/SparkProvider";
import { getLeaderboard } from "@/lib/leaderboard-client";

export default function GamePageClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { walletAddress, playerName } = usePlayerProfile();
  const { sparks, spendForGame } = useSparks();
  const [game, setGame] = useState<Game | null>(null);
  const [started, setStarted] = useState(false);
  const [lbOpen, setLbOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [pendingScore, setPendingScore] = useState<number | undefined>();
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

  const openSubmitPanel = useCallback((score?: number) => {
    setPendingScore(score);
    setSubmitOpen(true);
    setLbOpen(false);
  }, []);

  const openLeaderboardView = useCallback(async () => {
    if (!game || !walletAddress) {
      setLbOpen(true);
      setSubmitOpen(false);
      return;
    }

    try {
      const data = await getLeaderboard(game.id, {
        walletAddress,
        playerName: playerName || undefined,
      });
      if (data.canSubmit) {
        openSubmitPanel(data.personalBest);
      } else {
        setLbOpen(true);
        setSubmitOpen(false);
      }
    } catch {
      setLbOpen(true);
      setSubmitOpen(false);
    }
  }, [game, walletAddress, playerName, openSubmitPanel]);

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
          onLeaderboard={() => void openLeaderboardView()}
          starting={starting}
          sparkError={sparkError}
        />
      ) : (
        <GameClient
          game={game}
          onOpenSubmitScore={openSubmitPanel}
        />
      )}
      {gameHasLeaderboard(game) && (
        <>
          <SubmitScorePanel
            gameId={game.id}
            gameName={game.name}
            contestLive={gameHasContestLive(game)}
            open={submitOpen}
            pendingScore={pendingScore}
            onClose={() => {
              setSubmitOpen(false);
              setPendingScore(undefined);
            }}
            onSubmitted={() => {
              setTimeout(() => {
                setSubmitOpen(false);
                setPendingScore(undefined);
              }, 1500);
            }}
          />
          <Leaderboard
            gameId={game.id}
            gameName={game.name}
            contestLive={gameHasContestLive(game)}
            open={lbOpen}
            onClose={() => setLbOpen(false)}
          />
        </>
      )}
      <NoSparksModal
        open={noSparksOpen}
        onClose={() => setNoSparksOpen(false)}
        onGetSpark={handleGetSpark}
      />
    </>
  );
}
