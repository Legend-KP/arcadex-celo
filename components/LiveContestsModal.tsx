"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { formatContestCountdown, isContestActive } from "@/lib/contest";
import { gameSquareImageCandidates, preloadGameMenuAssets } from "@/lib/game-assets";
import { playTouchSfx } from "@/lib/sfx";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { Game, gameIsLive, gameIsTest } from "@/types";

export const LIVE_CONTESTS_HEADER = "/live-contests-header.jpg";
export const LIVE_CONTESTS_FOOTER_COINS = "/live-contests-footer-coins.jpg";

const CARD_TONES = ["lavender", "butter", "sky"] as const;

interface LiveContestsModalProps {
  open: boolean;
  games: Game[];
  onDismiss: () => void;
  onPlay: (gameId: string) => void;
}

function ContestThumb({ game }: { game: Game }) {
  const candidates = useMemo(() => gameSquareImageCandidates(game), [game]);
  const [index, setIndex] = useState(0);
  const src = candidates[index];

  if (!src) {
    return <span className="live-contests__thumb live-contests__thumb--empty" aria-hidden />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="live-contests__thumb"
      src={src}
      alt=""
      width={56}
      height={56}
      decoding="async"
      onError={() => setIndex((current) => (current + 1 < candidates.length ? current + 1 : current))}
    />
  );
}

function ContestCard({
  game,
  tone,
  now,
  onPlay,
}: {
  game: Game;
  tone: (typeof CARD_TONES)[number];
  now: number;
  onPlay: (gameId: string) => void;
}) {
  const endsAt = typeof game.contestEndsAt === "number" ? game.contestEndsAt : 0;
  const remaining = formatContestCountdown(Math.max(0, endsAt - now));

  return (
    <article className={`live-contests__card live-contests__card--${tone}`}>
      <span className="live-contests__live-pill">
        <span aria-hidden>⚡</span> LIVE
      </span>
      <div className="live-contests__card-row">
        <ContestThumb game={game} />
        <div className="live-contests__card-copy">
          <h3 className="live-contests__card-title">{game.name} Contest</h3>
          <p className="live-contests__card-meta" role="status">
            <span className="live-contests__card-clock" aria-hidden>
              ⏱
            </span>
            Ends in {remaining}
          </p>
        </div>
        <button
          type="button"
          className="live-contests__play"
          onPointerEnter={() =>
            preloadGameMenuAssets(game, { includeTutorial: true })
          }
          onTouchStart={() =>
            preloadGameMenuAssets(game, { includeTutorial: true })
          }
          onClick={() => {
            playTouchSfx();
            onPlay(game.id);
          }}
        >
          Play Now <span aria-hidden>→</span>
        </button>
      </div>
    </article>
  );
}

export function getLiveContestGames(games: Game[], now = Date.now()): Game[] {
  return games
    .filter(
      (game) =>
        game.active &&
        !gameIsTest(game) &&
        gameIsLive(game) &&
        isContestActive(game, now)
    )
    .sort(
      (a, b) =>
        (a.contestEndsAt ?? Number.MAX_SAFE_INTEGER) -
        (b.contestEndsAt ?? Number.MAX_SAFE_INTEGER)
    );
}

export default function LiveContestsModal({
  open,
  games,
  onDismiss,
  onPlay,
}: LiveContestsModalProps) {
  const [now, setNow] = useState(() => Date.now());
  useBodyScrollLock(open);

  const liveGames = useMemo(() => getLiveContestGames(games, now), [games, now]);

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onDismiss]);

  if (!open || typeof document === "undefined" || liveGames.length === 0) {
    return null;
  }

  const countLabel =
    liveGames.length === 1
      ? "1 Live Contest"
      : `${liveGames.length} Live Contests`;

  return createPortal(
    <div className="live-contests-backdrop" role="presentation">
      <div
        className="live-contests"
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-contests-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="live-contests__close"
          aria-label="Dismiss"
          onClick={() => {
            playTouchSfx();
            onDismiss();
          }}
        >
          ✕
        </button>

        <header className="live-contests__hero">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="live-contests__banner"
            src={LIVE_CONTESTS_HEADER}
            alt=""
            width={900}
            height={320}
          />
          <div className="live-contests__hero-copy">
            <h2 id="live-contests-title" className="live-contests__title">
              Live Contests
            </h2>
            <p className="live-contests__subtitle">
              Play, Compete &amp; Earn{" "}
              <span className="live-contests__usdt-pill">USDT</span>
            </p>
          </div>
        </header>

        <div className="live-contests__status">
          <p className="live-contests__status-live">
            <span className="live-contests__dot" aria-hidden />
            {countLabel}
          </p>
          <p className="live-contests__status-hint">
            <span aria-hidden>🪙</span> Play now &amp; win USDT rewards
          </p>
        </div>

        <div className="live-contests__list" role="list">
          {liveGames.map((game, index) => (
            <div key={game.id} role="listitem">
              <ContestCard
                game={game}
                tone={CARD_TONES[index % CARD_TONES.length]}
                now={now}
                onPlay={onPlay}
              />
            </div>
          ))}
        </div>

        <footer className="live-contests__footer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="live-contests__footer-art"
            src={LIVE_CONTESTS_FOOTER_COINS}
            alt=""
            width={120}
            height={72}
          />
          <div className="live-contests__footer-copy">
            <p className="live-contests__footer-title">
              Earn USDT by Playing Contests!
            </p>
            <ul className="live-contests__checklist">
              <li>
                <span className="live-contests__check" aria-hidden>
                  ✓
                </span>
                Join a live contest
              </li>
              <li>
                <span className="live-contests__check" aria-hidden>
                  ✓
                </span>
                Play your best
              </li>
              <li>
                <span className="live-contests__check" aria-hidden>
                  ✓
                </span>
                Win USDT rewards
              </li>
            </ul>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}
