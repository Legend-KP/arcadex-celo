"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import ExitGameModal from "@/components/ExitGameModal";
import LoadingScreen from "@/components/LoadingScreen";
import LeaderboardSubmitToast, {
  type LeaderboardSubmitToastState,
} from "@/components/LeaderboardSubmitToast";
import {
  normalizeUnityMessageType,
  notifyUnityLeaderboardSubmit,
  replayLeaderboardSubmitToUnity,
  sendToUnity,
  UnityMessage,
  type LeaderboardSubmitUnityResult,
} from "@/lib/bridge";
import { getLeaderboard } from "@/lib/firebase";
import { getGameProgress, saveGameProgress } from "@/lib/game-progress-client";
import { submitScoreToLeaderboard } from "@/lib/leaderboard-client";
import { buildGameIframeUrl, getShellOrigin } from "@/lib/game-iframe-url";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { resolveWalletOnAppOpen } from "@/lib/walletAuth";
import { getGameTheme } from "@/lib/game-themes";
import { purchaseScoreSubmitOnChain } from "@/lib/score-submit-purchase";
import {
  clearPendingLeaderboardSubmit,
  getLeaderboardSubmitResult,
  setPendingLeaderboardSubmit,
} from "@/lib/leaderboard-submit-result";
import { Game, gameHasContestLive, gameHasLeaderboard } from "@/types";

interface GameClientProps {
  game: Game;
}

const GAME_LOAD_FALLBACK_MS = 12000;
const PROGRESS_RETRY_DELAYS_MS = [0, 600, 1500, 3000] as const;

export default function GameClient({ game }: GameClientProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const [exitOpen, setExitOpen] = useState(false);
  const [gameReady, setGameReady] = useState(false);
  const [submitToast, setSubmitToast] = useState<LeaderboardSubmitToastState | null>(
    null
  );
  const personalBestRef = useRef(0);
  const leaderboardEnabled = gameHasLeaderboard(game);
  const contestLive = gameHasContestLive(game);
  const theme = getGameTheme(game);
  const shellOrigin = getShellOrigin();
  const progressRetryRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const {
    playerName,
    profile,
    walletAddress,
    isReady,
    updateWalletAddress,
  } = usePlayerProfile();

  const resolvedName = playerName || profile?.name || "";
  const resolvedWallet = walletAddress || profile?.walletAddress || "";

  const iframeSrc = useMemo(() => {
    if (!isReady) return null;
    return buildGameIframeUrl(game.url, {
      gameId: game.id,
      shellOrigin,
      walletAddress: resolvedWallet || undefined,
      playerName: resolvedName || undefined,
      hasLeaderboard: leaderboardEnabled,
    });
  }, [
    isReady,
    game.url,
    game.id,
    shellOrigin,
    resolvedWallet,
    resolvedName,
    leaderboardEnabled,
  ]);

  const clearProgressRetries = useCallback(() => {
    for (const id of progressRetryRef.current) clearTimeout(id);
    progressRetryRef.current = [];
  }, []);

  const scheduleProgressRetries = useCallback(
    (payload: {
      highScore: number;
      level: number;
      hasLeaderboard: boolean;
    }) => {
      clearProgressRetries();
      progressRetryRef.current = PROGRESS_RETRY_DELAYS_MS.map((delay) =>
        setTimeout(() => {
          sendToUnity(iframeRef, "OnProgressReceived", {
            success: true,
            ...payload,
          });
        }, delay)
      );
    },
    [clearProgressRetries]
  );

  const markGameReady = useCallback(() => {
    if (loadFallbackRef.current) {
      clearTimeout(loadFallbackRef.current);
      loadFallbackRef.current = null;
    }
    setGameReady(true);
  }, []);

  const scheduleLoadFallback = useCallback(() => {
    if (loadFallbackRef.current) clearTimeout(loadFallbackRef.current);
    loadFallbackRef.current = setTimeout(markGameReady, GAME_LOAD_FALLBACK_MS);
  }, [markGameReady]);

  const persistScore = useCallback(
    async (score: number, name: string, resolvedWalletAddr: string) => {
      const previousBest = personalBestRef.current;
      const result = await saveGameProgress(game.id, resolvedWalletAddr, score, {
        playerName: name,
      });
      const nextBest = result.progress.score ?? score;
      if (nextBest > previousBest) {
        personalBestRef.current = nextBest;
      }
      return nextBest;
    },
    [game.id]
  );

  const showSubmitFeedback = useCallback((result: LeaderboardSubmitUnityResult) => {
    if (result.success) {
      setSubmitToast({
        phase: "success",
        message: "Score submitted to the leaderboard!",
      });
      return;
    }

    const error = result.error?.trim();
    if (
      !error ||
      error.toLowerCase().includes("user rejected") ||
      error.toLowerCase().includes("denied")
    ) {
      setSubmitToast({
        phase: "error",
        message: "Payment cancelled.",
      });
      return;
    }

    setSubmitToast({
      phase: "error",
      message: error,
    });
  }, []);

  const deliverLeaderboardSubmitResult = useCallback(
    (result: LeaderboardSubmitUnityResult) => {
      notifyUnityLeaderboardSubmit(iframeRef, result, { gameId: game.id });
      showSubmitFeedback(result);
    },
    [game.id, showSubmitFeedback]
  );

  const replayStoredSubmitResult = useCallback(() => {
    const stored = getLeaderboardSubmitResult(game.id);
    if (!stored) return;
    replayLeaderboardSubmitToUnity(iframeRef, game.id, stored);
  }, [game.id]);

  useEffect(() => {
    setGameReady(false);
    return () => {
      if (loadFallbackRef.current) clearTimeout(loadFallbackRef.current);
      clearProgressRetries();
    };
  }, [game.url, clearProgressRetries]);

  useEffect(() => {
    if (!gameReady) return;
    replayStoredSubmitResult();
  }, [gameReady, replayStoredSubmitResult]);

  const handleMessage = useCallback(
    async (event: MessageEvent) => {
      const msg = event.data as UnityMessage;
      const bridgeType = normalizeUnityMessageType(msg.type);
      if (!bridgeType) {
        if (msg?.type?.startsWith("MINIPAY_")) {
          console.warn("[ArcadeX bridge] unhandled legacy message:", msg.type);
        }
        return;
      }

      switch (bridgeType) {
        case "GAME_BOOTSTRAP": {
          markGameReady();
          const wallet =
            walletAddress ||
            profile?.walletAddress ||
            (await resolveWalletOnAppOpen()) ||
            "";

          if (wallet) {
            sendToUnity(iframeRef, "OnWalletAddressResolved", wallet);
          }

          const bootstrapName = playerName || profile?.name || "";
          let highScore = 0;
          let level = 0;
          if (wallet) {
            try {
              const { progress } = await getGameProgress(game.id, wallet, {
                playerName: bootstrapName || undefined,
              });
              highScore = progress.score ?? 0;
              level = progress.level ?? 0;
              personalBestRef.current = highScore;
            } catch {
              // Progress is optional during bootstrap
            }
          }

          const progressPayload = {
            highScore,
            level,
            hasLeaderboard: leaderboardEnabled,
          };

          sendToUnity(iframeRef, "OnBootstrapDataReceived", {
            gameId: game.id,
            shellOrigin,
            walletAddress: wallet,
            playerName: bootstrapName,
            contestLive,
            ...progressPayload,
            hints: 0,
            tutorialComplete: false,
            gamePurchased: true,
          });

          scheduleProgressRetries(progressPayload);
          replayStoredSubmitResult();
          break;
        }

        case "GAME_LEADERBOARD_GET": {
          if (!leaderboardEnabled) {
            sendToUnity(iframeRef, "OnLeaderboardReceived", []);
            break;
          }
          const { entries } = await getLeaderboard(game.id);
          sendToUnity(iframeRef, "OnLeaderboardReceived", entries);
          break;
        }

        case "GAME_PROGRESS_SAVE": {
          const payload = (msg.payload ?? {}) as {
            name?: string;
            score?: number;
            value?: number;
            walletAddress?: string;
          };
          const progressValue =
            typeof payload.value === "number"
              ? payload.value
              : typeof payload.score === "number"
                ? payload.score
                : undefined;
          const saveCallback =
            msg.type === "MINIPAY_SUBMIT_SCORE"
              ? "OnScoreSubmitted"
              : "OnProgressSaved";

          if (!leaderboardEnabled) {
            sendToUnity(iframeRef, saveCallback, {
              success: false,
              error: "Leaderboard disabled for this game.",
            });
            break;
          }
          if (typeof progressValue !== "number") {
            sendToUnity(iframeRef, saveCallback, {
              success: false,
              error: "score is required.",
            });
            break;
          }
          const resolvedWalletAddr =
            walletAddress || payload.walletAddress || profile?.walletAddress || "";
          if (!resolvedWalletAddr) {
            sendToUnity(iframeRef, saveCallback, {
              success: false,
              error: "No wallet address available.",
            });
            break;
          }
          if (
            payload.walletAddress &&
            payload.walletAddress !== profile?.walletAddress
          ) {
            updateWalletAddress(payload.walletAddress).catch(() => {
              // Wallet sync is best-effort
            });
          }
          try {
            const highScore = await persistScore(
              progressValue,
              playerName || payload.name || "",
              resolvedWalletAddr
            );
            sendToUnity(iframeRef, saveCallback, {
              success: true,
              highScore,
            });
          } catch (err) {
            sendToUnity(iframeRef, saveCallback, {
              success: false,
              error:
                err instanceof Error
                  ? err.message
                  : "Could not save score.",
            });
          }
          break;
        }

        case "GAME_PROGRESS_GET": {
          const wallet =
            walletAddress || profile?.walletAddress || "";
          if (!wallet) {
            sendToUnity(iframeRef, "OnProgressReceived", {
              success: false,
              error: "No wallet address available.",
            });
            break;
          }
          try {
            const { progress, hasLeaderboard } = await getGameProgress(
              game.id,
              wallet,
              { playerName: playerName || profile?.name || undefined }
            );
            const payload = {
              highScore: progress.score ?? 0,
              level: progress.level ?? 0,
              hasLeaderboard,
            };
            personalBestRef.current = payload.highScore;
            sendToUnity(iframeRef, "OnProgressReceived", {
              success: true,
              ...payload,
            });
            scheduleProgressRetries(payload);
          } catch (err) {
            sendToUnity(iframeRef, "OnProgressReceived", {
              success: false,
              error:
                err instanceof Error
                  ? err.message
                  : "Could not load progress.",
            });
          }
          break;
        }

        case "GAME_LEADERBOARD_SUBMIT": {
          const notifyFailure = (error: string) => {
            deliverLeaderboardSubmitResult({
              success: false,
              highScore: personalBestRef.current,
              error,
            });
          };

          if (!leaderboardEnabled) {
            notifyFailure("Leaderboard disabled for this game.");
            break;
          }
          const { score } = (msg.payload ?? {}) as { score?: number };
          const wallet =
            walletAddress || profile?.walletAddress || "";
          if (!wallet) {
            notifyFailure("No wallet address available.");
            break;
          }
          if (typeof score !== "number" || score <= 0) {
            notifyFailure("score is required.");
            break;
          }
          setSubmitToast({
            phase: "submitting",
            message: "Submitting score… Please approve the payment.",
          });
          setPendingLeaderboardSubmit(game.id, score);
          try {
            const { txHash } = await purchaseScoreSubmitOnChain();
            const result = await submitScoreToLeaderboard(game.id, {
              walletAddress: wallet,
              txHash,
              score,
            });
            clearPendingLeaderboardSubmit(game.id);
            deliverLeaderboardSubmitResult({
              success: true,
              highScore: result.highScore,
              leaderboardScore: result.leaderboardScore,
            });
          } catch (err) {
            clearPendingLeaderboardSubmit(game.id);
            notifyFailure(
              err instanceof Error
                ? err.message
                : "Could not submit score."
            );
          }
          break;
        }

        case "GAME_LEADERBOARD_SUBMIT_POLL": {
          const stored = getLeaderboardSubmitResult(game.id);
          if (stored) {
            replayLeaderboardSubmitToUnity(iframeRef, game.id, stored);
          } else {
            notifyUnityLeaderboardSubmit(
              iframeRef,
              {
                success: false,
                highScore: personalBestRef.current,
                error: "No submit result available yet.",
              },
              { persist: false }
            );
          }
          break;
        }

        default:
          console.warn("[ArcadeX bridge] unhandled message:", bridgeType);
      }
    },
    [
      game.id,
      leaderboardEnabled,
      contestLive,
      playerName,
      profile?.name,
      profile?.walletAddress,
      walletAddress,
      shellOrigin,
      updateWalletAddress,
      markGameReady,
      scheduleProgressRetries,
      persistScore,
      deliverLeaderboardSubmitResult,
      replayStoredSubmitResult,
    ]
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  return (
    <div className="game-page">
      {!gameReady && (
        <div className="game-loading-overlay" aria-hidden={false}>
          <LoadingScreen message="Loading game" />
        </div>
      )}

      <div
        className={`game-topbar${theme.text === "#ffffff" ? " game-topbar--on-dark" : ""}`}
        style={
          {
            "--game-topbar-bg": theme.topbar,
            "--game-topbar-text": theme.text,
          } as React.CSSProperties
        }
      >
        <button
          type="button"
          className="game-close-btn"
          aria-label="Go home"
          onClick={() => setExitOpen(true)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/home-button.png" alt="" className="game-home-btn-icon" />
        </button>
        <span className="game-title-bar">{game.name}</span>
        <div className="game-topbar-spacer" aria-hidden="true" />
      </div>

      <div className="iframe-wrap">
        {!isReady || !iframeSrc ? (
          <LoadingScreen message="Connecting wallet" />
        ) : (
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            title={game.name}
            allow="fullscreen; autoplay"
            allowFullScreen
            className={`game-iframe${gameReady ? "" : " game-iframe--preparing"}`}
            onLoad={scheduleLoadFallback}
          />
        )}

        <LeaderboardSubmitToast
          toast={submitToast}
          onDismiss={() => setSubmitToast(null)}
        />
      </div>

      <ExitGameModal
        open={exitOpen}
        onCancel={() => setExitOpen(false)}
        onExit={() => router.push("/")}
        onPlayMore={() => router.push("/")}
      />
    </div>
  );
}
