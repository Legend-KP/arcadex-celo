import type { UnityMessage, UnityMessageType } from "@/lib/bridge";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseIncomingUnityMessage(data: unknown): UnityMessage | null {
  let raw: unknown = data;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("{")) return null;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  const obj = asRecord(raw);
  if (!obj) return null;

  const type = obj.type;
  if (typeof type === "string" && type.startsWith("MINIPAY_")) {
    return {
      type: type as UnityMessageType,
      payload: obj.payload ?? obj.data ?? obj,
    };
  }

  const action = obj.action ?? obj.event ?? obj.method;
  if (typeof action === "string") {
    const normalized = action.toUpperCase().replace(/-/g, "_");
    if (normalized.includes("SUBMIT") && normalized.includes("SCORE")) {
      return { type: "MINIPAY_SUBMIT_SCORE", payload: obj.payload ?? obj };
    }
    if (normalized.includes("SAVE") && normalized.includes("PROGRESS")) {
      return { type: "MINIPAY_SAVE_PROGRESS", payload: obj.payload ?? obj };
    }
  }

  if (
    typeof obj.score === "number" ||
    typeof obj.value === "number" ||
    typeof obj.highScore === "number"
  ) {
    return { type: "MINIPAY_SUBMIT_SCORE", payload: obj };
  }

  return null;
}

export function parseProgressScore(source: unknown): number | undefined {
  const obj = asRecord(source);
  if (!obj) return undefined;

  for (const key of ["score", "value", "highScore", "highscore", "points"]) {
    const raw = obj[key];
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
      return raw;
    }
    if (typeof raw === "string" && raw.trim() !== "") {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
  }

  return undefined;
}

export function parseProgressPayload(payload: unknown): {
  score?: number;
  name?: string;
  walletAddress?: string;
} {
  const obj = asRecord(payload);
  if (!obj) return {};

  const wallet =
    typeof obj.walletAddress === "string"
      ? obj.walletAddress
      : typeof obj.wallet === "string"
        ? obj.wallet
        : undefined;

  const name =
    typeof obj.name === "string"
      ? obj.name
      : typeof obj.playerName === "string"
        ? obj.playerName
        : undefined;

  return {
    score: parseProgressScore(obj),
    name,
    walletAddress: wallet,
  };
}
