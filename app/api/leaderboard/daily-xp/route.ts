import { NextResponse } from "next/server";
import {
  computeDailyXp,
  DAILY_XP_LEADERBOARD_MAX_ENTRIES,
  DAILY_XP_THRESHOLD,
  findDailyXpRank,
  formatDailyXpCountdown,
  getUtcDayWindow,
  isDailyXpLive,
  isDailyXpTransition,
} from "@/lib/daily-xp-board";
import {
  fetchDailyXpLeaderboardFromServer,
  fetchUserDailyXpFromServer,
  getDailyXpClaim,
  isDailyXpBanned,
} from "@/lib/daily-xp-store";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  isWalletAddress,
  normalizeWalletAddress,
} from "@/lib/wallet-address";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`daily-xp-lb:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  try {
    if (isDailyXpTransition()) {
      return NextResponse.json({
        live: false,
        transition: true,
        dayKey: null,
        startsAt: null,
        endsAt: null,
        resetsIn: null,
        endsAtMs: null,
        threshold: DAILY_XP_THRESHOLD,
        entries: [],
        me: null,
      });
    }

    const { searchParams } = new URL(request.url);
    const walletRaw = searchParams.get("wallet")?.trim() ?? "";
    const day = getUtcDayWindow();

    const entries = await fetchDailyXpLeaderboardFromServer(
      day.dayKey,
      DAILY_XP_LEADERBOARD_MAX_ENTRIES
    );

    let me: {
      rank: number | null;
      score: number;
      checkedIn: boolean;
      claimed: boolean;
      banned: boolean;
      canClaim: boolean;
      plays: number;
      spendUnits: number;
    } | null = null;

    if (walletRaw && isWalletAddress(walletRaw)) {
      const wallet = normalizeWalletAddress(walletRaw);
      const [stats, claim, banned] = await Promise.all([
        fetchUserDailyXpFromServer(wallet, day.dayKey),
        getDailyXpClaim(wallet, day.dayKey),
        isDailyXpBanned(wallet),
      ]);
      const xp = computeDailyXp(stats);
      const claimed = claim?.status === "claimed";
      const checkedIn = Boolean(stats.checkedIn);
      me = {
        rank: xp > 0 ? findDailyXpRank(entries, wallet) : null,
        score: xp,
        checkedIn,
        claimed,
        banned,
        canClaim:
          isDailyXpLive() &&
          !banned &&
          !claimed &&
          checkedIn &&
          xp >= DAILY_XP_THRESHOLD,
        plays: stats.plays,
        spendUnits: stats.spendUnits,
      };
    }

    const remainingMs = Math.max(0, day.endsAt - Date.now());

    return NextResponse.json({
      live: true,
      transition: false,
      dayKey: day.dayKey,
      startsAt: day.startsAt,
      endsAt: day.endsAt,
      resetsIn: formatDailyXpCountdown(remainingMs),
      endsAtMs: day.endsAt,
      threshold: DAILY_XP_THRESHOLD,
      entries,
      me,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load daily XP board.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
