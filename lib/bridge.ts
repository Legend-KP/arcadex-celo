import type { RefObject } from "react";

/**
 * bridge.ts
 * Sends messages from the Next.js shell into the Unity WebGL iframe.
 */

const UNITY_CALLBACK_RETRIES_MS = [0, 100, 300, 800, 1500, 3000] as const;

export function sendToUnity(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  method: string,
  payload: unknown = ""
): void {
  const value =
    typeof payload === "string" ? payload : JSON.stringify(payload);

  const message = { type: "UNITY_CALLBACK", method, value };

  for (const delay of UNITY_CALLBACK_RETRIES_MS) {
    if (delay === 0) {
      postUnityCallback(iframeRef, message);
      continue;
    }
    setTimeout(() => postUnityCallback(iframeRef, message), delay);
  }
}

function postUnityCallback(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  message: { type: string; method: string; value: string }
): void {
  const target = iframeRef.current?.contentWindow;
  if (target) {
    target.postMessage(message, "*");
    return;
  }

  const unityInstance = (
    window as Window & {
      unityInstance?: {
        SendMessage: (obj: string, method: string, value: string) => void;
      };
    }
  ).unityInstance;
  if (unityInstance?.SendMessage) {
    unityInstance.SendMessage("ArcadeXBridge", message.method, message.value);
  }
}

export interface LeaderboardSubmitUnityResult {
  success: boolean;
  highScore?: number;
  leaderboardScore?: number;
  error?: string;
}

/** Notify Unity of paid leaderboard submit — primary + legacy callbacks. */
export function notifyUnityLeaderboardSubmit(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  result: LeaderboardSubmitUnityResult
): void {
  const payload = {
    success: result.success,
    highScore: result.highScore ?? 0,
    leaderboardScore: result.leaderboardScore ?? 0,
    error: result.error ?? "",
  };

  sendToUnity(iframeRef, "OnLeaderboardSubmitComplete", payload);

  // Legacy games may still listen on OnScoreSubmitted (not OnProgressSaved).
  sendToUnity(iframeRef, "OnScoreSubmitted", payload);
}

/** Unity → shell message types (wallet-agnostic naming). */
export type GameBridgeMessageType =
  | "GAME_BOOTSTRAP"
  | "GAME_PROGRESS_SAVE"
  | "GAME_PROGRESS_GET"
  | "GAME_LEADERBOARD_GET"
  | "GAME_LEADERBOARD_SUBMIT";

/** @deprecated Legacy MiniPay-prefixed aliases — still accepted inbound. */
export type LegacyUnityMessageType =
  | "MINIPAY_BOOTSTRAP"
  | "MINIPAY_SYNC_USER_STATE"
  | "MINIPAY_COMPLETE_TUTORIAL"
  | "MINIPAY_REQUEST_STATUS"
  | "MINIPAY_PURCHASE_GAME"
  | "MINIPAY_BUY_HINTS"
  | "MINIPAY_BUY_REVIVE"
  | "MINIPAY_BUY_LIVES"
  | "MINIPAY_SUBMIT_SCORE"
  | "MINIPAY_GET_LEADERBOARD"
  | "MINIPAY_GET_PROGRESS"
  | "MINIPAY_SAVE_PROGRESS";

export type UnityMessageType = GameBridgeMessageType | LegacyUnityMessageType;

export interface UnityMessage {
  type: UnityMessageType;
  payload?: unknown;
}

const LEGACY_MESSAGE_ALIASES: Record<string, GameBridgeMessageType> = {
  MINIPAY_BOOTSTRAP: "GAME_BOOTSTRAP",
  MINIPAY_SAVE_PROGRESS: "GAME_PROGRESS_SAVE",
  MINIPAY_SUBMIT_SCORE: "GAME_PROGRESS_SAVE",
  MINIPAY_GET_PROGRESS: "GAME_PROGRESS_GET",
  MINIPAY_GET_LEADERBOARD: "GAME_LEADERBOARD_GET",
};

const HANDLED_GAME_MESSAGES = new Set<GameBridgeMessageType>([
  "GAME_BOOTSTRAP",
  "GAME_PROGRESS_SAVE",
  "GAME_PROGRESS_GET",
  "GAME_LEADERBOARD_GET",
  "GAME_LEADERBOARD_SUBMIT",
]);

export function normalizeUnityMessageType(
  type: string | undefined
): GameBridgeMessageType | null {
  if (!type) return null;
  const aliased = LEGACY_MESSAGE_ALIASES[type] ?? type;
  if (HANDLED_GAME_MESSAGES.has(aliased as GameBridgeMessageType)) {
    return aliased as GameBridgeMessageType;
  }
  return null;
}

export function isUnityBridgeMessage(type: string | undefined): boolean {
  if (!type) return false;
  if (normalizeUnityMessageType(type)) return true;
  return type.startsWith("MINIPAY_");
}
