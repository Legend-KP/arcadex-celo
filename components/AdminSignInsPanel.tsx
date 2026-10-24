"use client";

import { useEffect, useState } from "react";

type WalletSignIn = {
  id: number;
  wallet: string;
  nonce: string;
  issuedAt: string;
  signedAt: number;
  signature: string;
};

function short(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export default function AdminSignInsPanel() {
  const [rows, setRows] = useState<WalletSignIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/admin/sign-ins", {
          credentials: "include",
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as {
          signIns?: WalletSignIn[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error ?? "Could not load sign-ins.");
        }
        if (!cancelled) setRows(data.signIns ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load sign-ins.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="admin-signins">
      <h2 className="admin-section-title">Wallet sign-ins</h2>
      <p className="admin-signins__hint">
        MiniPay “Sign in to ArcadeX” signatures. These are not USDT claim transactions.
      </p>
      {loading ? <p className="admin-signins__hint">Loading…</p> : null}
      {error ? <p className="error-msg">{error}</p> : null}
      {!loading && !error && rows.length === 0 ? (
        <p className="admin-signins__hint">No sign-ins saved yet.</p>
      ) : null}
      {rows.length > 0 ? (
        <div className="admin-signins__table-wrap">
          <table className="admin-signins__table">
            <thead>
              <tr>
                <th>When</th>
                <th>Wallet</th>
                <th>Nonce</th>
                <th>Signature</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.signedAt).toLocaleString()}</td>
                  <td title={row.wallet}>{short(row.wallet, 6, 4)}</td>
                  <td title={row.nonce}>{short(row.nonce, 8, 4)}</td>
                  <td title={row.signature}>{short(row.signature, 10, 6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
