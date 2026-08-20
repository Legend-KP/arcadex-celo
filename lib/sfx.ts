const SOURCES = {
  touch: "/sounds/touch.mp3",
  success: "/sounds/success.mp3",
} as const;

export type SfxName = keyof typeof SOURCES;

let successUnlocked = false;
const elements = new Map<SfxName, HTMLAudioElement>();

function getAudio(name: SfxName): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;

  let el = elements.get(name);
  if (!el) {
    el = new Audio(SOURCES[name]);
    el.preload = "auto";
    el.volume = name === "touch" ? 0.7 : 0.9;
    el.setAttribute("playsinline", "true");
    elements.set(name, el);
  }
  return el;
}

/** Create audio nodes early so the first tap is instant. */
export function preloadSfx() {
  getAudio("touch");
  getAudio("success");
}

/**
 * Unlock the success clip during a tap so it can play later, after MiniPay.
 * The touch clip is unlocked by playing it for real.
 */
function unlockSuccessSfx() {
  if (successUnlocked || typeof window === "undefined") return;
  successUnlocked = true;

  const el = getAudio("success");
  if (!el) return;

  el.muted = true;
  void el
    .play()
    .then(() => {
      el.pause();
      el.currentTime = 0;
      el.muted = false;
    })
    .catch(() => {
      el.muted = false;
      successUnlocked = false;
    });
}

export function playSfx(name: SfxName) {
  const el = getAudio(name);
  if (!el) return;

  try {
    el.pause();
    el.currentTime = 0;
    el.muted = false;
    void el.play().catch(() => {});
  } catch {
    // Autoplay blocked — ignore
  }
}

export function playTouchSfx() {
  unlockSuccessSfx();
  playSfx("touch");
}

export function playSuccessSfx() {
  playSfx("success");
}
