import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmVisibleStep,
  everyoneReady,
  nextSynchronizedState,
  preparationState,
  syncStep,
} from "../src/round-sync";
import { DEFAULT_SETTINGS, type Room } from "../src/types";

function roomWith(count = 2): Room {
  const room: Room = {
    hostId: "host-uid",
    createdAt: 0,
    expiresAt: 9999999999999,
    settings: DEFAULT_SETTINGS,
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
    players: Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        `p${i}`,
        {
          uid: `p${i}`,
          name: `Phone ${i}`,
          avatar: i,
          team: i % 2,
          slot: i,
          online: true,
          joinedAt: 0,
        },
      ]),
    ),
    roundReady: {},
  };
  room.state = preparationState(room, "c01", 0, "unique-round-token");
  return room;
}
function ack(room: Room, key: string, at: number) {
  room.roundReady![key] = {
    token: room.state.syncToken!,
    step: syncStep(room.state),
    at,
    version: "2026.10.21.04",
  };
}
function all(room: Room, at: number) {
  for (const key of ["host", ...Object.keys(room.players!)]) ack(room, key, at);
}
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("every-phone countdown barrier", () => {
  it("does not shorten a visible number when the server clock offset changes", async () => {
    vi.useFakeTimers();
    const room = roomWith();
    all(room, 0);
    const state = { ...nextSynchronizedState(room, 0, 24)!, countdownAt: 0 };
    let offset = 0;
    const sent = vi.fn(async () => {});
    const frame = (callback: FrameRequestCallback) =>
      setTimeout(() => callback(Date.now()), 16) as unknown as number;
    const stop = confirmVisibleStep(
      state,
      () => Date.now() + offset,
      () => true,
      sent,
      frame,
      (id) => clearTimeout(id),
    );
    await vi.advanceTimersByTimeAsync(200);
    offset = 5000;
    await vi.advanceTimersByTimeAsync(700);
    expect(sent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(sent).toHaveBeenCalledExactlyOnceWith(3);
    stop();
  });
  it.each([2, 3, 4, 6])(
    "waits for every one of %i player screens and the host",
    (count) => {
      const room = roomWith(count);
      for (const key of ["host", ...Object.keys(room.players!).slice(0, -1)])
        ack(room, key, 1000);
      expect(everyoneReady(room)).toBe(false);
      expect(nextSynchronizedState(room, 4000, 24)).toBeNull();
      ack(room, `p${count - 1}`, 4000);
      const next = nextSynchronizedState(room, 4000, 24)!;
      expect(next.phase).toBe("countdown");
      expect(next.countdownDigit).toBe(3);
      expect(next.countdownAt).toBeGreaterThan(4000);
      expect(next.startedAt).toBe(0);
    },
  );

  it("cannot skip 3 or 2 when a slow phone receives round messages late", () => {
    const room = roomWith();
    all(room, 1000);
    room.state = nextSynchronizedState(room, 1000, 24)!;
    const seen: number[] = [];
    for (const digit of [3, 2, 1]) {
      expect(room.state.countdownDigit).toBe(digit);
      seen.push(digit);
      ack(room, "host", 10000 + digit);
      ack(room, "p0", 10000 + digit);
      // Simulate the second phone taking an extra 2.5 seconds to receive/render.
      expect(nextSynchronizedState(room, 12500 + digit, 24)).toBeNull();
      expect(room.state.startedAt).toBe(0);
      ack(room, "p1", 13500 + digit);
      room.state = nextSynchronizedState(room, 13500 + digit, 24)!;
    }
    expect(seen).toEqual([3, 2, 1]);
    expect(room.state.phase).toBe("question");
    expect(room.state.deadline - room.state.startedAt).toBe(24000);
  });

  it("ignores acknowledgements left over from an earlier round or digit", () => {
    const room = roomWith();
    all(room, 1000);
    room.roundReady!.p1.token = "old-round-token";
    expect(everyoneReady(room)).toBe(false);
    ack(room, "p1", 2000);
    room.state = nextSynchronizedState(room, 2000, 24)!;
    expect(everyoneReady(room)).toBe(false);
  });

  it("does not acknowledge a digit until it has been visible for a full second", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const room = roomWith();
    all(room, 0);
    const state = nextSynchronizedState(room, 0, 24)!;
    const sent = vi.fn(async () => {});
    const frame = (callback: FrameRequestCallback) =>
      setTimeout(() => callback(Date.now()), 16) as unknown as number;
    const stop = confirmVisibleStep(
      state,
      Date.now,
      () => true,
      sent,
      frame,
      (id) => clearTimeout(id),
    );
    await vi.advanceTimersByTimeAsync(state.countdownAt! + 900);
    expect(sent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(sent).toHaveBeenCalledExactlyOnceWith(3);
    stop();
  });

  it("restarts the display hold after a phone is hidden, and cancels on leaving", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const room = roomWith();
    all(room, 0);
    const state = { ...nextSynchronizedState(room, 0, 24)!, countdownAt: 0 };
    let visible = true;
    const sent = vi.fn(async () => {});
    const frame = (callback: FrameRequestCallback) =>
      setTimeout(() => callback(Date.now()), 16) as unknown as number;
    const stop = confirmVisibleStep(
      state,
      Date.now,
      () => visible,
      sent,
      frame,
      (id) => clearTimeout(id),
    );
    await vi.advanceTimersByTimeAsync(500);
    visible = false;
    await vi.advanceTimersByTimeAsync(2000);
    visible = true;
    await vi.advanceTimersByTimeAsync(900);
    expect(sent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(sent).toHaveBeenCalledExactlyOnceWith(3);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
