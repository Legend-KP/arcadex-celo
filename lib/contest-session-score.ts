/**
 * Best score observed during the current contest window (this browser session).
 * Used so contest submits do not fall back to lifetime personal best.
 */

const PREFIX = "arcadex_contest_run:";
const TTL_MS = 14 * 24 * 60 * 60 * 1000;

interface StoredContestSession {
  score: number;
  contestStartedAt: number;
  at: number;
}

function storageKey(gameId: string, contestStartedAt: number): string {
  return `${PREFIX}${gameId}:${contestStartedAt}`;
}

export function getContestSessionBest(
  gameId: string,
  contestStartedAt: number | null | undefined
): number {
  if (typeof window === "undefined") return 0;
  if (typeof contestStartedAt !== "number" || !Number.isFinite(contestStartedAt)) {
    return 0;
  }

  const raw = sessionStorage.getItem(storageKey(gameId, contestStartedAt));
  if (!raw) return 0;

  try {
    const parsed = JSON.parse(raw) as StoredContestSession;
    if (
      parsed.contestStartedAt !== contestStartedAt ||
      Date.now() - parsed.at > TTL_MS
    ) {
      sessionStorage.removeItem(storageKey(gameId, contestStartedAt));
      return 0;
    }
    return typeof parsed.score === "number" && parsed.score > 0
      ? Math.floor(parsed.score)
      : 0;
  } catch {
    sessionStorage.removeItem(storageKey(gameId, contestStartedAt));
    return 0;
  }
}

export function noteContestSessionScore(
  gameId: string,
  contestStartedAt: number | null | undefined,
  score: number
): number {
  if (typeof window === "undefined") return 0;
  if (typeof contestStartedAt !== "number" || !Number.isFinite(contestStartedAt)) {
    return 0;
  }
  if (typeof score !== "number" || !Number.isFinite(score) || score <= 0) {
    return getContestSessionBest(gameId, contestStartedAt);
  }

  const next = Math.max(
    getContestSessionBest(gameId, contestStartedAt),
    Math.floor(score)
  );
  const payload: StoredContestSession = {
    score: next,
    contestStartedAt,
    at: Date.now(),
  };
  sessionStorage.setItem(
    storageKey(gameId, contestStartedAt),
    JSON.stringify(payload)
  );
  return next;
}

/**
 * Pick the score that should go on the contest board.
 * Prefer the best run observed during this contest; never invent a lifetime PB.
 */
export function resolveContestSubmitScore(opts: {
  submittedScore: number;
  contestSessionBest: number;
  personalBest: number;
}): number | null {
  const submitted = Math.floor(opts.submittedScore);
  const sessionBest = Math.floor(opts.contestSessionBest);
  const personalBest = Math.floor(opts.personalBest);

  // Lifetime PB with no contest runs observed → reject (classic mint bug).
  if (personalBest > 0 && submitted === personalBest && sessionBest <= 0) {
    return null;
  }

  let best = sessionBest;

  if (submitted > 0) {
    const looksLikeContestRun =
      personalBest <= 0 ||
      submitted < personalBest ||
      submitted > personalBest;
    if (looksLikeContestRun) {
      best = Math.max(best, submitted);
    }
    // submitted === personalBest with sessionBest > 0: keep session best only
  }

  return best > 0 ? best : null;
}
