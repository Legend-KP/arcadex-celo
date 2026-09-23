"use client";

import Logo from "@/components/Logo";
import {
  FAQ_URL,
  PRIVACY_POLICY_URL,
  SUPPORT_URL,
  TERMS_URL,
} from "@/lib/app-footer-links";

export type AppView =
  | "home"
  | "games"
  | "contests"
  | "leaderboard"
  | "achievements";

const NAV: { id: AppView | "sparks"; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "games", label: "Games" },
  { id: "contests", label: "Contests" },
  { id: "leaderboard", label: "Global Leaderboard" },
  { id: "sparks", label: "Sparks" },
  { id: "achievements", label: "Achievements" },
];

interface AppDrawerProps {
  open: boolean;
  onClose: () => void;
  view: AppView;
  onNavigate: (view: AppView) => void;
  onOpenSparks: () => void;
  onOpenTutorial: () => void;
  onEditName: () => void;
  playerName: string;
  walletAddress: string;
}

function truncateWallet(wallet: string): string {
  if (!wallet || wallet.length < 12) return wallet || "Not connected";
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

export default function AppDrawer({
  open,
  onClose,
  view,
  onNavigate,
  onOpenSparks,
  onOpenTutorial,
  onEditName,
  playerName,
  walletAddress,
}: AppDrawerProps) {
  return (
    <>
      <div
        className={`app-drawer-backdrop${open ? " is-open" : ""}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`app-drawer${open ? " is-open" : ""}`}
        aria-hidden={!open}
        aria-label="ArcadeX menu"
      >
        <div className="app-drawer__brand">
          <Logo variant="drawer" />
        </div>

        <div className="app-drawer__profile">
          <div className="app-drawer__avatar" aria-hidden>
            {(playerName.trim() || "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="app-drawer__profile-text">
            <div className="app-drawer__name-row">
              <p className="app-drawer__name">
                {playerName.trim() || "Player"}
              </p>
              <button
                type="button"
                className="app-drawer__edit-name"
                onClick={() => {
                  onEditName();
                  onClose();
                }}
              >
                Edit
              </button>
            </div>
            <p className="app-drawer__wallet">
              {truncateWallet(walletAddress)}
            </p>
          </div>
        </div>

        <nav className="app-drawer__nav" aria-label="Primary">
          {NAV.map((item) => {
            const active = item.id !== "sparks" && item.id === view;
            return (
              <button
                key={item.id}
                type="button"
                className={`app-drawer__link${active ? " is-active" : ""}`}
                onClick={() => {
                  if (item.id === "sparks") {
                    onOpenSparks();
                    onClose();
                    return;
                  }
                  onNavigate(item.id);
                  onClose();
                }}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="app-drawer__footer">
          <a
            href={PRIVACY_POLICY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="app-drawer__footer-link"
          >
            Privacy Policy
          </a>
          <a
            href={TERMS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="app-drawer__footer-link"
          >
            Terms &amp; Conditions
          </a>
          <a
            href={FAQ_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="app-drawer__footer-link"
          >
            FAQ
          </a>
          <a
            href={SUPPORT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="app-drawer__footer-link"
          >
            Support
          </a>
          <button
            type="button"
            className="app-drawer__footer-link app-drawer__footer-link--button"
            onClick={() => {
              onOpenTutorial();
              onClose();
            }}
          >
            Tutorial
          </button>
        </div>
      </aside>
    </>
  );
}
