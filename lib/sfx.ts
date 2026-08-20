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

let lastTouchAt = 0;

export function playTouchSfx() {
  const now = Date.now();
  if (now - lastTouchAt < 40) return;
  lastTouchAt = now;
  unlockSuccessSfx();

  const proto = getAudio("touch");
  if (!proto) return;

  try {
    const node = proto.cloneNode(true) as HTMLAudioElement;
    node.volume = proto.volume;
    node.muted = false;
    void node.play().catch(() => playSfx("touch"));
  } catch {
    playSfx("touch");
  }
}

export function playSuccessSfx() {
  const el = getAudio("success");
  if (!el) return;

  el.muted = false;
  el.volume = 0.9;
  try {
    el.pause();
    el.currentTime = 0;
  } catch {
    // ignore seek errors
  }
  void el.play().catch(() => {
    const fallback = new Audio(SOURCES.success);
    fallback.volume = 0.9;
    void fallback.play().catch(() => {});
  });
}
