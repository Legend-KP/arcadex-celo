"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import Logo from "@/components/Logo";
import {
  FAQ_URL,
  PRIVACY_POLICY_URL,
  SUPPORT_URL,
  TERMS_URL,
} from "@/lib/app-footer-links";
import {
  unlockTestGame,
  verifyTestGamePassword,
} from "@/lib/test-game-access";
import { useClaimUiOverlay } from "@/lib/use-ui-overlay-gate";

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
  { id: "leaderboard", label: "Daily XP Board" },
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
  testGameId?: string | null;
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
  testGameId = null,
}: AppDrawerProps) {
  const router = useRouter();
  const [testOpen, setTestOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPw, setShowPw] = useState(false);

  useClaimUiOverlay("test-access", Boolean(testOpen && testGameId));

  function openTest() {
    setPassword("");
    setError("");
    setShowPw(false);
    setTestOpen(true);
    onClose();
  }

  function closeTest() {
    setTestOpen(false);
    setPassword("");
    setError("");
  }

  function submitTestPassword() {
    if (!testGameId) return;
    if (!verifyTestGamePassword(password)) {
      setError("Wrong password.");
      setPassword("");
      return;
    }
    unlockTestGame(testGameId);
    closeTest();
    router.push(`/game/${testGameId}`);
  }

  const testModal =
    testOpen && testGameId ? (
      <div
        className="test-access-backdrop"
        onClick={closeTest}
        role="presentation"
      >
        <div
          className="test-access-popup"
          role="dialog"
          aria-modal="true"
          aria-labelledby="test-access-title"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="test-access-title" className="test-access-popup__title">
            Test access
          </h2>
          <p className="test-access-popup__subtitle">
            Enter the password to open the test game.
          </p>
          <div className="form-group" style={{ textAlign: "left", marginBottom: 12 }}>
            <label className="form-label" htmlFor="test-game-password">
              Password
            </label>
            <div className="pw-wrap">
              <input
                id="test-game-password"
                className={`form-input ${error ? "input-error" : ""}`}
                type={showPw ? "text" : "password"}
                placeholder="Enter password"
                value={password}
                autoFocus
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && submitTestPassword()}
              />
              <button
                className="pw-toggle"
                onClick={() => setShowPw((v) => !v)}
                type="button"
                tabIndex={-1}
              >
                {showPw ? "🙈" : "👁"}
              </button>
            </div>
            {error ? <p className="error-msg">{error}</p> : null}
          </div>
          <div className="test-access-popup__actions">
            <button
              type="button"
              className="test-access-popup__btn test-access-popup__btn--ghost"
              onClick={closeTest}
            >
              Cancel
            </button>
            <button
              type="button"
              className="test-access-popup__btn"
              onClick={submitTestPassword}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    ) : null;

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
          {testGameId ? (
            <button
              type="button"
              className="app-drawer__footer-link app-drawer__footer-link--button"
              onClick={openTest}
            >
              Test
            </button>
          ) : null}
        </div>
      </aside>
      {typeof document !== "undefined" && testModal
        ? createPortal(testModal, document.body)
        : testModal}
    </>
  );
}
