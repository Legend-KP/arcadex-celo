import { LEADERBOARD_MAX_ENTRIES, LeaderboardEntry, PlayerProfile } from "@/types";
import { getDatabaseUrl } from "./firebase-admin";
import {
  isWalletAddress,
  normalizeWalletAddress,
  tryNormalizeWalletAddress,
} from "@/lib/wallet-address";

type StoredUser = Omit<PlayerProfile, "id">;
type LeaderboardMap = Record<string, LeaderboardEntry>;

function getRtdbAuthQuery(): string {
  const secret = process.env.FIREBASE_DATABASE_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "FIREBASE_DATABASE_SECRET is missing. Add it to Cloudflare Worker secrets (Firebase Console → Realtime Database → Secrets)."
    );
  }
  return `auth=${encodeURIComponent(secret)}`;
}

/** Encode each path segment for RTDB REST (wallet keys, game ids, etc.). */
function encodeRtdbPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function profilePath(walletAddress: string): string {
  if (!isWalletAddress(walletAddress)) {
    throw new Error("User profile requires a valid wallet address.");
  }
  return `users/${normalizeWalletAddress(walletAddress)}`;
}

function resolveWalletField(
  id: string,
  walletAddress?: string
): string | undefined {
  const fromBody = tryNormalizeWalletAddress(walletAddress);
  if (fromBody) return fromBody;
  if (isWalletAddress(id)) return normalizeWalletAddress(id);
  return undefined;
}

async function rtdbFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const auth = getRtdbAuthQuery();
  const url = `${getDatabaseUrl()}/${encodeRtdbPath(path)}.json?${auth}`;

  return fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
}

async function readPath<T>(path: string): Promise<T | null> {
  const res = await rtdbFetch(path);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Realtime Database read failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as T | null;
  return data ?? null;
}

async function writePath(path: string, data: unknown): Promise<void> {
  const res = await rtdbFetch(path, {
    method: "PUT",
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Realtime Database write failed (${res.status}): ${text}`);
  }
}

function toPlayerProfile(id: string, data: StoredUser | null): PlayerProfile | null {
  if (!data) return null;
  return { id, ...data };
}

function mapToLeaderboardEntries(map: LeaderboardMap | null): LeaderboardEntry[] {
  if (!map) return [];
  return Object.values(map);
}

/** Stable identity for deduping — wallet preferred, name fallback. */
function leaderboardUserKey(entry: LeaderboardEntry): string {
  const wallet = tryNormalizeWalletAddress(entry.walletAddress);
  if (wallet) return `wallet:${wallet}`;
  return `name:${entry.name.trim().toLowerCase()}`;
}

/** RTDB-safe key for per-user storage (wallet or sanitized name). */
function leaderboardStorageKey(entry: LeaderboardEntry): string {
  const wallet = tryNormalizeWalletAddress(entry.walletAddress);
  if (wallet) return wallet;
  return `name_${entry.name.trim().toLowerCase().replace(/[.#$[\]/]/g, "_")}`;
}

function deduplicateLeaderboardEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  const best = new Map<string, LeaderboardEntry>();
  for (const entry of entries) {
    const key = leaderboardUserKey(entry);
    const current = best.get(key);
    if (!current || entry.score > current.score) {
      best.set(key, entry);
    }
  }
  return Array.from(best.values());
}

async function enrichLeaderboardWithHumanStatus(
  entries: LeaderboardEntry[]
): Promise<LeaderboardEntry[]> {
  const wallets = [
    ...new Set(
      entries
        .map((e) => tryNormalizeWalletAddress(e.walletAddress))
        .filter((w): w is string => Boolean(w))
    ),
  ];

  if (wallets.length === 0) return entries;

  const verified = new Set<string>();
  await Promise.all(
    wallets.map(async (wallet) => {
      try {
        const user = await fetchUserFromServer(wallet);
        if (user?.isHumanVerified) verified.add(wallet);
      } catch {
        // Skip lookup failures
      }
    })
  );

  return entries.map((entry) => ({
    ...entry,
    isHumanVerified:
      entry.isHumanVerified === true ||
      (entry.walletAddress ? verified.has(entry.walletAddress) : false),
  }));
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function fetchUserFromServer(
  id: string
): Promise<PlayerProfile | null> {
  const wallet = tryNormalizeWalletAddress(id);
  if (!wallet) return null;

  const data = await readPath<StoredUser>(profilePath(wallet));
  if (!data) return null;
  return toPlayerProfile(wallet, data);
}

export async function upsertUserOnServer(
  id: string,
  data: { name: string; walletAddress?: string }
): Promise<PlayerProfile> {
  const wallet = resolveWalletField(id, data.walletAddress);
  if (!wallet) {
    throw new Error("A wallet address is required to save a player profile.");
  }

  const existing = await fetchUserFromServer(wallet);
  const now = Date.now();

  const stored: StoredUser = {
    name: data.name.trim(),
    walletAddress: wallet,
    isHumanVerified: existing?.isHumanVerified ?? false,
    nullifier: existing?.nullifier ?? "",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await writePath(profilePath(wallet), stored);
  return toPlayerProfile(wallet, stored)!;
}

export async function bootstrapUserOnServer(
  walletAddress: string
): Promise<PlayerProfile> {
  if (!isWalletAddress(walletAddress)) {
    throw new Error("bootstrap requires a valid wallet address.");
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const existing = await fetchUserFromServer(wallet);

  if (!existing) {
    const now = Date.now();
    const stored: StoredUser = {
      name: "",
      walletAddress: wallet,
      isHumanVerified: false,
      nullifier: "",
      createdAt: now,
      updatedAt: now,
    };
    await writePath(`users/${wallet}`, stored);
    return toPlayerProfile(wallet, stored)!;
  }

  return existing;
}

export async function fetchNullifierOwner(
  nullifierDocId: string
): Promise<string | null> {
  const data = await readPath<{ walletAddress?: string }>(
    `nullifiers/${nullifierDocId}`
  );
  return data?.walletAddress?.trim() || null;
}

export async function storeNullifier(
  nullifierDocId: string,
  data: { nullifier: string; walletAddress: string }
): Promise<void> {
  await writePath(`nullifiers/${nullifierDocId}`, {
    nullifier: data.nullifier,
    action: "human-verify",
    walletAddress: data.walletAddress,
    verifiedAt: Date.now(),
  });
}

export async function markUserHumanVerified(
  walletAddress: string,
  nullifier: string
): Promise<PlayerProfile> {
  if (!isWalletAddress(walletAddress)) {
    throw new Error("Human verification requires a valid wallet address.");
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const existing = await fetchUserFromServer(wallet);
  const now = Date.now();
  const stored: StoredUser = {
    name: existing?.name ?? "",
    walletAddress: wallet,
    isHumanVerified: true,
    nullifier,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await writePath(`users/${wallet}`, stored);
  return toPlayerProfile(wallet, stored)!;
}

// ─── Game play counts ──────────────────────────────────────────────────────────

export async function fetchAllGamePlayCounts(): Promise<Record<string, number>> {
  const data = await readPath<Record<string, number>>("gamePlays");
  if (!data) return {};

  const counts: Record<string, number> = {};
  for (const [gameId, value] of Object.entries(data)) {
    counts[gameId] = typeof value === "number" ? value : 0;
  }
  return counts;
}

export async function fetchGamePlayCount(gameId: string): Promise<number> {
  const count = await readPath<number>(`gamePlays/${gameId}`);
  return typeof count === "number" ? count : 0;
}

export async function incrementGamePlayCount(gameId: string): Promise<number> {
  const current = await fetchGamePlayCount(gameId);
  const next = current + 1;
  await writePath(`gamePlays/${gameId}`, next);
  return next;
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

export async function fetchLeaderboardFromServer(
  gameId: string,
  limit = LEADERBOARD_MAX_ENTRIES
): Promise<LeaderboardEntry[]> {
  const map = await readPath<LeaderboardMap>(`leaderboards/${gameId}`);
  const entries = deduplicateLeaderboardEntries(mapToLeaderboardEntries(map))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return enrichLeaderboardWithHumanStatus(entries);
}

export async function fetchUserBestScoreFromServer(
  gameId: string,
  opts: { walletAddress?: string; playerName?: string }
): Promise<number> {
  const map = await readPath<LeaderboardMap>(`leaderboards/${gameId}`);
  const entries = deduplicateLeaderboardEntries(mapToLeaderboardEntries(map));

  const wallet = tryNormalizeWalletAddress(opts.walletAddress);
  const name = opts.playerName?.trim().toLowerCase();
  if (!wallet && !name) return 0;

  let best = 0;
  for (const entry of entries) {
    const entryWallet = tryNormalizeWalletAddress(entry.walletAddress);
    const matchesWallet = Boolean(wallet && entryWallet === wallet);
    const matchesName = Boolean(
      name && entry.name.trim().toLowerCase() === name
    );
    if (matchesWallet || matchesName) {
      best = Math.max(best, entry.score);
    }
  }

  return best;
}

export async function submitLeaderboardEntryOnServer(
  gameId: string,
  entry: LeaderboardEntry
): Promise<void> {
  const wallet = tryNormalizeWalletAddress(entry.walletAddress);
  const payload: LeaderboardEntry = {
    name: entry.name,
    score: entry.score,
    ...(wallet ? { walletAddress: wallet } : {}),
    isHumanVerified: entry.isHumanVerified === true,
    createdAt: entry.createdAt ?? Date.now(),
  };

  const map = await readPath<LeaderboardMap>(`leaderboards/${gameId}`);
  const userKey = leaderboardUserKey(payload);
  const existingBest = deduplicateLeaderboardEntries(
    mapToLeaderboardEntries(map)
  ).find((e) => leaderboardUserKey(e) === userKey);

  if (existingBest && existingBest.score >= payload.score) {
    return;
  }

  await writePath(`leaderboards/${gameId}/${leaderboardStorageKey(payload)}`, payload);
}
