"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { gameSquareImageCandidates, preloadGameMenuAssets } from "@/lib/game-assets";
import { playTouchSfx } from "@/lib/sfx";
import { useClaimUiOverlay } from "@/lib/use-ui-overlay-gate";
import type { Game } from "@/types";

export const DAILY_EARN_OVERLAY_ID = "daily-earn";

interface DailyEarnPopupProps {
  open: boolean;
  unclaimed: Game[];
  claimed: Game[];
  onClose: () => void;
}

function GameMark({ game }: { game: Game }) {
  const candidates = useMemo(() => gameSquareImageCandidates(game), [game]);
  const [index, setIndex] = useState(0);
  const src = candidates[index];

  if (!src) {
    return <span className="daily-earn__logo daily-earn__logo--empty" aria-hidden />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="daily-earn__logo"
      src={src}
      alt=""
      width={44}
      height={44}
      decoding="async"
      onError={() => setIndex((current) => current + 1)}
    />
  );
}

function EarnRow({
  game,
  claimed,
  onOpen,
}: {
  game: Game;
  claimed: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="daily-earn__row">
      <GameMark game={game} />
      <p className="daily-earn__name">{game.name}</p>
      {claimed ? (
        <button
          type="button"
          className="daily-earn__btn daily-earn__btn--done"
          disabled
        >
          Claim again tomorrow
        </button>
      ) : (
        <Link
          href={`/game/${game.id}`}
          className="daily-earn__btn"
          prefetch={false}
          onPointerEnter={() =>
            preloadGameMenuAssets(game, { includeTutorial: true })
          }
          onTouchStart={() =>
            preloadGameMenuAssets(game, { includeTutorial: true })
          }
          onClick={() => {
            playTouchSfx();
            onOpen();
          }}
        >
          Claim
        </Link>
      )}
    </div>
  );
}

export default function DailyEarnPopup({
  open,
  unclaimed,
  claimed,
  onClose,
}: DailyEarnPopupProps) {
  useClaimUiOverlay(DAILY_EARN_OVERLAY_ID, open);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="daily-earn-backdrop" role="presentation" onClick={onClose}>
      <div
        className="daily-earn"
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-earn-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="daily-earn__head">
          <span className="daily-earn__head-spacer" aria-hidden />
          <h2 id="daily-earn-title" className="daily-earn__title">
            Earn Daily
          </h2>
          <button
            type="button"
            className="daily-earn__close"
            aria-label="Close"
            onClick={() => {
              playTouchSfx();
              onClose();
            }}
          >
            ✕
          </button>
        </div>

        <div className="daily-earn__list" role="list">
          {unclaimed.map((game) => (
            <div key={game.id} role="listitem">
              <EarnRow game={game} claimed={false} onOpen={onClose} />
            </div>
          ))}
          {claimed.length > 0 && unclaimed.length > 0 ? (
            <div className="daily-earn__split" role="separator" />
          ) : null}
          {claimed.map((game) => (
            <div key={game.id} role="listitem">
              <EarnRow game={game} claimed onOpen={onClose} />
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
