"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
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

interface AppFooterProps {
  testGameId?: string | null;
}

export default function AppFooter({ testGameId = null }: AppFooterProps) {
  const { openOnboarding } = usePlayerProfile();
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
    <footer className="app-footer">
      <nav className="app-footer__nav" aria-label="Legal and support">
        <a
          href={PRIVACY_POLICY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="app-footer__link"
        >
          Privacy Policy
        </a>
        <span className="app-footer__sep" aria-hidden>
          ·
        </span>
        <a
          href={TERMS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="app-footer__link"
        >
          Terms &amp; Conditions
        </a>
        <span className="app-footer__sep" aria-hidden>
          ·
        </span>
        <a
          href={FAQ_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="app-footer__link"
        >
          FAQ
        </a>
        <span className="app-footer__sep" aria-hidden>
          ·
        </span>
        <a
          href={SUPPORT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="app-footer__link"
        >
          Support
        </a>
        <span className="app-footer__sep" aria-hidden>
          ·
        </span>
        <button
          type="button"
          className="app-footer__link app-footer__link--button"
          onClick={openOnboarding}
        >
          Tutorial
        </button>
        {testGameId ? (
          <>
            <span className="app-footer__sep" aria-hidden>
              ·
            </span>
            <button
              type="button"
              className="app-footer__link app-footer__link--button"
              onClick={openTest}
            >
              Test
            </button>
          </>
        ) : null}
      </nav>
      <p className="app-footer__note">ArcadeX · Web3 Game Hub</p>
      {typeof document !== "undefined" && testModal
        ? createPortal(testModal, document.body)
        : testModal}
    </footer>
  );
}
