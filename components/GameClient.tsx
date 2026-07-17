"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
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
import { formatChainError } from "@/lib/celo-public-client";
import { purchaseScoreSubmitOnChain } from "@/lib/score-submit-purchase";
import {
  clearPendingLeaderboardSubmit,
  getLeaderboardSubmitResult,
  setPendingLeaderboardSubmit,
} from "@/lib/leaderboard-submit-result";
import { Game, gameHasContestLive, gameHasLeaderboard } from "@/types";

interface GameClientProps {
  game: Game;
  onScoreSubmitted?: () => void;
  onBackToMenu?: () => void;
}

const GAME_LOAD_FALLBACK_MS = 12000;
const PROGRESS_RETRY_DELAYS_MS = [0, 600, 1500, 3000] as const;

export default function GameClient({
  game,
  onScoreSubmitted,
  onBackToMenu,
}: GameClientProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [gameReady, setGameReady] = useState(false);
  const [submitToast, setSubmitToast] = useState<LeaderboardSubmitToastState | null>(
    null
  );
  /** Score waiting for a user tap — MiniPay needs a real gesture, not postMessage. */
  const [pendingSubmitScore, setPendingSubmitScore] = useState<number | null>(
    null
  );
  const [payingSubmit, setPayingSubmit] = useState(false);
  const personalBestRef = useRef(0);
  const leaderboardEnabled = gameHasLeaderboard(game);
  const contestLive = gameHasContestLive(game);
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

  const deliverProgressToUnity = useCallback(
    (
      payload: {
        highScore: number;
        level: number;
        hasLeaderboard: boolean;
      },
      opts?: {
        wallet?: string;
        playerName?: string;
        includeBootstrap?: boolean;
      }
    ) => {
      const progressMessage = {
        success: true,
        highScore: payload.highScore,
        score: payload.highScore,
        level: payload.level,
        hasLeaderboard: payload.hasLeaderboard,
      };

      sendToUnity(iframeRef, "OnProgressReceived", progressMessage);

      if (opts?.includeBootstrap !== false) {
        sendToUnity(iframeRef, "OnBootstrapDataReceived", {
          gameId: game.id,
          shellOrigin,
          walletAddress: opts?.wallet ?? resolvedWallet,
          playerName: opts?.playerName ?? resolvedName,
          contestLive,
          ...payload,
          score: payload.highScore,
          hints: 0,
          tutorialComplete: false,
          gamePurchased: true,
        });
      }
    },
    [
      game.id,
      shellOrigin,
      resolvedWallet,
      resolvedName,
      contestLive,
    ]
  );

  const scheduleProgressRetries = useCallback(
    (
      payload: {
        highScore: number;
        level: number;
        hasLeaderboard: boolean;
      },
      opts?: {
        wallet?: string;
        playerName?: string;
      }
    ) => {
      clearProgressRetries();
      progressRetryRef.current = PROGRESS_RETRY_DELAYS_MS.map((delay) =>
        setTimeout(() => {
          deliverProgressToUnity(payload, opts);
        }, delay)
      );
    },
    [clearProgressRetries, deliverProgressToUnity]
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
      onScoreSubmitted?.();
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
      message: formatChainError(new Error(error)),
    });
  }, [onScoreSubmitted]);

  const deliverLeaderboardSubmitResult = useCallback(
    (result: LeaderboardSubmitUnityResult) => {
      notifyUnityLeaderboardSubmit(iframeRef, result, { gameId: game.id });
      showSubmitFeedback(result);
    },
    [game.id, showSubmitFeedback]
  );

  const cancelPendingSubmit = useCallback(() => {
    if (payingSubmit) return;
    const score = pendingSubmitScore;
    setPendingSubmitScore(null);
    setSubmitToast(null);
    if (score != null) {
      clearPendingLeaderboardSubmit(game.id);
      deliverLeaderboardSubmitResult({
        success: false,
        highScore: personalBestRef.current,
        error: "Payment cancelled.",
      });
    }
  }, [payingSubmit, pendingSubmitScore, game.id, deliverLeaderboardSubmitResult]);

  const confirmPendingSubmit = useCallback(async () => {
    if (pendingSubmitScore == null || payingSubmit) return;

    const score = pendingSubmitScore;
    const wallet = walletAddress || profile?.walletAddress || "";
    if (!wallet) {
      setPendingSubmitScore(null);
      deliverLeaderboardSubmitResult({
        success: false,
        highScore: personalBestRef.current,
        error: "No wallet address available.",
      });
      return;
    }

    // Release Unity pointer lock so MiniPay can show the wallet sheet.
    try {
      document.exitPointerLock?.();
    } catch {
      /* ignore */
    }

    setPayingSubmit(true);
    setPendingSubmitScore(null);
    setSubmitToast({
      phase: "submitting",
      message: "Submitting score… Approve the payment in MiniPay.",
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
      deliverLeaderboardSubmitResult({
        success: false,
        highScore: personalBestRef.current,
        error: formatChainError(err),
      });
    } finally {
      setPayingSubmit(false);
    }
  }, [
    pendingSubmitScore,
    payingSubmit,
    walletAddress,
    profile?.walletAddress,
    game.id,
    deliverLeaderboardSubmitResult,
  ]);

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

  useEffect(() => {
    if (!gameReady || !resolvedWallet) return;

    let cancelled = false;

    async function resyncPersonalBest() {
      try {
        const { progress, hasLeaderboard } = await getGameProgress(
          game.id,
          resolvedWallet,
          { playerName: resolvedName || undefined }
        );
        if (cancelled) return;

        const highScore = progress.score ?? 0;
        personalBestRef.current = Math.max(personalBestRef.current, highScore);
        if (personalBestRef.current <= 0) return;

        deliverProgressToUnity(
          {
            highScore: personalBestRef.current,
            level: progress.level ?? 0,
            hasLeaderboard,
          },
          {
            wallet: resolvedWallet,
            playerName: resolvedName,
          }
        );
      } catch {
        // Best-effort resync for Unity home screen
      }
    }

    void resyncPersonalBest();
    return () => {
      cancelled = true;
    };
  }, [
    gameReady,
    game.id,
    resolvedWallet,
    resolvedName,
    deliverProgressToUnity,
  ]);

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
                force: true,
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

          deliverProgressToUnity(progressPayload, {
            wallet,
            playerName: bootstrapName,
          });

          scheduleProgressRetries(progressPayload, {
            wallet,
            playerName: bootstrapName,
          });
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
              score: highScore,
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
            deliverProgressToUnity(payload, {
              wallet,
              playerName: playerName || profile?.name || "",
            });
            scheduleProgressRetries(payload, {
              wallet,
              playerName: playerName || profile?.name || "",
            });
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

          // Don't open MiniPay from postMessage — wait for a user tap on the shell.
          try {
            document.exitPointerLock?.();
          } catch {
            /* ignore */
          }
          setPendingSubmitScore(score);
          setSubmitToast(null);
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
      deliverProgressToUnity,
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

      <div className="game-topbar">
        <button
          type="button"
          className="game-close-btn"
          aria-label="Back to menu"
          onClick={() => onBackToMenu?.()}
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

        {pendingSubmitScore != null && (
          <div className="lb-submit-confirm" role="dialog" aria-modal="true">
            <div className="lb-submit-confirm__card">
              <h3 className="lb-submit-confirm__title">Submit score?</h3>
              <p className="lb-submit-confirm__score">
                {pendingSubmitScore.toLocaleString()}
              </p>
              <p className="lb-submit-confirm__hint">
                Pay $0.05 in USDT or USDC. MiniPay will ask you to approve.
              </p>
              <div className="lb-submit-confirm__actions">
                <button
                  type="button"
                  className="lb-submit-confirm__cancel"
                  onClick={cancelPendingSubmit}
                  disabled={payingSubmit}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="lb-submit-confirm__pay"
                  onClick={() => void confirmPendingSubmit()}
                  disabled={payingSubmit}
                >
                  {payingSubmit ? "Opening wallet…" : "Pay & submit"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
