import type { RefObject } from "react";

/**
 * bridge.ts
 * Sends messages from the Next.js shell into the Unity WebGL iframe.
 */

export function sendToUnity(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  method: string,
  payload: unknown = ""
): void {
  const value =
    typeof payload === "string" ? payload : JSON.stringify(payload);

  if (iframeRef.current?.contentWindow) {
    iframeRef.current.contentWindow.postMessage(
      { type: "UNITY_CALLBACK", method, value },
      "*"
    );
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
    unityInstance.SendMessage("MiniPayBridge", method, value);
  }
}

export type UnityMessageType =
  | "MINIPAY_BOOTSTRAP"
  | "MINIPAY_SYNC_USER_STATE"
  | "MINIPAY_COMPLETE_TUTORIAL"
  | "MINIPAY_REQUEST_STATUS"
  | "MINIPAY_PURCHASE_GAME"
  | "MINIPAY_BUY_HINTS"
  | "MINIPAY_BUY_REVIVE"
  | "MINIPAY_BUY_LIVES"
  | "MINIPAY_SUBMIT_SCORE"
  | "MINIPAY_GET_LEADERBOARD";

export interface UnityMessage {
  type: UnityMessageType;
  payload?: unknown;
}
