"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { dailyEarnLine } from "@/lib/daily-earn-lines";
import { gameSquareImageCandidates, preloadGameMenuAssets } from "@/lib/game-assets";
import { GAME_OPEN_CLAIM_USDT } from "@/lib/game-open-claim";
import { playTouchSfx } from "@/lib/sfx";
import { useClaimUiOverlay } from "@/lib/use-ui-overlay-gate";
import type { Game } from "@/types";

export const DAILY_EARN_OVERLAY_ID = "daily-earn";
const EARN_DAILY_BANNER = "/earn-daily-banner.jpg?v=2";
const USDT_MARK = "/usdt-mark.svg";

/** Three decimals so 0.012 never displays as 0.01. */
const EARN_DAILY_AMOUNT = `${GAME_OPEN_CLAIM_USDT.toFixed(3)} USDT`;

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
      width={46}
      height={46}
      decoding="async"
      onError={() => setIndex((current) => current + 1)}
    />
  );
}

function Amount() {
  return (
    <span className="daily-earn__amount">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="daily-earn__usdt" src={USDT_MARK} alt="" width={18} height={18} />
      <span>{EARN_DAILY_AMOUNT}</span>
    </span>
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
      <div className="daily-earn__copy">
        <p className="daily-earn__name">{game.name}</p>
        <p className="daily-earn__line">{dailyEarnLine(game.name)}</p>
      </div>
      <Amount />
      {claimed ? (
        <button type="button" className="daily-earn__btn daily-earn__btn--done" disabled>
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
          Claim <span aria-hidden="true">›</span>
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
        <div className="daily-earn__hero">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="daily-earn__banner"
            src={EARN_DAILY_BANNER}
            alt=""
            width={660}
            height={244}
          />
          <h2 id="daily-earn-title" className="daily-earn__sr">
            Earn Daily
          </h2>
          <p className="daily-earn__sr">
            Play these games and claim your USDT reward every day!
          </p>
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

        <div className="daily-earn__sheet">
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
      </div>
    </div>,
    document.body
  );
}
