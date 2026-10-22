import type { GameState, Room } from "./types";

export const DISPLAY_HOLD_MS = 1000;
export const syncStep = (state: GameState) =>
  state.phase === "preparing" ? 0 : state.countdownDigit || 0;
export const participantKeys = (room: Room) => [
  "host",
  ...Object.keys(room.players || {}),
];
export function readyForStep(room: Room, key: string): boolean {
  const acknowledgement = room.roundReady?.[key];
  return (
    !!acknowledgement &&
    acknowledgement.token === room.state.syncToken &&
    acknowledgement.step === syncStep(room.state)
  );
}
export function everyoneReady(room: Room): boolean {
  return (
    Object.keys(room.players || {}).length >= 2 &&
    participantKeys(room).every((key) => readyForStep(room, key))
  );
}
export function preparationState(
  room: Room,
  questionId: string,
  round: number,
  token: string,
): GameState {
  return {
    phase: "preparing",
    questionId,
    round,
    syncToken: token,
    startedAt: 0,
    deadline: 0,
    totals: room.state.totals || {},
    outcomes: {},
    revealText: "",
  };
}
export function nextSynchronizedState(
  room: Room,
  now: number,
  durationSeconds: number,
): GameState | null {
  if (
    !["preparing", "countdown"].includes(room.state.phase) ||
    !everyoneReady(room)
  )
    return null;
  const acks = participantKeys(room).map((key) => room.roundReady![key]);
  const spread =
    Math.max(...acks.map((a) => a.at)) - Math.min(...acks.map((a) => a.at));
  // Leave delivery time before the shared transition; slow connections get more lead.
  const lead = Math.min(
    10000,
    Math.max(room.state.phase === "preparing" ? 1000 : 250, spread * 2 + 250),
  );
  if (room.state.phase === "preparing" || room.state.countdownDigit! > 1)
    return {
      ...room.state,
      phase: "countdown",
      countdownDigit:
        room.state.phase === "preparing" ? 3 : room.state.countdownDigit! - 1,
      countdownAt: now + lead,
    };
  const startedAt = now + Math.max(1500, lead);
  return {
    ...room.state,
    phase: "question",
    startedAt,
    deadline: startedAt + durationSeconds * 1000,
  };
}

// The acknowledgement is sent only after this particular number was visible
// for a full second. A paused or late phone cannot acknowledge skipped digits.
export function confirmVisibleStep(
  state: GameState,
  now: () => number,
  visible: () => boolean,
  acknowledge: (step: number) => Promise<void>,
  frame: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancelFrame: (id: number) => void = cancelAnimationFrame,
  monotonic: () => number = () => performance.now(),
) {
  let stopped = false;
  let frameId = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let displayedAt: number | null = null;
  const attempt = () => {
    if (stopped) return;
    if (!visible() || now() < (state.countdownAt || 0)) {
      displayedAt = null;
      frameId = frame(attempt);
      return;
    }
    if (displayedAt === null) {
      displayedAt = monotonic();
      frameId = frame(attempt);
      return;
    }
    const held = monotonic() - displayedAt;
    if (state.phase === "countdown" && held < DISPLAY_HOLD_MS) {
      frameId = frame(attempt);
      return;
    }
    void acknowledge(syncStep(state)).catch(() => {
      if (!stopped) timer = setTimeout(attempt, 1000);
    });
  };
  frameId = frame(attempt);
  return () => {
    stopped = true;
    cancelFrame(frameId);
    clearTimeout(timer);
  };
}
