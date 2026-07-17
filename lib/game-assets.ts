import { Game } from "@/types";

/** Folder names under public/games/ for each title. */
const LOCAL_GAME_FOLDERS = [
  "basedrop",
  "block-blast",
  "coin-sort",
  "dot-connect",
  "line-link",
  "math-run",
  "orbit-flow",
] as const;

export function slugifyGameName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isFirestoreAutoId(id: string): boolean {
  return /^[a-zA-Z0-9]{15,}$/.test(id) && !id.includes("-");
}

function resolveLocalGameFolder(game: Game): string | null {
  const nameSlug = slugifyGameName(game.name);
  if (LOCAL_GAME_FOLDERS.includes(nameSlug as (typeof LOCAL_GAME_FOLDERS)[number])) {
    return nameSlug;
  }

  const id = game.id.trim().toLowerCase();
  if (id && !isFirestoreAutoId(id)) {
    if (LOCAL_GAME_FOLDERS.includes(id as (typeof LOCAL_GAME_FOLDERS)[number])) {
      return id;
    }
  }

  return null;
}

function pushLocalGameAssets(
  push: (url?: string) => void,
  folder: string,
  kind: "logo" | "thumbnail"
) {
  if (kind === "thumbnail") {
    push(`/thumbnails/${folder}.webp`);
  }

  push(`/games/${folder}/logo.webp`);
  push(`/games/${folder}/logo.png`);
  push(`/games/${folder}/thumbnail.webp`);
  push(`/games/${folder}/thumbnail.png`);
}

/** Local / remote asset URLs to try, in priority order. */
export function gameAssetCandidates(
  game: Game,
  kind: "logo" | "thumbnail"
): string[] {
  const field = kind === "logo" ? game.logo : game.thumbnail;
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (url?: string) => {
    if (!url?.trim() || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };

  const localFolder = resolveLocalGameFolder(game);

  // Prefer bundled assets so they show even when remote URLs fail.
  if (localFolder) {
    pushLocalGameAssets(push, localFolder, kind);
  }

  push(field);

  if (kind === "logo" && game.thumbnail?.trim()) {
    push(game.thumbnail);
  }

  if (localFolder) {
    return out;
  }

  const nameSlug = slugifyGameName(game.name);
  if (nameSlug) {
    pushLocalGameAssets(push, nameSlug, kind);
  }

  const id = game.id.trim().toLowerCase();
  if (id && !isFirestoreAutoId(id)) {
    pushLocalGameAssets(push, id, kind);
  }

  return out;
}

function pushLocalMenuAssets(push: (url?: string) => void, folder: string) {
  const prefix = folder.split("-")[0];
  push(`/games/${folder}/${prefix}-logo.webp`);
  push(`/games/${folder}/${prefix}-logo.png`);
  push(`/games/${folder}/fallback.webp`);
  push(`/games/${folder}/fallback.png`);
  push(`/games/${folder}/logo.webp`);
  push(`/games/${folder}/logo.png`);
}

/** Fallback image URLs when thumbnail and logo are unavailable. */
export function gameFallbackCandidates(game: Game): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (url?: string) => {
    if (!url?.trim() || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };

  const localFolder = resolveLocalGameFolder(game);
  if (localFolder) {
    pushLocalMenuAssets(push, localFolder);
  }

  const nameSlug = slugifyGameName(game.name);
  if (nameSlug && nameSlug !== localFolder) {
    pushLocalMenuAssets(push, nameSlug);
  }

  push(game.fallbackImage);

  return out;
}

/** Menu screen image URLs — fallback first, then logo, then thumbnail. */
export function gameMenuImageCandidates(game: Game): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (url?: string) => {
    if (!url?.trim() || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };

  for (const url of gameFallbackCandidates(game)) push(url);
  for (const url of gameAssetCandidates(game, "logo")) push(url);
  for (const url of gameAssetCandidates(game, "thumbnail")) push(url);

  return out;
}

/** Blurred menu background — fallback first so it appears immediately. */
export function gameMenuBackgroundCandidates(game: Game): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (url?: string) => {
    if (!url?.trim() || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };

  for (const url of gameFallbackCandidates(game)) push(url);
  for (const url of gameAssetCandidates(game, "thumbnail")) push(url);
  for (const url of gameAssetCandidates(game, "logo")) push(url);

  return out;
}

/** Warm the browser cache for menu images before the menu mounts. */
export function preloadGameMenuAssets(game: Game): void {
  if (typeof window === "undefined") return;

  const seen = new Set<string>();
  const urls = [
    ...gameMenuBackgroundCandidates(game),
    ...gameMenuImageCandidates(game),
  ];

  const tutorialUrl = getGameTutorialUrl(game);
  if (tutorialUrl) urls.unshift(tutorialUrl);

  for (const url of urls) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const img = new Image();
    img.fetchPriority = "high";
    img.decoding = "async";
    img.src = url;
    if (seen.size >= 5) break;
  }
}

/** Local tutorial images under public/tutorials/, keyed by game folder slug. */
const GAME_TUTORIAL_BY_FOLDER: Record<string, string> = {
  "coin-sort": "/tutorials/cointut.webp",
  "dot-connect": "/tutorials/dotconnecttut.webp",
  "math-run": "/tutorials/mathtut.webp",
  "orbit-flow": "/tutorials/orbittut.webp",
};

function resolveTutorialKey(game: Game): string {
  return resolveLocalGameFolder(game) ?? (slugifyGameName(game.name) || game.id);
}

/** Tutorial image URL for a game, or null when none is prepared yet. */
export function getGameTutorialUrl(game: Game): string | null {
  const key = resolveTutorialKey(game);
  return GAME_TUTORIAL_BY_FOLDER[key] ?? null;
}

/** localStorage key for per-game first-time tutorial seen state. */
export function getGameTutorialSeenKey(game: Game): string {
  return `arcadex_tutorial_seen:${resolveTutorialKey(game)}`;
}
