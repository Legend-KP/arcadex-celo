"use client";

import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import {
  getFirestore,
  Firestore,
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  DocumentData,
} from "firebase/firestore";
import { sortGames } from "@/lib/game-sort";
import { Game } from "@/types";
import {
  assertFirebaseConfig,
  getFirebasePublicConfig,
} from "@/lib/firebase-config";

export {
  getLeaderboard,
  getLeaderboardStatus,
  getUserBestScore,
  savePersonalBest,
  submitPaidScore,
} from "@/lib/leaderboard-client";

let app: FirebaseApp;
let db: Firestore;

function getFirebase() {
  const config = getFirebasePublicConfig();
  assertFirebaseConfig(config);

  if (!app) {
    app = getApps().length ? getApps()[0] : initializeApp(config);
    db = getFirestore(app);
  }
  return { app, db };
}

// ─── Games (Firestore) ───────────────────────────────────────────────────────

export async function getGames(): Promise<Game[]> {
  const { db } = getFirebase();
  const mapDocs = (docs: { id: string; data: () => DocumentData }[]) =>
    docs.map((d) => ({ id: d.id, ...d.data() } as Game));

  try {
    const snap = await getDocs(
      query(collection(db, "games"), orderBy("sortOrder", "asc"))
    );
    return sortGames(mapDocs(snap.docs));
  } catch {
    try {
      const snap = await getDocs(
        query(collection(db, "games"), orderBy("createdAt", "desc"))
      );
      return sortGames(mapDocs(snap.docs));
    } catch {
      const snap = await getDocs(collection(db, "games"));
      return sortGames(mapDocs(snap.docs));
    }
  }
}

export function isGameVisible(game: Game): boolean {
  return game.active !== false;
}

export async function getGame(id: string): Promise<Game | null> {
  const { db } = getFirebase();
  const snap = await getDoc(doc(db, "games", id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Game;
}

export async function addGame(
  data: Omit<Game, "id" | "createdAt">
): Promise<string> {
  const { db } = getFirebase();
  const ref = await addDoc(collection(db, "games"), {
    ...data,
    createdAt: Date.now(),
  });
  return ref.id;
}

export async function updateGame(
  id: string,
  data: Partial<Omit<Game, "id">>
): Promise<void> {
  const { db } = getFirebase();
  await updateDoc(doc(db, "games", id), data as DocumentData);
}

export async function deleteGame(id: string): Promise<void> {
  const { db } = getFirebase();
  await deleteDoc(doc(db, "games", id));
}
