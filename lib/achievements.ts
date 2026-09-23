import type { GameProgress, Mission, MissionType } from "@/types";

/** Display level from claimed XP (no extra DB writes). */
export function levelFromXp(xp: number): number {
  const safe = Math.max(0, Math.floor(xp));
  return Math.floor(safe / 500) + 1;
}

export function isMissionType(value: unknown): value is MissionType {
  return value === "score" || value === "level";
}

/** Current progress value for a mission from stored game progress. */
export function missionCurrentValue(
  mission: Pick<Mission, "type" | "mode">,
  progress: GameProgress | null | undefined
): number {
  if (!progress) return 0;
  if (mission.type === "score") {
    return Math.max(0, Math.floor(progress.score ?? 0));
  }
  const mode = mission.mode?.trim().toLowerCase();
  if (mode && progress.modes) {
    const fromMode = progress.modes[mode];
    if (typeof fromMode === "number" && Number.isFinite(fromMode)) {
      return Math.max(0, Math.floor(fromMode));
    }
  }
  return Math.max(0, Math.floor(progress.level ?? 0));
}

export function isMissionMet(
  mission: Pick<Mission, "type" | "mode" | "threshold">,
  progress: GameProgress | null | undefined
): boolean {
  return missionCurrentValue(mission, progress) >= mission.threshold;
}
