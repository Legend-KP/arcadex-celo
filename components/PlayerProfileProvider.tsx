"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import PlayerNameModal from "@/components/PlayerNameModal";
import {
  bootstrapPlayerProfile,
  fetchPlayerProfile,
  savePlayerProfile,
} from "@/lib/player-profile-client";
import {
  clearCachedPlayerName,
  clearInvalidCachedWallet,
  clearStaleGuestId,
  getCachedPlayerName,
  getCachedWallet,
  setCachedPlayerName,
  setCachedWallet,
} from "@/lib/player-id";
import {
  readWalletImmediately,
  resolveWalletForSave,
  resolveWalletOnAppOpen,
} from "@/lib/walletAuth";
import {
  isWalletAddress,
  normalizeWalletAddress,
} from "@/lib/wallet-address";
import { PlayerProfile } from "@/types";

interface PlayerProfileContextValue {
  playerId: string;
  profile: PlayerProfile | null;
  playerName: string;
  walletAddress: string;
  isReady: boolean;
  updateWalletAddress: (walletAddress: string) => Promise<void>;
}

const PlayerProfileContext = createContext<PlayerProfileContextValue | null>(
  null
);

export function usePlayerProfile(): PlayerProfileContextValue {
  const ctx = useContext(PlayerProfileContext);
  if (!ctx) {
    throw new Error("usePlayerProfile must be used within PlayerProfileProvider");
  }
  return ctx;
}

function hasPlayerName(profile: PlayerProfile | null): boolean {
  return Boolean(profile?.name?.trim());
}

function shouldShowNameModal(profile: PlayerProfile | null): boolean {
  return !hasPlayerName(profile);
}

function syncNameCompletion(profile: PlayerProfile | null): boolean {
  const complete = hasPlayerName(profile);
  if (!complete) clearCachedPlayerName();
  return complete;
}

export default function PlayerProfileProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [playerId, setPlayerId] = useState("");
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [walletAddress, setWalletAddress] = useState(
    () => getCachedWallet() ?? ""
  );
  const [isReady, setIsReady] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nameCompleteRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function resolveWallet(): Promise<string | null> {
      const immediate = readWalletImmediately();
      if (immediate) return immediate;

      return resolveWalletOnAppOpen();
    }

    async function loadProfile() {
      clearInvalidCachedWallet();
      clearStaleGuestId();
      setError("");

      const cached = getCachedWallet();
      if (cached) {
        setCachedWallet(cached);
        setWalletAddress(cached);
        setPlayerId(cached);
      }

      const wallet = (await resolveWallet()) ?? cached;
      if (cancelled) return;

      if (!wallet) {
        setShowModal(true);
        nameCompleteRef.current = false;
        setIsReady(true);
        return;
      }

      setCachedWallet(wallet);
      setWalletAddress(wallet);
      setPlayerId(wallet);

      try {
        let user = await fetchPlayerProfile(wallet).catch(() => null);
        if (!user) {
          user = await bootstrapPlayerProfile(wallet);
        } else {
          bootstrapPlayerProfile(wallet).catch(() => {
            // Spark/profile sync is best-effort after a cached profile load.
          });
        }

        if (cancelled) return;

        setProfile(user);
        if (user.name) setCachedPlayerName(user.name);

        if (shouldShowNameModal(user)) {
          nameCompleteRef.current = false;
          setShowModal(true);
        } else {
          nameCompleteRef.current = syncNameCompletion(user);
          setShowModal(false);
        }
      } catch (err) {
        if (cancelled) return;

        const cachedName = getCachedPlayerName()?.trim();
        if (cachedName) {
          const fallbackProfile: PlayerProfile = {
            id: wallet,
            name: cachedName,
            walletAddress: wallet,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          setProfile(fallbackProfile);
          nameCompleteRef.current = true;
          setShowModal(false);
          setError("");
          return;
        }

        nameCompleteRef.current = false;
        setShowModal(true);
        setError(
          err instanceof Error
            ? err.message
            : "Could not load your profile. Please try again."
        );
      } finally {
        if (!cancelled) setIsReady(true);
      }
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = useCallback(
    async (name: string) => {
      setSaving(true);
      setError("");

      try {
        let wallet =
          walletAddress ||
          getCachedWallet() ||
          profile?.walletAddress ||
          readWalletImmediately();

        if (!wallet) {
          wallet = await resolveWalletForSave();
        }

        if (!isWalletAddress(wallet)) {
          throw new Error(
            "Could not connect your wallet. Open ArcadeX in MiniPay and try again."
          );
        }

        wallet = normalizeWalletAddress(wallet);

        const saved = await savePlayerProfile(wallet, name, wallet);

        setCachedWallet(wallet);
        setCachedPlayerName(saved.name);
        setWalletAddress(saved.walletAddress ?? wallet);
        setPlayerId(saved.id);
        setProfile(saved);
        nameCompleteRef.current = true;
        setShowModal(false);
      } catch (err) {
        nameCompleteRef.current = false;
        setShowModal(true);
        setError(
          err instanceof Error ? err.message : "Could not save your name."
        );
      } finally {
        setSaving(false);
      }
    },
    [walletAddress, profile?.walletAddress]
  );

  const updateWalletAddress = useCallback(
    async (nextWallet: string) => {
      if (!profile?.name) return;

      const wallet = nextWallet.trim();
      const saved = await savePlayerProfile(wallet, profile.name, wallet);
      setProfile(saved);
      setPlayerId(saved.id);
      setWalletAddress(wallet);
      setCachedWallet(wallet);
    },
    [profile?.name]
  );

  const defaultName =
    profile?.name?.trim() || getCachedPlayerName()?.trim() || "";

  const value = useMemo(
    () => ({
      playerId,
      profile,
      playerName: profile?.name ?? "",
      walletAddress,
      isReady,
      updateWalletAddress,
    }),
    [playerId, profile, walletAddress, isReady, updateWalletAddress]
  );

  return (
    <PlayerProfileContext.Provider value={value}>
      {children}
      <PlayerNameModal
        open={showModal}
        saving={saving}
        error={error}
        defaultName={defaultName}
        onSubmit={handleSubmit}
      />
    </PlayerProfileContext.Provider>
  );
}
