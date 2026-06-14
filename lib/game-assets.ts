import { Game } from "@/types";

/** Folder names under public/games/ for each title. */
const LOCAL_GAME_FOLDERS = [
  "basedrop",
  "block-blast",
  "dot-connect",
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

/** Fallback image URLs when thumbnail and logo are unavailable. */
export function gameFallbackCandidates(game: Game): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (url?: string) => {
    if (!url?.trim() || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };

  push(game.fallbackImage);

  const localFolder = resolveLocalGameFolder(game);
  if (localFolder) {
    push(`/games/${localFolder}/fallback.webp`);
    push(`/games/${localFolder}/fallback.png`);
  }

  const nameSlug = slugifyGameName(game.name);
  if (nameSlug && nameSlug !== localFolder) {
    push(`/games/${nameSlug}/fallback.webp`);
    push(`/games/${nameSlug}/fallback.png`);
  }

  return out;
}
