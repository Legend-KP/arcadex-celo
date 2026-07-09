"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import ExitGameModal from "@/components/ExitGameModal";
import LoadingScreen from "@/components/LoadingScreen";
import SubmitScorePopup from "@/components/SubmitScorePopup";
import { sendToUnity } from "@/lib/bridge";
import { getLeaderboard } from "@/lib/firebase";
import { getGameProgress } from "@/lib/game-progress-client";
import { getLeaderboardStatus } from "@/lib/leaderboard-client";
import { buildGameIframeUrl, getShellOrigin } from "@/lib/game-iframe-url";
import {
  clearPendingScore,
  setPendingScore,
} from "@/lib/pending-score";
import { executePaidScoreSubmit } from "@/lib/submit-score-flow";
import {
  parseIncomingUnityMessage,
  parseProgressPayload,
} from "@/lib/unity-message";
import { useResolvedWallet } from "@/lib/use-resolved-wallet";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { resolveWalletOnAppOpen } from "@/lib/walletAuth";
import { getGameTheme } from "@/lib/game-themes";
import { Game, gameContestLive, gameHasLeaderboard } from "@/types";

interface GameClientProps {
  game: Game;
  onScoreSubmitted?: () => void;
}

const GAME_LOAD_FALLBACK_MS = 12000;
const PROGRESS_RETRY_DELAYS_MS = [0, 600, 1500, 3000] as const;

export default function GameClient({ game, onScoreSubmitted }: GameClientProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const [exitOpen, setExitOpen] = useState(false);
  const [gameReady, setGameReady] = useState(false);
  const [submitPopupOpen, setSubmitPopupOpen] = useState(false);
  const [pendingScore, setPendingScoreState] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const leaderboardEnabled = gameHasLeaderboard(game);
  const theme = getGameTheme(game);
  const shellOrigin = getShellOrigin();
  const progressRetryRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const previousBestRef = useRef(0);
  const {
    playerName,
    profile,
    walletAddress,
    isReady,
    updateWalletAddress,
  } = usePlayerProfile();
  const resolvedWallet = useResolvedWallet(walletAddress);

  const resolvedName = playerName || profile?.name || "";

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

  useEffect(() => {
    setGameReady(false);
    setSubmitPopupOpen(false);
    setPendingScoreState(0);
    setSubmitError("");
    previousBestRef.current = 0;
    return () => {
      if (loadFallbackRef.current) clearTimeout(loadFallbackRef.current);
      clearProgressRetries();
    };
  }, [game.url, clearProgressRetries]);

  const loadPreviousBest = useCallback(async (wallet: string) => {
    if (!leaderboardEnabled) {
      try {
        const { progress } = await getGameProgress(game.id, wallet, {
          playerName: resolvedName || undefined,
        });
        previousBestRef.current = progress.score ?? 0;
      } catch {
        previousBestRef.current = 0;
      }
      return;
    }

    try {
      const status = await getLeaderboardStatus(game.id, {
        walletAddress: wallet,
        playerName: resolvedName || undefined,
      });
      previousBestRef.current = Math.max(
        status.submittedBest,
        status.personalBest
      );
    } catch {
      previousBestRef.current = 0;
    }
  }, [game.id, leaderboardEnabled, resolvedName]);

  const offerScoreSubmit = useCallback(
    (score: number) => {
      if (!leaderboardEnabled || score <= previousBestRef.current) {
        return false;
      }

      setPendingScoreState(score);
      setPendingScore(game.id, score);
      setSubmitError("");
      setSubmitPopupOpen(true);
      return true;
    },
    [game.id, leaderboardEnabled]
  );

  const handleIncomingScore = useCallback(
    async (score: number, opts?: { name?: string; wallet?: string }) => {
      const wallet =
        opts?.wallet ||
        resolvedWallet ||
        walletAddress ||
        profile?.walletAddress ||
        (await resolveWalletOnAppOpen()) ||
        "";

      if (opts?.wallet && opts.wallet !== profile?.walletAddress) {
        updateWalletAddress(opts.wallet).catch(() => {
          // Wallet sync is best-effort
        });
      }

      if (!leaderboardEnabled) {
        return {
          success: false,
          error: "Leaderboard disabled for this game.",
        };
      }

      if (!wallet) {
        return {
          success: false,
          error: "No wallet address available.",
        };
      }

      if (previousBestRef.current === 0) {
        await loadPreviousBest(wallet);
      }

      const shouldPrompt = offerScoreSubmit(score);
      const displayBest = Math.max(previousBestRef.current, score);

      return {
        success: true,
        saved: false,
        requiresSubmit: shouldPrompt,
        highScore: displayBest,
        pendingScore: shouldPrompt ? score : undefined,
        playerName: opts?.name || resolvedName,
      };
    },
    [
      leaderboardEnabled,
      loadPreviousBest,
      offerScoreSubmit,
      profile?.walletAddress,
      resolvedName,
      resolvedWallet,
      updateWalletAddress,
      walletAddress,
    ]
  );

  const handlePopupDismiss = useCallback(() => {
    setSubmitPopupOpen(false);
    setPendingScoreState(0);
    setSubmitError("");
    clearPendingScore(game.id);
  }, [game.id]);

  const handlePopupSubmit = useCallback(async () => {
    if (!pendingScore || !resolvedWallet) return;

    if (!resolvedName.trim()) {
      setSubmitError("Set your player name before submitting.");
      return;
    }

    setSubmitting(true);
    setSubmitError("");

    try {
      const result = await executePaidScoreSubmit(game.id, {
        walletAddress: resolvedWallet,
        playerName: resolvedName.trim(),
        score: pendingScore,
      });

      previousBestRef.current = result.submittedBest;
      clearPendingScore(game.id);
      setSubmitPopupOpen(false);
      setPendingScoreState(0);

      sendToUnity(iframeRef, "OnScoreSubmitted", {
        success: true,
        saved: true,
        highScore: result.score,
      });

      onScoreSubmitted?.();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Could not submit score."
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    game.id,
    onScoreSubmitted,
    pendingScore,
    resolvedName,
    resolvedWallet,
  ]);

  const handleMessage = useCallback(
    async (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;

      const msg = parseIncomingUnityMessage(event.data);
      if (!msg?.type?.startsWith("MINIPAY_")) return;

      switch (msg.type) {
        case "MINIPAY_BOOTSTRAP": {
          markGameReady();
          const wallet =
            resolvedWallet ||
            walletAddress ||
            profile?.walletAddress ||
            (await resolveWalletOnAppOpen()) ||
            "";

          if (wallet) {
            sendToUnity(iframeRef, "OnWalletAddressResolved", wallet);
            await loadPreviousBest(wallet);
          }

          const bootstrapName = resolvedName;
          let highScore = previousBestRef.current;
          let level = 0;

          if (wallet && !leaderboardEnabled) {
            try {
              const { progress } = await getGameProgress(game.id, wallet, {
                playerName: bootstrapName || undefined,
              });
              highScore = progress.score ?? 0;
              level = progress.level ?? 0;
              previousBestRef.current = highScore;
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
            ...progressPayload,
            hints: 0,
            tutorialComplete: false,
            gamePurchased: true,
          });

          scheduleProgressRetries(progressPayload);
          break;
        }

        case "MINIPAY_GET_LEADERBOARD": {
          if (!leaderboardEnabled) {
            sendToUnity(iframeRef, "OnLeaderboardReceived", []);
            break;
          }
          const entries = await getLeaderboard(game.id);
          sendToUnity(iframeRef, "OnLeaderboardReceived", entries);
          break;
        }

        case "MINIPAY_SUBMIT_SCORE": {
          const parsed = parseProgressPayload(msg.payload);
          if (typeof parsed.score !== "number") {
            sendToUnity(iframeRef, "OnScoreSubmitted", {
              success: false,
              error: "score is required.",
            });
            break;
          }

          const result = await handleIncomingScore(parsed.score, {
            name: parsed.name,
            wallet: parsed.walletAddress,
          });
          sendToUnity(iframeRef, "OnScoreSubmitted", result);
          break;
        }

        case "MINIPAY_GET_PROGRESS": {
          const wallet =
            resolvedWallet ||
            walletAddress ||
            profile?.walletAddress ||
            "";
          if (!wallet) {
            sendToUnity(iframeRef, "OnProgressReceived", {
              success: false,
              error: "No wallet address available.",
            });
            break;
          }
          try {
            if (leaderboardEnabled) {
              await loadPreviousBest(wallet);
              const payload = {
                highScore: previousBestRef.current,
                level: 0,
                hasLeaderboard: true,
              };
              sendToUnity(iframeRef, "OnProgressReceived", {
                success: true,
                ...payload,
              });
              scheduleProgressRetries(payload);
              break;
            }

            const { progress, hasLeaderboard } = await getGameProgress(
              game.id,
              wallet,
              { playerName: resolvedName || undefined }
            );
            const payload = {
              highScore: progress.score ?? 0,
              level: progress.level ?? 0,
              hasLeaderboard,
            };
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

        case "MINIPAY_SAVE_PROGRESS": {
          const parsed = parseProgressPayload(msg.payload);
          if (typeof parsed.score !== "number") {
            sendToUnity(iframeRef, "OnProgressSaved", {
              success: false,
              error: "value or score is required.",
            });
            break;
          }

          if (leaderboardEnabled) {
            const result = await handleIncomingScore(parsed.score, {
              name: parsed.name,
              wallet: parsed.walletAddress,
            });
            sendToUnity(iframeRef, "OnProgressSaved", {
              ...result,
              hasLeaderboard: true,
            });
            break;
          }

          const wallet =
            resolvedWallet ||
            walletAddress ||
            profile?.walletAddress ||
            "";
          if (!wallet) {
            sendToUnity(iframeRef, "OnProgressSaved", {
              success: false,
              error: "No wallet address available.",
            });
            break;
          }

          try {
            const { saveGameProgress } = await import("@/lib/game-progress-client");
            const result = await saveGameProgress(game.id, wallet, parsed.score, {
              playerName: resolvedName || parsed.name || undefined,
            });
            sendToUnity(iframeRef, "OnProgressSaved", {
              success: true,
              level: result.progress.level ?? parsed.score,
              hasLeaderboard: false,
            });
          } catch (err) {
            sendToUnity(iframeRef, "OnProgressSaved", {
              success: false,
              error:
                err instanceof Error
                  ? err.message
                  : "Could not save progress.",
            });
          }
          break;
        }

        default:
          console.warn("[ArcadeX bridge] unhandled message:", msg.type);
      }
    },
    [
      game.id,
      handleIncomingScore,
      leaderboardEnabled,
      loadPreviousBest,
      markGameReady,
      profile?.walletAddress,
      resolvedName,
      resolvedWallet,
      scheduleProgressRetries,
      shellOrigin,
      walletAddress,
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
      </div>

      {leaderboardEnabled && (
        <SubmitScorePopup
          open={submitPopupOpen}
          score={pendingScore}
          submitting={submitting}
          error={submitError}
          contestLive={gameContestLive(game)}
          onSubmit={handlePopupSubmit}
          onDismiss={handlePopupDismiss}
        />
      )}

      <ExitGameModal
        open={exitOpen}
        onCancel={() => setExitOpen(false)}
        onExit={() => router.push("/")}
        onPlayMore={() => router.push("/")}
      />
    </div>
  );
}
