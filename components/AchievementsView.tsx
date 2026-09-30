"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  claimAchievement,
  fetchAchievements,
} from "@/lib/achievements-client";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import type { AchievementProgressItem } from "@/types";

function progressPct(current: number, threshold: number): number {
  if (threshold <= 0) return 0;
  return Math.min(100, Math.round((current / threshold) * 100));
}

export default function AchievementsView({
  gameNames,
}: {
  gameNames: Record<string, string>;
}) {
  const { walletAddress } = usePlayerProfile();
  const [xp, setXp] = useState(0);
  const [level, setLevel] = useState(1);
  const [items, setItems] = useState<AchievementProgressItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!walletAddress) {
      setItems([]);
      setXp(0);
      setLevel(1);
      setLoading(false);
      setError("Connect your wallet to view achievements.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await fetchAchievements(walletAddress);
      setXp(data.xp);
      setLevel(data.level);
      setItems(data.items);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load achievements."
      );
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, AchievementProgressItem[]>();
    for (const item of items) {
      const key = item.mission.gameId;
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [items]);

  async function handleClaim(missionId: string) {
    setClaimingId(missionId);
    setError("");
    try {
      const result = await claimAchievement(missionId, walletAddress);
      setXp(result.xp);
      setLevel(result.level);
      setItems((prev) =>
        prev.map((item) =>
          item.mission.id === missionId
            ? { ...item, status: "claimed" as const }
            : item
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Claim failed.");
    } finally {
      setClaimingId(null);
    }
  }

  return (
    <div className="achievements-view">
      <header className="achievements-view__header">
        <h2 className="achievements-view__title">Achievements</h2>
        <p className="achievements-view__xp">
          Level {level} · {xp.toLocaleString()} XP
        </p>
      </header>

      {error && <p className="achievements-view__error">{error}</p>}
      {loading && <p className="no-games">Loading missions…</p>}
      {!loading && items.length === 0 && !error && (
        <p className="no-games">No missions yet. Check back soon!</p>
      )}

      {!loading &&
        grouped.map(([gameId, list]) => (
          <section key={gameId} className="achievements-group">
            <h3 className="achievements-group__title">
              {gameNames[gameId] ?? gameId}
            </h3>
            <ul className="achievements-list">
              {list.map((item) => {
                const pct = progressPct(item.current, item.threshold);
                return (
                  <li key={item.mission.id} className="achievement-card">
                    <div className="achievement-card__top">
                      <p className="achievement-card__title">
                        {item.mission.title}
                      </p>
                      <span className="achievement-card__reward">
                        +{item.mission.xpReward} XP
                      </span>
                    </div>
                    <p className="achievement-card__meta">
                      {item.mission.type === "score" ? "Score" : "Level"}
                      {item.mission.mode ? ` · ${item.mission.mode}` : ""} ·{" "}
                      {Math.min(item.current, item.threshold).toLocaleString()}{" "}
                      / {item.threshold.toLocaleString()}
                    </p>
                    <div
                      className="achievement-card__bar"
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <span style={{ width: `${pct}%` }} />
                    </div>
                    <div className="achievement-card__actions">
                      {item.status === "claimed" && (
                        <span className="achievement-card__claimed">
                          Claimed
                        </span>
                      )}
                      {item.status === "claimable" && (
                        <button
                          type="button"
                          className="achievement-card__claim"
                          disabled={claimingId === item.mission.id}
                          onClick={() => void handleClaim(item.mission.id)}
                        >
                          {claimingId === item.mission.id
                            ? "Claiming…"
                            : "Claim XP"}
                        </button>
                      )}
                      {item.status === "in_progress" && (
                        <span className="achievement-card__locked">
                          In progress
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
    </div>
  );
}
