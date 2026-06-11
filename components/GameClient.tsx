"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import ExitGameModal from "@/components/ExitGameModal";
import LoadingScreen from "@/components/LoadingScreen";
import { sendToUnity, UnityMessage } from "@/lib/bridge";
import { getLeaderboard, getUserBestScore, submitScore } from "@/lib/firebase";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { resolveWalletOnAppOpen } from "@/lib/walletAuth";
import { getGameTheme } from "@/lib/game-themes";
import { Game, gameHasLeaderboard } from "@/types";

interface GameClientProps {
  game: Game;
}

const GAME_LOAD_FALLBACK_MS = 12000;

export default function GameClient({ game }: GameClientProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const [exitOpen, setExitOpen] = useState(false);
  const [gameReady, setGameReady] = useState(false);
  const leaderboardEnabled = gameHasLeaderboard(game);
  const theme = getGameTheme(game);
  const { playerName, profile, walletAddress, isHumanVerified, updateWalletAddress } =
    usePlayerProfile();

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
    return () => {
      if (loadFallbackRef.current) clearTimeout(loadFallbackRef.current);
    };
  }, [game.url]);

  const handleMessage = useCallback(
    async (event: MessageEvent) => {
      const msg = event.data as UnityMessage;
      if (!msg?.type?.startsWith("MINIPAY_")) return;

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

          const resolvedName = playerName || profile?.name || "";
          let highScore = 0;
          if (leaderboardEnabled && (wallet || resolvedName)) {
            try {
              highScore = await getUserBestScore(game.id, {
                walletAddress: wallet || undefined,
                playerName: resolvedName || undefined,
              });
            } catch {
              // Personal best is optional during bootstrap
            }
          }

          sendToUnity(iframeRef, "OnBootstrapDataReceived", {
            gameId: game.id,
            walletAddress: wallet,
            playerName: resolvedName,
            highScore,
            hints: 0,
            tutorialComplete: false,
            gamePurchased: true,
            hasLeaderboard: leaderboardEnabled,
          });
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
          const resolvedWallet =
            walletAddress || payloadWallet || profile?.walletAddress;
          if (payloadWallet && payloadWallet !== profile?.walletAddress) {
            updateWalletAddress(payloadWallet).catch(() => {
              // Wallet sync is best-effort
            });
          }
          const personalBest = await submitScore(game.id, {
            name: playerName || name,
            score,
            walletAddress: resolvedWallet,
            isHumanVerified,
          });
          sendToUnity(iframeRef, "OnScoreSubmitted", {
            success: true,
            highScore: personalBest,
          });
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
      isHumanVerified,
      markGameReady,
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
        <iframe
          ref={iframeRef}
          src={game.url}
          title={game.name}
          allow="fullscreen; autoplay"
          allowFullScreen
          className={`game-iframe${gameReady ? "" : " game-iframe--preparing"}`}
          onLoad={scheduleLoadFallback}
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
