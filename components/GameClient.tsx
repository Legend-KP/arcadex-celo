"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import ExitGameModal from "@/components/ExitGameModal";
import LoadingScreen from "@/components/LoadingScreen";
import { sendToUnity } from "@/lib/bridge";
import { getLeaderboard } from "@/lib/firebase";
import { getGameProgress, saveGameProgress } from "@/lib/game-progress-client";
import { buildGameIframeUrl, getShellOrigin } from "@/lib/game-iframe-url";
import {
  parseIncomingUnityMessage,
  parseProgressPayload,
} from "@/lib/unity-message";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { resolveWalletOnAppOpen } from "@/lib/walletAuth";
import { getGameTheme } from "@/lib/game-themes";
import { Game, gameHasLeaderboard } from "@/types";

interface GameClientProps {
  game: Game;
  onNewHighScore?: () => void;
}

const GAME_LOAD_FALLBACK_MS = 12000;
const PROGRESS_RETRY_DELAYS_MS = [0, 600, 1500, 3000] as const;
const PROGRESS_POLL_MS = 2000;

export default function GameClient({ game, onNewHighScore }: GameClientProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const [exitOpen, setExitOpen] = useState(false);
  const [gameReady, setGameReady] = useState(false);
  const leaderboardEnabled = gameHasLeaderboard(game);
  const theme = getGameTheme(game);
  const shellOrigin = getShellOrigin();
  const progressRetryRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const baselinePersonalBestRef = useRef<number | null>(null);
  const progressPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressCheckInFlightRef = useRef(false);
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

  useEffect(() => {
    setGameReady(false);
    baselinePersonalBestRef.current = null;
    return () => {
      if (loadFallbackRef.current) clearTimeout(loadFallbackRef.current);
      if (progressPollRef.current) clearInterval(progressPollRef.current);
      clearProgressRetries();
    };
  }, [game.url, clearProgressRetries]);

  const notifyIfPersonalBestIncreased = useCallback(
    (nextBest: number) => {
      if (!leaderboardEnabled || nextBest <= 0) return;

      const baseline = baselinePersonalBestRef.current;
      if (baseline === null) {
        baselinePersonalBestRef.current = nextBest;
        return;
      }

      if (nextBest > baseline) {
        baselinePersonalBestRef.current = nextBest;
        onNewHighScore?.();
      }
    },
    [leaderboardEnabled, onNewHighScore]
  );

  const markNewPersonalBest = useCallback(
    (nextBest: number) => {
      if (!leaderboardEnabled || nextBest <= 0) return;
      baselinePersonalBestRef.current = nextBest;
      onNewHighScore?.();
    },
    [leaderboardEnabled, onNewHighScore]
  );

  const checkProgressFromServer = useCallback(async () => {
    if (!leaderboardEnabled || progressCheckInFlightRef.current) return;

    const wallet =
      walletAddress ||
      profile?.walletAddress ||
      (await resolveWalletOnAppOpen()) ||
      "";

    if (!wallet) return;

    progressCheckInFlightRef.current = true;
    try {
      const { progress } = await getGameProgress(game.id, wallet, {
        playerName: playerName || profile?.name || undefined,
      });
      notifyIfPersonalBestIncreased(progress.score ?? 0);
    } catch {
      // Progress polling is best-effort
    } finally {
      progressCheckInFlightRef.current = false;
    }
  }, [
    game.id,
    leaderboardEnabled,
    notifyIfPersonalBestIncreased,
    playerName,
    profile?.name,
    profile?.walletAddress,
    walletAddress,
  ]);

  useEffect(() => {
    if (!gameReady || !leaderboardEnabled) return;

    void checkProgressFromServer();
    progressPollRef.current = setInterval(() => {
      void checkProgressFromServer();
    }, PROGRESS_POLL_MS);

    return () => {
      if (progressPollRef.current) clearInterval(progressPollRef.current);
      progressPollRef.current = null;
    };
  }, [gameReady, leaderboardEnabled, checkProgressFromServer]);

  const persistPersonalScore = useCallback(
    async (
      score: number,
      opts?: { name?: string; wallet?: string }
    ): Promise<{ highScore: number; newPersonalBest: boolean }> => {
      const resolvedWallet =
        opts?.wallet ||
        walletAddress ||
        profile?.walletAddress ||
        (await resolveWalletOnAppOpen()) ||
        "";

      if (!resolvedWallet) {
        throw new Error("No wallet address available.");
      }

      const result = await saveGameProgress(game.id, resolvedWallet, score, {
        playerName: opts?.name || playerName || profile?.name || undefined,
      });

      const highScore = result.progress.score ?? score;
      if (result.newPersonalBest) {
        markNewPersonalBest(highScore);
      } else {
        notifyIfPersonalBestIncreased(highScore);
      }

      return { highScore, newPersonalBest: result.newPersonalBest === true };
    },
    [
      game.id,
      markNewPersonalBest,
      notifyIfPersonalBestIncreased,
      playerName,
      profile?.name,
      profile?.walletAddress,
      walletAddress,
    ]
  );

  const handleMessage = useCallback(
    async (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;

      const msg = parseIncomingUnityMessage(event.data);
      if (!msg?.type?.startsWith("MINIPAY_")) {
        void checkProgressFromServer();
        return;
      }

      switch (msg.type) {
        case "MINIPAY_BOOTSTRAP": {
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
              baselinePersonalBestRef.current = highScore;
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
          if (!leaderboardEnabled) {
            sendToUnity(iframeRef, "OnScoreSubmitted", {
              success: false,
              error: "Leaderboard disabled for this game.",
            });
            break;
          }

          const parsed = parseProgressPayload(msg.payload);
          const score = parsed.score;
          if (typeof score !== "number") {
            sendToUnity(iframeRef, "OnScoreSubmitted", {
              success: false,
              error: "score is required.",
            });
            break;
          }

          const payloadWallet = parsed.walletAddress;
          if (payloadWallet && payloadWallet !== profile?.walletAddress) {
            updateWalletAddress(payloadWallet).catch(() => {
              // Wallet sync is best-effort
            });
          }

          try {
            const { highScore } = await persistPersonalScore(score, {
              name: parsed.name,
              wallet: payloadWallet,
            });
            sendToUnity(iframeRef, "OnScoreSubmitted", {
              success: true,
              highScore,
            });
          } catch (err) {
            sendToUnity(iframeRef, "OnScoreSubmitted", {
              success: false,
              error:
                err instanceof Error
                  ? err.message
                  : "Could not save score.",
            });
          }
          break;
        }

        case "MINIPAY_GET_PROGRESS": {
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
          const progressValue = parsed.score;
          if (typeof progressValue !== "number") {
            sendToUnity(iframeRef, "OnProgressSaved", {
              success: false,
              error: "value or score is required.",
            });
            break;
          }

          try {
            const { highScore } = await persistPersonalScore(progressValue, {
              name: parsed.name,
              wallet: parsed.walletAddress,
            });
            sendToUnity(iframeRef, "OnProgressSaved", {
              success: true,
              ...(leaderboardEnabled
                ? { highScore }
                : { level: progressValue }),
              hasLeaderboard: leaderboardEnabled,
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
      leaderboardEnabled,
      playerName,
      profile?.name,
      profile?.walletAddress,
      walletAddress,
      shellOrigin,
      updateWalletAddress,
      markGameReady,
      scheduleProgressRetries,
      checkProgressFromServer,
      persistPersonalScore,
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

      <ExitGameModal
        open={exitOpen}
        onCancel={() => setExitOpen(false)}
        onExit={() => router.push("/")}
        onPlayMore={() => router.push("/")}
      />
    </div>
  );
}
