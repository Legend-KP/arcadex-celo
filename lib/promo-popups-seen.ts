import { utcDayKey } from "@/lib/activity-week";

const READ_KEY = "arcadex_promo_read_v1";
const DAY_KEY = "arcadex_promo_day_v1";

export const PROMO_DAILY_CAP = 3;

type ReadMap = Record<string, string>;

interface DayStore {
  utcDay: string;
  shownCount: number;
  /** Event ids already presented today (avoids re-queue mid-session). */
  shownIds: string[];
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readMap(): ReadMap {
  if (!canUseStorage()) return {};
  try {
    const raw = localStorage.getItem(READ_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ReadMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: ReadMap): void {
  if (!canUseStorage()) return;
  try {
    const keys = Object.keys(map);
    if (keys.length > 120) {
      for (const key of keys.slice(0, keys.length - 80)) {
        delete map[key];
      }
    }
    localStorage.setItem(READ_KEY, JSON.stringify(map));
  } catch {
    // Quota / private mode
  }
}

function readDayStore(now = Date.now()): DayStore {
  const today = utcDayKey(now);
  if (!canUseStorage()) {
    return { utcDay: today, shownCount: 0, shownIds: [] };
  }
  try {
    const raw = localStorage.getItem(DAY_KEY);
    if (!raw) return { utcDay: today, shownCount: 0, shownIds: [] };
    const parsed = JSON.parse(raw) as Partial<DayStore>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.utcDay !== today
    ) {
      return { utcDay: today, shownCount: 0, shownIds: [] };
    }
    return {
      utcDay: today,
      shownCount:
        typeof parsed.shownCount === "number" && Number.isFinite(parsed.shownCount)
          ? Math.max(0, Math.floor(parsed.shownCount))
          : 0,
      shownIds: Array.isArray(parsed.shownIds)
        ? parsed.shownIds.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return { utcDay: today, shownCount: 0, shownIds: [] };
  }
}

function writeDayStore(store: DayStore): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(DAY_KEY, JSON.stringify(store));
  } catch {
    // Quota / private mode
  }
}

/** Permanent dismiss for one-shot promo events (not community). */
export function isPromoEventRead(eventId: string): boolean {
  if (!eventId) return false;
  return readMap()[eventId] === "1";
}

export function markPromoEventRead(eventId: string): void {
  if (!eventId) return;
  const map = readMap();
  map[eventId] = "1";
  writeMap(map);
}

export function getPromoShownCountToday(now = Date.now()): number {
  return readDayStore(now).shownCount;
}

export function getPromoRemainingSlotsToday(now = Date.now()): number {
  return Math.max(0, PROMO_DAILY_CAP - getPromoShownCountToday(now));
}

export function wasPromoShownToday(eventId: string, now = Date.now()): boolean {
  return readDayStore(now).shownIds.includes(eventId);
}

/** Record that a promo was presented (counts toward the daily cap). */
export function recordPromoPresented(eventId: string, now = Date.now()): void {
  if (!eventId) return;
  const store = readDayStore(now);
  if (store.shownIds.includes(eventId)) return;
  store.shownIds.push(eventId);
  store.shownCount = Math.min(PROMO_DAILY_CAP, store.shownCount + 1);
  writeDayStore(store);
}
