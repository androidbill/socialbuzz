import { afterEach, describe, expect, it, vi } from "vitest";
import { observeGameClock } from "../src/game-clock";

class Page extends EventTarget {
  visibilityState = "visible";
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("shared round clock", () => {
  it("catches up after a suspended page rather than continuing its old countdown", async () => {
    vi.useFakeTimers();
    const page = new Page();
    const events = new EventTarget();
    let serverTime = 100_000;
    const tick = vi.fn();
    const stop = observeGameClock(
      tick,
      () => serverTime,
      page as Document,
      events as Window,
    );
    expect(tick).toHaveBeenLastCalledWith(100_000);
    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
    const calls = tick.mock.calls.length;
    serverTime += 60_000;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(calls);
    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    expect(tick).toHaveBeenLastCalledWith(160_000);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses corrected server time on each tick and restores from the page cache", async () => {
    vi.useFakeTimers();
    const page = new Page();
    const events = new EventTarget();
    let serverTime = 500;
    const tick = vi.fn();
    const stop = observeGameClock(
      tick,
      () => serverTime,
      page as Document,
      events as Window,
    );
    serverTime = 18_000;
    await vi.advanceTimersByTimeAsync(100);
    expect(tick).toHaveBeenLastCalledWith(18_000);
    serverTime = 24_000;
    events.dispatchEvent(new Event("pageshow"));
    expect(tick).toHaveBeenLastCalledWith(24_000);
    events.dispatchEvent(new Event("focus"));
    expect(vi.getTimerCount()).toBe(1);
    stop();
  });
});
