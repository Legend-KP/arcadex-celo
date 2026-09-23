"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createAdminMission,
  deleteAdminMission,
  fetchAdminMissions,
  updateAdminMission,
} from "@/lib/admin-api";
import type { Game, Mission, MissionType } from "@/types";

interface AdminMissionsPanelProps {
  games: Game[];
  showToast: (msg: string) => void;
}

export default function AdminMissionsPanel({
  games,
  showToast,
}: AdminMissionsPanelProps) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [gameId, setGameId] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<MissionType>("score");
  const [threshold, setThreshold] = useState("1000");
  const [mode, setMode] = useState("");
  const [xpReward, setXpReward] = useState("50");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchAdminMissions();
      setMissions(list);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Could not load missions."
      );
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!gameId && games[0]?.id) setGameId(games[0].id);
  }, [games, gameId]);

  async function handleCreate() {
    setSaving(true);
    try {
      await createAdminMission({
        gameId,
        title,
        type,
        threshold: Number(threshold),
        mode: mode.trim() || null,
        xpReward: Number(xpReward),
        active: true,
      });
      setTitle("");
      showToast("Mission created.");
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to create.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(mission: Mission) {
    try {
      await updateAdminMission(mission.id, { active: !mission.active });
      showToast(mission.active ? "Mission deactivated." : "Mission activated.");
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Update failed.");
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this mission and its claims?")) return;
    try {
      await deleteAdminMission(id);
      showToast("Mission deleted.");
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  const gameName = (id: string) =>
    games.find((g) => g.id === id)?.name ?? id;

  return (
    <div className="admin-missions">
      <h2 className="admin-section-title">Achievements / Missions</h2>
      <p className="admin-contest-muted" style={{ marginBottom: 12 }}>
        Players claim XP manually after meeting the threshold. Stored in D1 —
        no KV / Firestore.
      </p>

      <div className="add-game-card">
        <div className="form-group">
          <label className="form-label">Game</label>
          <select
            className="form-input"
            value={gameId}
            onChange={(e) => setGameId(e.target.value)}
          >
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Title</label>
          <input
            className="form-input"
            placeholder="Score 1000 in Base Drop"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Type</label>
          <select
            className="form-input"
            value={type}
            onChange={(e) => setType(e.target.value as MissionType)}
          >
            <option value="score">Score</option>
            <option value="level">Level</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Threshold</label>
          <input
            className="form-input"
            type="number"
            min={1}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Mode (optional, e.g. easy)</label>
          <input
            className="form-input"
            placeholder="leave blank for overall level"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">XP reward</label>
          <input
            className="form-input"
            type="number"
            min={1}
            value={xpReward}
            onChange={(e) => setXpReward(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="add-submit-btn"
          disabled={saving || !gameId || !title.trim()}
          onClick={() => void handleCreate()}
        >
          {saving ? "Saving…" : "Add mission"}
        </button>
      </div>

      <h3 className="admin-section-title" style={{ marginTop: 24 }}>
        Missions ({missions.length})
      </h3>
      {loading ? (
        <p className="admin-contest-muted">Loading…</p>
      ) : missions.length === 0 ? (
        <p className="admin-contest-muted">No missions yet.</p>
      ) : (
        <div className="admin-missions-list">
          {missions.map((m) => (
            <div key={m.id} className="edit-game-card">
              <p style={{ margin: 0, fontWeight: 800 }}>{m.title}</p>
              <p className="admin-contest-muted" style={{ margin: "4px 0 8px" }}>
                {gameName(m.gameId)} · {m.type}
                {m.mode ? `/${m.mode}` : ""} ≥ {m.threshold} · +{m.xpReward} XP
                · {m.active ? "active" : "inactive"}
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="toggle-btn"
                  onClick={() => void toggleActive(m)}
                >
                  {m.active ? "Deactivate" : "Activate"}
                </button>
                <button
                  type="button"
                  className="delete-btn"
                  onClick={() => void handleDelete(m.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
