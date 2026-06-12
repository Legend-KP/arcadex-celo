"use client";

import { useEffect, useState } from "react";
import {
  clearAdminSession,
  createAdminGame,
  deleteAdminGame,
  fetchAdminGames,
  hasAdminSession,
  loginAdmin,
  saveAdminSession,
  updateAdminGame,
} from "@/lib/admin-api";
import { Game, gameHasLeaderboard } from "@/types";
import Logo from "@/components/Logo";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "/";

const EMOJIS = ["🎮", "🏹", "🔷", "🔢", "🎂", "➕", "⚡", "🌀", "🎯", "🚀"];

export default function AdminPortal() {
  const [authed, setAuthed] = useState(() => hasAdminSession());
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const [name, setName] = useState("");
  const [thumbnail, setThumbnail] = useState("");
  const [url, setUrl] = useState("");
  const [plays, setPlays] = useState("");
  const [emoji, setEmoji] = useState("🎮");
  const [hasLeaderboard, setHasLeaderboard] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editThumbnail, setEditThumbnail] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editPlays, setEditPlays] = useState("");
  const [editEmoji, setEditEmoji] = useState("🎮");
  const [editHasLeaderboard, setEditHasLeaderboard] = useState(true);
  const [editSaving, setEditSaving] = useState(false);

  async function handleLogin() {
    setPwLoading(true);
    setPwError(false);
    try {
      await loginAdmin(pwInput);
      saveAdminSession(pwInput);
      setAuthed(true);
    } catch {
      setPwError(true);
      setPwInput("");
    } finally {
      setPwLoading(false);
    }
  }

  function handleLogout() {
    clearAdminSession();
    setAuthed(false);
    setPwInput("");
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }

  async function refresh() {
    setLoading(true);
    try {
      const g = await fetchAdminGames();
      setGames(g);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Could not load games."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authed) refresh();
  }, [authed]);

  async function handleAdd() {
    if (!name.trim() || !url.trim()) {
      showToast("Name and URL are required.");
      return;
    }
    setSaving(true);
    try {
      await createAdminGame({
        name: name.trim(),
        thumbnail: thumbnail.trim(),
        url: url.trim(),
        plays: plays.trim() || "0",
        emoji,
        active: true,
        hasLeaderboard,
      });
      setName("");
      setThumbnail("");
      setUrl("");
      setPlays("");
      setEmoji("🎮");
      setHasLeaderboard(true);
      await refresh();
      showToast("Game added! 🎮");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to add game. Try again."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this game?")) return;
    try {
      await deleteAdminGame(id);
      await refresh();
      showToast("Game removed.");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to remove game."
      );
    }
  }

  async function handleToggle(game: Game) {
    try {
      await updateAdminGame(game.id, { active: !game.active });
      await refresh();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to update game."
      );
    }
  }

  function startEdit(game: Game) {
    setEditingId(game.id);
    setEditName(game.name);
    setEditThumbnail(game.thumbnail);
    setEditUrl(game.url);
    setEditPlays(game.plays);
    setEditEmoji(game.emoji || "🎮");
    setEditHasLeaderboard(gameHasLeaderboard(game));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditSaving(false);
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    if (!editName.trim() || !editUrl.trim()) {
      showToast("Name and URL are required.");
      return;
    }

    setEditSaving(true);
    try {
      await updateAdminGame(editingId, {
        name: editName.trim(),
        thumbnail: editThumbnail.trim(),
        url: editUrl.trim(),
        plays: editPlays.trim() || "0",
        emoji: editEmoji,
        hasLeaderboard: editHasLeaderboard,
      });
      cancelEdit();
      await refresh();
      showToast("Game updated!");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to save changes."
      );
    } finally {
      setEditSaving(false);
    }
  }

  if (!authed) {
    return (
      <div className="login-screen">
        {toast && <div className="toast show">{toast}</div>}
        <div className="login-card">
          <Logo variant="login" />
          <p className="login-subtitle">Admin Portal</p>

          <div className="form-group" style={{ marginTop: 24 }}>
            <label className="form-label">Password</label>
            <div className="pw-wrap">
              <input
                className={`form-input ${pwError ? "input-error" : ""}`}
                type={showPw ? "text" : "password"}
                placeholder="Enter admin password"
                value={pwInput}
                onChange={(e) => {
                  setPwInput(e.target.value);
                  setPwError(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
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
            {pwError && <p className="error-msg">Wrong password. Try again.</p>}
          </div>

          <button
            className="add-submit-btn"
            onClick={handleLogin}
            disabled={pwLoading}
          >
            {pwLoading ? "Checking..." : "Unlock Portal →"}
          </button>

          <a className="login-back" href={APP_URL}>
            ← Back to arcade
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      {toast && <div className="toast show">{toast}</div>}

      <header className="admin-topbar">
        <a className="admin-back" href={APP_URL}>
          ← Back
        </a>
        <h1 className="admin-heading">Admin Portal</h1>
        <button className="logout-btn" onClick={handleLogout}>
          Lock 🔒
        </button>
      </header>

      <div className="admin-content">
        <h2 className="admin-section-title">Add New Game</h2>
        <div className="add-game-card">
          <div className="form-group">
            <label className="form-label">Game Name</label>
            <input
              className="form-input"
              placeholder="e.g. Arrow Out"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Thumbnail URL</label>
            <input
              className="form-input"
              placeholder="https://..."
              value={thumbnail}
              onChange={(e) => setThumbnail(e.target.value)}
            />
            {thumbnail && (
              <div className="thumb-preview-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbnail} alt="preview" />
              </div>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">Unity WebGL URL</label>
            <input
              className="form-input"
              placeholder="https://yourgame.com/index.html"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Plays (display label)</label>
            <input
              className="form-input"
              placeholder="e.g. 1.2m"
              value={plays}
              onChange={(e) => setPlays(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Fallback Emoji</label>
            <div className="emoji-grid">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  className={`emoji-btn ${emoji === e ? "selected" : ""}`}
                  onClick={() => setEmoji(e)}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={hasLeaderboard}
              onChange={(e) => setHasLeaderboard(e.target.checked)}
            />
            <span>Leaderboard</span>
            <span className="form-checkbox-hint">
              Checked: score game — stores high score (s) and enables leaderboard.
              Unchecked: level-based — stores current level (l) only, no leaderboard.
            </span>
          </label>
          <button
            className="add-submit-btn"
            onClick={handleAdd}
            disabled={saving}
          >
            {saving ? "Adding..." : "+ Add Game"}
          </button>
        </div>

        <h2 className="admin-section-title">Manage Games ({games.length})</h2>
        {loading ? (
          <p className="admin-loading">Loading...</p>
        ) : (
          <div className="admin-game-list">
            {games.map((g) =>
              editingId === g.id ? (
                <div key={g.id} className="edit-game-card">
                  <div className="edit-game-header">
                    <h3 className="edit-game-title">Edit Game</h3>
                    <button
                      className="edit-cancel-link"
                      type="button"
                      onClick={cancelEdit}
                      disabled={editSaving}
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Game Name</label>
                    <input
                      className="form-input"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Thumbnail URL</label>
                    <input
                      className="form-input"
                      placeholder="https://..."
                      value={editThumbnail}
                      onChange={(e) => setEditThumbnail(e.target.value)}
                    />
                    {editThumbnail && (
                      <div className="thumb-preview-wrap">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={editThumbnail} alt="preview" />
                      </div>
                    )}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Unity WebGL URL</label>
                    <input
                      className="form-input"
                      value={editUrl}
                      onChange={(e) => setEditUrl(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Plays (display label)</label>
                    <input
                      className="form-input"
                      value={editPlays}
                      onChange={(e) => setEditPlays(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Fallback Emoji</label>
                    <div className="emoji-grid">
                      {EMOJIS.map((e) => (
                        <button
                          key={e}
                          type="button"
                          className={`emoji-btn ${editEmoji === e ? "selected" : ""}`}
                          onClick={() => setEditEmoji(e)}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="form-checkbox">
                    <input
                      type="checkbox"
                      checked={editHasLeaderboard}
                      onChange={(e) => setEditHasLeaderboard(e.target.checked)}
                    />
                    <span>Leaderboard</span>
                    <span className="form-checkbox-hint">
                      Checked: score game — stores high score (s) and enables leaderboard.
                      Unchecked: level-based — stores current level (l) only, no leaderboard.
                    </span>
                  </label>
                  <button
                    className="add-submit-btn edit-save-btn"
                    type="button"
                    onClick={handleSaveEdit}
                    disabled={editSaving}
                  >
                    {editSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              ) : (
                <div
                  key={g.id}
                  className={`admin-game-row ${!g.active ? "inactive" : ""}`}
                >
                  <div className="admin-thumb">
                    {g.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.thumbnail} alt={g.name} />
                    ) : (
                      <span>{g.emoji}</span>
                    )}
                  </div>
                  <div className="admin-game-info">
                    <p className="admin-game-name">{g.name}</p>
                    <p className="admin-game-url">{g.url}</p>
                    <p className="admin-game-plays">
                      {g.plays} plays · {g.active ? "🟢 Live" : "⚫ Hidden"} ·{" "}
                      {gameHasLeaderboard(g) ? "🏆 Leaderboard" : "📊 Level-based"}
                    </p>
                  </div>
                  <div className="admin-actions">
                    <button
                      className="edit-btn"
                      type="button"
                      onClick={() => startEdit(g)}
                    >
                      Edit
                    </button>
                    <button
                      className="toggle-btn"
                      type="button"
                      onClick={() => handleToggle(g)}
                    >
                      {g.active ? "Hide" : "Show"}
                    </button>
                    <button
                      className="delete-btn"
                      type="button"
                      onClick={() => handleDelete(g.id)}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
