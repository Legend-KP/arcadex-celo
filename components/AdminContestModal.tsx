"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CONTEST_DURATION_OPTIONS,
  ContestDurationDays,
  ContestInfo,
  Game,
  LeaderboardEntry,
} from "@/types";
import { updateAdminGame } from "@/lib/admin-api";
import {
  computeContestEndsAt,
  durationDaysFromRange,
  formatContestCountdown,
  getContestStatus,
  isContestDurationDays,
  parseDatetimeLocalValue,
  toDatetimeLocalValue,
  MS_PER_HOUR,
} from "@/lib/contest";
import { getLeaderboard } from "@/lib/leaderboard-client";

interface AdminContestModalProps {
  game: Game | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  showToast: (message: string) => void;
}

type DurationMode = "preset" | "custom";

function formatWallet(wallet?: string): string {
  if (!wallet) return "Unknown";
  return wallet;
}

function detectDurationMode(game: Game): DurationMode {
  const startedAt = game.contestStartedAt;
  const endsAt = game.contestEndsAt;
  const days = game.contestDurationDays;
  if (
    typeof startedAt === "number" &&
    typeof endsAt === "number" &&
    isContestDurationDays(days)
  ) {
    const expected = computeContestEndsAt(startedAt, days);
    if (Math.abs(expected - endsAt) < 60_000) return "preset";
  }
  if (
    typeof startedAt === "number" &&
    typeof endsAt === "number" &&
    !isContestDurationDays(days)
  ) {
    return "custom";
  }
  if (isContestDurationDays(days)) return "preset";
  if (typeof endsAt === "number") return "custom";
  return "preset";
}

export default function AdminContestModal({
  game,
  open,
  onClose,
  onSaved,
  showToast,
}: AdminContestModalProps) {
  const [durationMode, setDurationMode] = useState<DurationMode>("preset");
  const [durationDays, setDurationDays] = useState<ContestDurationDays>(1);
  const [customEndsAtLocal, setCustomEndsAtLocal] = useState(() =>
    toDatetimeLocalValue(Date.now() + 24 * MS_PER_HOUR)
  );
  const [task, setTask] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingContest, setLoadingContest] = useState(false);
  const [contestInfo, setContestInfo] = useState<ContestInfo | null>(null);
  const [countdown, setCountdown] = useState("");

  const contestStatus = game ? getContestStatus(game) : null;
  const isLive = contestStatus === "live";
  const isEnded = contestStatus === "ended";
  const isPlanning = !contestStatus || isEnded;

  useEffect(() => {
    if (!open || !game) return;

    const mode = detectDurationMode(game);
    setDurationMode(mode);
    setDurationDays(
      isContestDurationDays(game.contestDurationDays)
        ? game.contestDurationDays
        : 1
    );
    const defaultEnd =
      typeof game.contestEndsAt === "number" && game.contestEndsAt > Date.now()
        ? game.contestEndsAt
        : Date.now() + 24 * MS_PER_HOUR;
    setCustomEndsAtLocal(toDatetimeLocalValue(defaultEnd));
    setTask(game.contestTask ?? "");
    setContestInfo(null);

    if (game.contestStartedAt) {
      setLoadingContest(true);
      getLeaderboard(game.id)
        .then((data) => setContestInfo(data.contest ?? null))
        .catch(() => setContestInfo(null))
        .finally(() => setLoadingContest(false));
    }
  }, [open, game]);

  useEffect(() => {
    if (!open || !isLive || !game?.contestEndsAt) {
      setCountdown("");
      return;
    }

    const tick = () => {
      setCountdown(formatContestCountdown(game.contestEndsAt! - Date.now()));
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [open, isLive, game?.contestEndsAt]);

  const customEndsAtMs = useMemo(
    () => parseDatetimeLocalValue(customEndsAtLocal),
    [customEndsAtLocal]
  );

  const plannedHint = useMemo(() => {
    if (durationMode === "preset") {
      const hours = durationDays * 24;
      return `Leaderboard countdown: ${hours} hours`;
    }
    if (customEndsAtMs == null) return "Pick a valid end date and time.";
    const startBase = isLive && game?.contestStartedAt ? game.contestStartedAt : Date.now();
    const remaining = customEndsAtMs - startBase;
    if (remaining <= 0) return "End time must be in the future.";
    return `Ends in ${formatContestCountdown(customEndsAtMs - Date.now())}`;
  }, [durationMode, durationDays, customEndsAtMs, isLive, game?.contestStartedAt]);

  if (!open || !game) return null;

  function resolveEndsAt(startedAt: number): { endsAt: number; durationDays: number } | null {
    if (durationMode === "preset") {
      return {
        endsAt: computeContestEndsAt(startedAt, durationDays),
        durationDays,
      };
    }
    const endsAt = parseDatetimeLocalValue(customEndsAtLocal);
    if (endsAt == null) {
      showToast("Enter a valid end date and time.");
      return null;
    }
    if (endsAt <= Date.now()) {
      showToast("End time must be in the future.");
      return null;
    }
    if (endsAt <= startedAt) {
      showToast("End time must be after the contest start.");
      return null;
    }
    return {
      endsAt,
      durationDays: durationDaysFromRange(startedAt, endsAt),
    };
  }

  async function handleStartContest() {
    if (!task.trim()) {
      showToast("Add a contest task before starting.");
      return;
    }

    const now = Date.now();
    const resolved = resolveEndsAt(now);
    if (!resolved) return;

    setSaving(true);
    try {
      await updateAdminGame(game!.id, {
        contestDurationDays: resolved.durationDays,
        contestTask: task.trim(),
        contestStartedAt: now,
        contestEndsAt: resolved.endsAt,
        contestLive: true,
      });
      showToast("Contest started!");
      onSaved();
      onClose();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to start contest."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit() {
    if (!task.trim()) {
      showToast("Contest task cannot be empty.");
      return;
    }
    if (!game?.contestStartedAt) return;

    const resolved = resolveEndsAt(game.contestStartedAt);
    if (!resolved) return;

    setSaving(true);
    try {
      await updateAdminGame(game.id, {
        contestDurationDays: resolved.durationDays,
        contestTask: task.trim(),
        contestEndsAt: resolved.endsAt,
        contestLive: true,
      });
      showToast("Contest updated!");
      onSaved();
      onClose();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to update contest."
      );
    } finally {
      setSaving(false);
    }
  }

  const topEntries: LeaderboardEntry[] = contestInfo?.entries ?? [];

  return (
    <div className="admin-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="admin-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Contest panel for ${game.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-modal-header">
          <div>
            <h3 className="admin-modal-title">Contest Panel</h3>
            <p className="admin-modal-subtitle">{game.name}</p>
          </div>
          <button
            type="button"
            className="admin-modal-close"
            onClick={onClose}
            aria-label="Close contest panel"
          >
            ✕
          </button>
        </div>

        {isLive && (
          <div className="admin-contest-live-banner">
            <span>Contest is live</span>
            {countdown && <span className="admin-contest-countdown">{countdown}</span>}
          </div>
        )}

        {isEnded && (
          <div className="admin-contest-ended-banner">
            Contest ended — review final standings or start a new one.
          </div>
        )}

        {isEnded && (
          <div className="admin-contest-results">
            <h4 className="admin-contest-section-title">Final Top 10</h4>
            {loadingContest && <p className="admin-contest-muted">Loading results...</p>}
            {!loadingContest && topEntries.length === 0 && (
              <p className="admin-contest-muted">No contest submissions recorded.</p>
            )}
            {!loadingContest &&
              topEntries.map((entry, index) => (
                <div key={`${entry.walletAddress ?? entry.name}-${index}`} className="admin-contest-result-row">
                  <span className="admin-contest-result-rank">#{index + 1}</span>
                  <span className="admin-contest-result-wallet">
                    {formatWallet(entry.walletAddress)}
                  </span>
                  <span className="admin-contest-result-score">
                    {entry.score.toLocaleString()}
                  </span>
                </div>
              ))}
          </div>
        )}

        {(isPlanning || isLive) && (
          <div className="admin-contest-form">
            <h4 className="admin-contest-section-title">
              {isLive ? "Edit Contest" : "Plan Contest"}
            </h4>

            <label className="form-label">Duration</label>
            <div className="admin-duration-grid admin-duration-grid--with-custom">
              {CONTEST_DURATION_OPTIONS.map((days) => (
                <button
                  key={days}
                  type="button"
                  className={`admin-duration-btn${
                    durationMode === "preset" && durationDays === days
                      ? " selected"
                      : ""
                  }`}
                  onClick={() => {
                    setDurationMode("preset");
                    setDurationDays(days);
                  }}
                >
                  {days}d
                </button>
              ))}
              <button
                type="button"
                className={`admin-duration-btn${
                  durationMode === "custom" ? " selected" : ""
                }`}
                onClick={() => {
                  setDurationMode("custom");
                  if (!customEndsAtLocal) {
                    setCustomEndsAtLocal(
                      toDatetimeLocalValue(Date.now() + 24 * MS_PER_HOUR)
                    );
                  }
                }}
              >
                Custom
              </button>
            </div>

            {durationMode === "custom" && (
              <div className="form-group admin-contest-custom-time">
                <label className="form-label" htmlFor="contest-ends-at">
                  End date &amp; time
                </label>
                <input
                  id="contest-ends-at"
                  className="form-input"
                  type="datetime-local"
                  value={customEndsAtLocal}
                  min={toDatetimeLocalValue(Date.now() + 5 * 60_000)}
                  onChange={(e) => setCustomEndsAtLocal(e.target.value)}
                />
              </div>
            )}

            <p className="admin-contest-hint">{plannedHint}</p>

            <label className="form-label" htmlFor="contest-task">
              Contest Task
            </label>
            <textarea
              id="contest-task"
              className="form-input admin-contest-textarea"
              placeholder="Describe the contest challenge shown on the leaderboard..."
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={4}
            />
          </div>
        )}

        {isLive && topEntries.length > 0 && (
          <div className="admin-contest-results admin-contest-results--compact">
            <h4 className="admin-contest-section-title">Current Top 10</h4>
            {topEntries.map((entry, index) => (
              <div key={`${entry.walletAddress ?? entry.name}-${index}`} className="admin-contest-result-row">
                <span className="admin-contest-result-rank">#{index + 1}</span>
                <span className="admin-contest-result-wallet">
                  {formatWallet(entry.walletAddress)}
                </span>
                <span className="admin-contest-result-score">
                  {entry.score.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="admin-modal-actions">
          <button type="button" className="toggle-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          {isLive ? (
            <button
              type="button"
              className="add-submit-btn admin-modal-save"
              onClick={handleSaveEdit}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          ) : (
            <button
              type="button"
              className="add-submit-btn admin-modal-save"
              onClick={handleStartContest}
              disabled={saving}
            >
              {saving ? "Starting..." : isEnded ? "Start New Contest" : "Start Contest"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
