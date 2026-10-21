import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deckFor, questionState } from "../src/engine";
import { DEFAULT_SETTINGS, type Room } from "../src/types";

const firebase = vi.hoisted(() => ({
  listeners: new Map<string, (snapshot: { val: () => unknown }) => void>(),
  goOffline: vi.fn(),
  goOnline: vi.fn(),
  transaction: vi.fn(),
  user: { uid: "host", getIdToken: vi.fn(async () => "test-token") },
}));
vi.mock("firebase/app", () => ({ initializeApp: () => ({}) }));
vi.mock("firebase/auth", () => ({
  getAuth: () => ({
    currentUser: firebase.user,
    authStateReady: async () => {},
  }),
  signInAnonymously: vi.fn(),
}));
vi.mock("firebase/database", () => ({
  getDatabase: () => ({}),
  ref: (_db: unknown, path: string) => path,
  onValue: (
    path: string,
    callback: (snapshot: { val: () => unknown }) => void,
  ) => {
    firebase.listeners.set(path, callback);
    return () => firebase.listeners.delete(path);
  },
  goOffline: firebase.goOffline,
  goOnline: firebase.goOnline,
  runTransaction: firebase.transaction,
  set: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  serverTimestamp: vi.fn(),
  onDisconnect: vi.fn(),
  remove: vi.fn(),
}));
import { watchRoom, revealRound } from "../src/firebase";

class Page extends EventTarget {
  visibilityState = "visible";
}
let page: Page;
let events: EventTarget;
let fetcher: ReturnType<typeof vi.fn>;
const subscriptions: (() => void)[] = [];
const emit = (path: string, value: unknown) =>
  firebase.listeners.get(path)?.({ val: () => value });
const settle = async () => {
  for (let n = 0; n < 12; n++) await Promise.resolve();
};
const roomAt = (round: number) => ({ state: { round } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  firebase.listeners.clear();
  page = new Page();
  events = new EventTarget();
  fetcher = vi.fn(async () => new Response(JSON.stringify(roomAt(0))));
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", events);
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  subscriptions.splice(0).forEach((stop) => stop());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function watch() {
  const next = vi.fn();
  const fail = vi.fn();
  const ready = vi.fn();
  subscriptions.push(watchRoom("ABCDEF", next, fail, ready));
  return { next, fail, ready };
}

describe("phone room synchronization", () => {
  it("does not verify a hidden page or repeatedly retry expired room access", async () => {
    page.visibilityState = "hidden";
    const { ready, fail } = watch();
    emit(".info/connected", true);
    await settle();
    expect(fetcher).not.toHaveBeenCalled();
    expect(ready).toHaveBeenLastCalledWith(false);
    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    fetcher.mockResolvedValueOnce(
      new Response("Permission denied", { status: 403 }),
    );
    emit(".info/connected", true);
    await settle();
    expect(fail).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(ready).toHaveBeenLastCalledWith(false);
  });
  it("keeps answers paused until the connected room has been verified on the network", async () => {
    const { next, ready } = watch();
    emit("rooms/ABCDEF", roomAt(-1));
    emit(".info/connected", true);
    expect(ready).toHaveBeenLastCalledWith(false);
    await settle();
    expect(fetcher.mock.calls[0][0].pathname).toBe("/rooms/ABCDEF.json");
    expect(fetcher.mock.calls[0][1].cache).toBe("no-store");
    expect(next).toHaveBeenLastCalledWith(roomAt(0));
    expect(ready).toHaveBeenLastCalledWith(true);
  });

  it("reconnects and verifies again after a phone is backgrounded or restored", async () => {
    const { ready } = watch();
    emit(".info/connected", true);
    await settle();
    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
    expect(ready).toHaveBeenLastCalledWith(false);
    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    expect(firebase.goOffline).toHaveBeenCalledTimes(1);
    expect(firebase.goOnline).toHaveBeenCalledTimes(1);
    emit(".info/connected", true);
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(ready).toHaveBeenLastCalledWith(true);
    const restored = new Event("pageshow");
    Object.defineProperty(restored, "persisted", { value: true });
    events.dispatchEvent(restored);
    expect(ready).toHaveBeenLastCalledWith(false);
    expect(firebase.goOnline).toHaveBeenCalledTimes(2);
  });

  it("does not overwrite a newer live round with an older in-flight response", async () => {
    let resolve!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const { next } = watch();
    emit(".info/connected", true);
    await settle();
    emit("rooms/ABCDEF", roomAt(2));
    resolve(new Response(JSON.stringify(roomAt(1))));
    await settle();
    expect(next).toHaveBeenLastCalledWith(roomAt(2));
  });

  it("discards a response arriving after disconnection and retries temporary failures", async () => {
    let resolve!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const { ready, next, fail } = watch();
    emit(".info/connected", true);
    await settle();
    emit(".info/connected", false);
    resolve(new Response(JSON.stringify(roomAt(1))));
    await settle();
    expect(next).not.toHaveBeenCalled();
    expect(ready).toHaveBeenLastCalledWith(false);
    fetcher.mockRejectedValueOnce(new Error("offline"));
    emit(".info/connected", true);
    await settle();
    expect(ready).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(ready).toHaveBeenLastCalledWith(true);
    expect(fail).not.toHaveBeenCalled();
  });

  it("stops listeners and retries after leaving a room", async () => {
    fetcher.mockRejectedValue(new Error("offline"));
    const { ready } = watch();
    emit(".info/connected", true);
    await settle();
    subscriptions.pop()!();
    const calls = ready.mock.calls.length;
    events.dispatchEvent(new Event("online"));
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ready).toHaveBeenCalledTimes(calls);
    expect(firebase.listeners.size).toBe(0);
  });

  it("scores the server's accepted answers even if the host listener is late", async () => {
    const settings = { ...DEFAULT_SETTINGS, mode: "clue" as const };
    const question = deckFor(settings, "test")[0];
    const state = questionState(0, question, settings, Date.now() - 5000, {});
    const room: Room = {
      hostId: "host",
      createdAt: 0,
      expiresAt: 9999999999999,
      deckSeed: "test",
      settings,
      state,
      players: {
        player: {
          uid: "player",
          name: "Test",
          avatar: 0,
          slot: 0,
          team: 0,
          joinedAt: 0,
          online: true,
        },
      },
    };
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          player: { value: question.answer, at: state.startedAt + 1000 },
        }),
      ),
    );
    await revealRound("ABCDEF", room);
    const callback = firebase.transaction.mock.calls[0][1];
    const revealed = callback(state);
    expect(revealed.phase).toBe("reveal");
    expect(revealed.outcomes.player.points).toBeGreaterThan(0);
    expect(callback({ ...state, round: 1 })).toBeUndefined();
    expect(callback({ ...state, phase: "reveal" })).toBeUndefined();
  });
});
