import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  onValue,
  runTransaction,
  serverTimestamp,
  onDisconnect,
  remove,
} from "firebase/database";
import { firebaseConfig } from "./firebase-config";
import type { Answer, GameState, Player, Room, Settings } from "./types";
import { deckFor, questionState, scoreRound } from "./engine";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
let authPromise: Promise<string> | null = null;
let offset = 0;
onValue(ref(db, ".info/serverTimeOffset"), (snap) => {
  offset = snap.val() || 0;
});
export const now = () => Date.now() + offset;
export function identity(): Promise<string> {
  if (!authPromise)
    authPromise = auth
      .authStateReady()
      .then(
        async () =>
          auth.currentUser?.uid || (await signInAnonymously(auth)).user.uid,
      )
      .catch((error) => {
        authPromise = null;
        throw error;
      });
  return authPromise;
}
export async function createRoom(settings: Settings): Promise<string> {
  const uid = await identity();
  const count =
    settings.mode === "mix"
      ? settings.rounds
      : Math.min(
          settings.rounds,
          deckFor({ ...settings, rounds: 100 }, "count").filter(
            (q, i, list) => list.findIndex((x) => x.id === q.id) === i,
          ).length,
        );
  settings = { ...settings, rounds: count };
  for (let attempt = 0; attempt < 5; attempt++) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    const code = [...bytes].map((n) => chars[n % chars.length]).join("");
    const room: Room = {
      hostId: uid,
      createdAt: now(),
      expiresAt: now() + 6 * 3600000,
      deckSeed: crypto.randomUUID(),
      settings,
      state: {
        phase: "lobby",
        round: -1,
        questionId: "",
        startedAt: 0,
        deadline: 0,
        totals: {},
        outcomes: {},
        revealText: "",
      },
    };
    try {
      await set(ref(db, `rooms/${code}`), room);
      return code;
    } catch (error) {
      if (attempt === 4) throw error;
    }
  }
  throw new Error("Could not make a room. Please try again.");
}
export async function joinRoom(
  code: string,
  name: string,
  avatar: number,
  team: number,
): Promise<string> {
  const uid = await identity();
  let slot = -1;
  try {
    const seats = (await get(ref(db, `rooms/${code}/seats`))).val() || {};
    const existing = Object.entries(seats).find(([, value]) => value === uid);
    if (existing) slot = Number(existing[0]);
    else
      for (let i = 0; i < 6; i++) {
        if (seats[i]) continue;
        try {
          const result = await runTransaction(
            ref(db, `rooms/${code}/seats/${i}`),
            (value) => (value === null ? uid : undefined),
          );
          if (result.committed) {
            slot = i;
            break;
          }
        } catch {
          /* Try the next available seat within the room's capacity. */
        }
      }
    if (slot < 0) throw new Error("Full");
    const player: Player = {
      uid,
      name: name.trim().slice(0, 18),
      avatar,
      team,
      slot,
      joinedAt: now(),
      online: true,
    };
    await set(ref(db, `rooms/${code}/players/${uid}`), player);
  } catch {
    throw new Error(
      "That room is unavailable, full, or already playing. Check the code with your host.",
    );
  }
  return uid;
}
export function watchRoom(
  code: string,
  next: (room: Room | null) => void,
  fail: (error: Error) => void,
): () => void {
  return onValue(ref(db, `rooms/${code}`), (snap) => next(snap.val()), fail);
}
export function watchAnswers(
  code: string,
  round: number,
  uid: string,
  host: boolean,
  next: (answers: Record<string, Answer>) => void,
): () => void {
  return onValue(
    ref(db, `answers/${code}/${round}${host ? "" : "/" + uid}`),
    (snap) =>
      next(
        host ? snap.val() || {} : snap.exists() ? { [uid]: snap.val() } : {},
      ),
  );
}
export function presence(code: string, uid: string): () => void {
  return onValue(ref(db, ".info/connected"), async (snap) => {
    if (snap.val()) {
      const target = ref(db, `rooms/${code}/players/${uid}/online`);
      try {
        await onDisconnect(target).set(false);
        await set(target, true);
      } catch {
        /* A removed player cannot restore membership through presence. */
      }
    }
  });
}
export async function submitAnswer(
  code: string,
  round: number,
  value: number | string,
  prediction?: number,
): Promise<void> {
  const uid = await identity();
  const answer = {
    value,
    at: serverTimestamp(),
    ...(prediction !== undefined ? { prediction } : {}),
  };
  await set(ref(db, `answers/${code}/${round}/${uid}`), answer);
}
export async function nextRound(code: string, room: Room): Promise<void> {
  const round = room.state.round + 1;
  if (round >= room.settings.rounds) {
    await update(ref(db, `rooms/${code}/state`), { phase: "finished" });
    return;
  }
  const question = deckFor(room.settings, room.deckSeed || code)[round];
  await set(
    ref(db, `rooms/${code}/state`),
    questionState(
      round,
      question,
      room.settings,
      now(),
      room.state.totals || {},
    ),
  );
}
export async function revealRound(code: string, room: Room): Promise<void> {
  const question = deckFor(room.settings, room.deckSeed || code)[
    room.state.round
  ];
  const scored = scoreRound(
    question,
    room.state,
    Object.values(room.players || {}),
    room.submissions?.[room.state.round] || {},
  );
  // Compare the phase and round so reconnecting or double-clicking cannot score twice.
  await runTransaction(
    ref(db, `rooms/${code}/state`),
    (state: GameState | null) => {
      if (
        !state ||
        state.phase !== "question" ||
        state.round !== room.state.round
      )
        return;
      return { ...state, ...scored, phase: "reveal" };
    },
  );
}
export async function rematch(code: string): Promise<void> {
  await remove(ref(db, `answers/${code}`));
  await update(ref(db, `rooms/${code}`), {
    deckSeed: crypto.randomUUID(),
    state: {
      phase: "lobby",
      round: -1,
      questionId: "",
      startedAt: 0,
      deadline: 0,
      totals: {},
      outcomes: {},
      revealText: "",
    },
    submissions: null,
  });
}
export const closeRoom = (code: string) =>
  update(ref(db, `rooms/${code}/state`), { phase: "closed" });
export const leaveRoom = async (code: string) => {
  const uid = await identity();
  const seats = (await get(ref(db, `rooms/${code}/seats`))).val() || {};
  await remove(ref(db, `rooms/${code}/players/${uid}`));
  for (const [slot, owner] of Object.entries(seats))
    if (owner === uid) await remove(ref(db, `rooms/${code}/seats/${slot}`));
};
export const removePlayer = async (code: string, uid: string) => {
  const player = (
    await get(ref(db, `rooms/${code}/players/${uid}`))
  ).val() as Player | null;
  await remove(ref(db, `rooms/${code}/players/${uid}`));
  if (player) await remove(ref(db, `rooms/${code}/seats/${player.slot}`));
};
export const changeTeam = (code: string, uid: string, team: number) =>
  update(ref(db, `rooms/${code}/players/${uid}`), { team });
export function friendlyError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/network|unavailable|offline/i.test(text))
    return "Connection interrupted. Check your internet and try again.";
  if (/permission_denied/i.test(text))
    return "This room is no longer available. Ask the host for a fresh code.";
  return (
    text.replace(/^Firebase: /, "").replace(/ \(auth\/.*\)\.?$/, "") ||
    "Something went wrong. Please try again."
  );
}
