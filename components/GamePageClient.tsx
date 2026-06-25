"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Game, gameHasLeaderboard, gameIsLive } from "@/types";
import GameClient from "@/components/GameClient";
import GameMenu from "@/components/GameMenu";
import Leaderboard from "@/components/Leaderboard";
import LoadingScreen from "@/components/LoadingScreen";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { useSparks } from "@/components/SparkProvider";
import { formatSparkDuration } from "@/lib/spark";

type SparkGate = "pending" | "allowed" | "blocked";

export default function GamePageClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { walletAddress, isReady: profileReady } = usePlayerProfile();
  const { sparks, loading: sparksLoading, spendForGame } = useSparks();
  const [game, setGame] = useState<Game | null>(null);
  const [started, setStarted] = useState(false);
  const [lbOpen, setLbOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sparkGate, setSparkGate] = useState<SparkGate>("pending");
  const [sparkError, setSparkError] = useState("");
  const spendAttemptedRef = useRef(false);

  useEffect(() => {
    spendAttemptedRef.current = false;
    setSparkGate("pending");
    setSparkError("");
  }, [id]);

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

  useEffect(() => {
    if (!game || !gameIsLive(game) || !profileReady || sparksLoading) return;

    let cancelled = false;

    async function gateEntry() {
      setSparkGate("pending");
      setSparkError("");

      if (!walletAddress) {
        if (!cancelled) {
          setSparkGate("blocked");
          setSparkError("Connect your wallet in MiniPay to play.");
        }
        return;
      }

      if (spendAttemptedRef.current) return;
      spendAttemptedRef.current = true;

      try {
        await spendForGame(game!.id);
        if (!cancelled) setSparkGate("allowed");
      } catch (err) {
        if (!cancelled) {
          setSparkGate("blocked");
          setSparkError(
            err instanceof Error ? err.message : "Could not use a Spark."
          );
        }
      }
    }

    gateEntry();
    return () => {
      cancelled = true;
    };
  }, [game, profileReady, sparksLoading, walletAddress, spendForGame]);

  if (loading || sparkGate === "pending") {
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

  if (sparkGate === "blocked") {
    const waitLabel =
      sparks.timeToFullMs > 0
        ? formatSparkDuration(sparks.timeToFullMs)
        : null;

    return (
      <div className="coming-soon-screen spark-gate-screen">
        <p className="coming-soon-screen__title">No Sparks</p>
        <p className="coming-soon-screen__subtitle">
          {sparkError || "You need a Spark to enter this game."}
        </p>
        {!sparks.hasInfinite && waitLabel && (
          <p className="spark-gate-screen__timer">
            Full in <strong>{waitLabel}</strong>
          </p>
        )}
        <button
          type="button"
          className="game-menu-btn game-menu-btn--back"
          onClick={() => router.push("/")}
        >
          Back to Arcade
        </button>
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
