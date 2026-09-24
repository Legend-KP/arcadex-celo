import { Game } from "@/types";
import { slugifyGameName } from "@/lib/game-assets";

export interface GameTheme {
  topbar: string;
  text: string;
}

const DEFAULT_THEME: GameTheme = {
  topbar: "#ffffff",
  text: "#1a1a2e",
};

/** Topbar / accent colors matched to each game's in-game palette. */
const GAME_THEMES: Record<string, GameTheme> = {
  "dot-connect": { topbar: "#4a7fd4", text: "#ffffff" },
  basedrop: { topbar: "#1d4ed8", text: "#ffffff" },
  "block-blast": { topbar: "#7c3aed", text: "#ffffff" },
  "math-run": { topbar: "#16a34a", text: "#ffffff" },
  "orbit-flow": { topbar: "#0891b2", text: "#ffffff" },
  "coin-sort": { topbar: "#d97706", text: "#ffffff" },
  coinsort: { topbar: "#d97706", text: "#ffffff" },
  "line-link": { topbar: "#2563eb", text: "#ffffff" },
  linelink: { topbar: "#2563eb", text: "#ffffff" },
  "jelly-jumble": { topbar: "#db2777", text: "#ffffff" },
  jellyjumble: { topbar: "#db2777", text: "#ffffff" },
  jelly: { topbar: "#db2777", text: "#ffffff" },
  "arrow-out": { topbar: "#ea580c", text: "#ffffff" },
  arrowout: { topbar: "#ea580c", text: "#ffffff" },
  burger: { topbar: "#c2410c", text: "#ffffff" },
  "burger-game": { topbar: "#c2410c", text: "#ffffff" },
  cake: { topbar: "#ec4899", text: "#ffffff" },
  "cake-sort": { topbar: "#ec4899", text: "#ffffff" },
  dunk: { topbar: "#dc2626", text: "#ffffff" },
  "dunk-master": { topbar: "#dc2626", text: "#ffffff" },
  sanddrop: { topbar: "#ca8a04", text: "#ffffff" },
  "sand-drop": { topbar: "#ca8a04", text: "#ffffff" },
  fruit: { topbar: "#16a34a", text: "#ffffff" },
  "fruit-game": { topbar: "#16a34a", text: "#ffffff" },
  hungry: { topbar: "#7c3aed", text: "#ffffff" },
  "hungry-hole": { topbar: "#7c3aed", text: "#ffffff" },
  tower: { topbar: "#475569", text: "#ffffff" },
  "defend-tower": { topbar: "#475569", text: "#ffffff" },
};

export function getGameTheme(game: Pick<Game, "name" | "id">): GameTheme {
  const nameSlug = slugifyGameName(game.name);
  if (GAME_THEMES[nameSlug]) return GAME_THEMES[nameSlug];

  const id = game.id.trim().toLowerCase();
  if (id && GAME_THEMES[id]) return GAME_THEMES[id];

  return DEFAULT_THEME;
}
