"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import ExitGameModal from "@/components/ExitGameModal";
import LoadingScreen from "@/components/LoadingScreen";
import { sendToUnity, UnityMessage } from "@/lib/bridge";
import { getLeaderboard, submitScore } from "@/lib/firebase";
import { getGameProgress, saveGameProgress } from "@/lib/game-progress-client";
import { buildGameIframeUrl } from "@/lib/game-iframe-url";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import {
  resolveWalletOnAppOpen,
  retryResolveWallet,
} from "@/lib/walletAuth";
import { getGameTheme } from "@/lib/game-themes";
import { Game, gameHasLeaderboard } from "@/types";

interface GameClientProps {
  game: Game;
}

const GAME_LOAD_FALLBACK_MS = 12000;
const SESSION_PUSH_DELAYS_MS = [0, 600, 1500, 3000];

export default function GameClient({ game }: GameClientProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walletRef = useRef("");
  const sessionPushTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const router = useRouter();
  const [exitOpen, setExitOpen] = useState(false);
  const [gameReady, setGameReady] = useState(false);
  const leaderboardEnabled = gameHasLeaderboard(game);
  const theme = getGameTheme(game);
  const {
    playerName,
    profile,
    walletAddress,
    isReady,
    updateWalletAddress,
  } = usePlayerProfile();

  useEffect(() => {
    walletRef.current = walletAddress || profile?.walletAddress || "";
  }, [walletAddress, profile?.walletAddress]);

  const resolvedName = playerName || profile?.name || "";
  const resolvedWallet = walletAddress || profile?.walletAddress || "";

  const iframeSrc = useMemo(() => {
    if (!isReady) return null;
    return buildGameIframeUrl(game.url, {
      gameId: game.id,
      wallet: resolvedWallet || undefined,
      playerName: resolvedName || undefined,
      hasLeaderboard: leaderboardEnabled,
    });
  }, [
    isReady,
    game.url,
    game.id,
    resolvedWallet,
    resolvedName,
    leaderboardEnabled,
  ]);

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

  const resolveWalletForSession = useCallback(async (): Promise<string> => {
    let wallet = walletRef.current;
    if (!wallet) {
      wallet =
        (await resolveWalletOnAppOpen()) ||
        (await retryResolveWallet()) ||
        "";
      if (wallet) walletRef.current = wallet;
    }
    return wallet;
  }, []);

  const pushSessionDataToUnity = useCallback(async () => {
    const wallet = await resolveWalletForSession();
    const name = playerName || profile?.name || "";

    let highScore = 0;
    let level = 0;
    if (wallet) {
      try {
        const { progress } = await getGameProgress(game.id, wallet, name);
        highScore = progress.score ?? 0;
        level = progress.level ?? 0;
      } catch {
        // Progress is optional during session push
      }
    }

    if (wallet) {
      sendToUnity(iframeRef, "OnWalletAddressResolved", wallet);
    }

    sendToUnity(iframeRef, "OnBootstrapDataReceived", {
      gameId: game.id,
      walletAddress: wallet,
      playerName: name,
      highScore,
      level,
      hints: 0,
      tutorialComplete: false,
      gamePurchased: true,
      hasLeaderboard: leaderboardEnabled,
    });

    sendToUnity(iframeRef, "OnProgressReceived", {
      success: true,
      highScore,
      level,
      hasLeaderboard: leaderboardEnabled,
    });
  }, [
    game.id,
    leaderboardEnabled,
    playerName,
    profile?.name,
    resolveWalletForSession,
  ]);

  useEffect(() => {
    setGameReady(false);
    return () => {
      if (loadFallbackRef.current) clearTimeout(loadFallbackRef.current);
    };
  }, [iframeSrc]);

  useEffect(() => {
    if (!gameReady) return;

    sessionPushTimersRef.current.forEach(clearTimeout);
    sessionPushTimersRef.current = SESSION_PUSH_DELAYS_MS.map((delayMs) =>
      setTimeout(() => {
        void pushSessionDataToUnity();
      }, delayMs)
    );

    return () => {
      sessionPushTimersRef.current.forEach(clearTimeout);
      sessionPushTimersRef.current = [];
    };
  }, [gameReady, pushSessionDataToUnity]);

  const handleMessage = useCallback(
    async (event: MessageEvent) => {
      const msg = event.data as UnityMessage;
      if (!msg?.type?.startsWith("MINIPAY_")) return;

      switch (msg.type) {
        case "MINIPAY_BOOTSTRAP": {
          markGameReady();
          await pushSessionDataToUnity();
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
          const { name, score, walletAddress: payloadWallet } = msg.payload as {
            name: string;
            score: number;
            walletAddress?: string;
          };
          const submitWallet =
            walletRef.current ||
            walletAddress ||
            payloadWallet ||
            profile?.walletAddress ||
            "";
          if (payloadWallet && payloadWallet !== profile?.walletAddress) {
            updateWalletAddress(payloadWallet).catch(() => {
              // Wallet sync is best-effort
            });
          }
          if (submitWallet) walletRef.current = submitWallet;

          const personalBest = await submitScore(game.id, {
            name: playerName || name,
            score,
            walletAddress: submitWallet || undefined,
          });
          if (submitWallet) {
            saveGameProgress(game.id, submitWallet, personalBest).catch(() => {
              // User-node sync is best-effort
            });
          }
          sendToUnity(iframeRef, "OnScoreSubmitted", {
            success: true,
            highScore: personalBest,
          });
          break;
        }

        case "MINIPAY_GET_PROGRESS": {
          const wallet = await resolveWalletForSession();
          if (!wallet) {
            sendToUnity(iframeRef, "OnProgressReceived", {
              success: false,
              error: "No wallet address available.",
            });
            break;
          }
          try {
            const name = playerName || profile?.name || "";
            const { progress, hasLeaderboard } = await getGameProgress(
              game.id,
              wallet,
              name
            );
            sendToUnity(iframeRef, "OnProgressReceived", {
              success: true,
              highScore: progress.score ?? 0,
              level: progress.level ?? 0,
              hasLeaderboard,
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

        case "MINIPAY_SAVE_PROGRESS": {
          if (leaderboardEnabled) {
            sendToUnity(iframeRef, "OnProgressSaved", {
              success: false,
              error: "Use MINIPAY_SUBMIT_SCORE for score-based games.",
            });
            break;
          }
          const { value } = (msg.payload ?? {}) as { value?: number };
          if (typeof value !== "number") {
            sendToUnity(iframeRef, "OnProgressSaved", {
              success: false,
              error: "value is required.",
            });
            break;
          }
          const wallet = await resolveWalletForSession();
          if (!wallet) {
            sendToUnity(iframeRef, "OnProgressSaved", {
              success: false,
              error: "No wallet address available.",
            });
            break;
          }
          try {
            const result = await saveGameProgress(game.id, wallet, value);
            sendToUnity(iframeRef, "OnProgressSaved", {
              success: true,
              level: result.progress.level ?? value,
              hasLeaderboard: result.hasLeaderboard,
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
      updateWalletAddress,
      markGameReady,
      pushSessionDataToUnity,
      resolveWalletForSession,
    ]
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  const showLoading = !isReady || !gameReady;

  return (
    <div className="game-page">
      {showLoading && (
        <div className="game-loading-overlay" aria-hidden={false}>
          <LoadingScreen message={isReady ? "Loading game" : "Connecting wallet"} />
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
        {iframeSrc && (
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
