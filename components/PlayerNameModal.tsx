"use client";

import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Logo from "@/components/Logo";

interface PlayerNameModalProps {
  open: boolean;
  saving: boolean;
  error?: string;
  defaultName?: string;
  /** True when the player already has a name and is editing it. */
  editing?: boolean;
  onSubmit: (name: string) => void;
}

export default function PlayerNameModal({
  open,
  saving,
  error,
  defaultName = "",
  editing = false,
  onSubmit,
}: PlayerNameModalProps) {
  const [name, setName] = useState(defaultName);

  useEffect(() => {
    if (!open) return;
    setName(defaultName);
  }, [open]);

  useEffect(() => {
    if (!open || !defaultName) return;
    setName((prev) => prev.trim() || defaultName);
  }, [open, defaultName]);

  if (!open) return null;

  const isValid = name.trim().length >= 1;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValid || saving) return;
    onSubmit(name.trim());
  }

  const modal = (
    <div className="player-modal-backdrop">
      <div
        className="player-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-modal-title"
      >
        <Logo variant="login" />
        <p className="player-modal-subtitle">
          {editing ? "ArcadeX" : "Welcome to ArcadeX"}
        </p>
        <h2 id="player-modal-title" className="player-modal-title">
          {editing ? "Change your player name" : "Choose your player name"}
        </h2>
        <p className="player-modal-hint">
          This name appears on leaderboards across all games.
        </p>

        <form onSubmit={handleSubmit} className="player-modal-form">
          <label className="form-label" htmlFor="player-name">
            Player name
          </label>
          <input
            id="player-name"
            className={`form-input${error ? " input-error" : ""}`}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. PixelPro"
            maxLength={20}
            autoFocus
            autoComplete="nickname"
            disabled={saving}
          />
          {error && <p className="error-msg">{error}</p>}

          <button
            type="submit"
            className="player-modal-submit"
            disabled={saving || !isValid}
          >
            {saving ? "Saving..." : editing ? "Save name" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modal, document.body)
    : modal;
}
