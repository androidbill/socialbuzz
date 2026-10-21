import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRelease, isNewerVersion } from "../src/update-client";
import { scheduleUpdateChecks } from "../src/update-polling";

describe("update checks during a game", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("detects a release published mid-round without navigation or another round", async () => {
    let published = "2026.10.21.01";
    let offered: string | null = null;
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ version: published })),
    );
    const check = vi.fn(async () => {
      const release = await fetchRelease("https://example.com/", fetcher as typeof fetch);
      if (isNewerVersion(release.version, "2026.10.21.01"))
        offered = release.version;
    });
    const stop = scheduleUpdateChecks(check, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(offered).toBeNull();
    published = "2026.10.21.02";
    await vi.advanceTimersByTimeAsync(29_999);
    expect(offered).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(offered).toBe("2026.10.21.02");
    expect(check).toHaveBeenCalledTimes(2);
    stop();
  });

  it("checks as soon as a round changes, and replaces the previous timer", async () => {
    const check = vi.fn();
    const stopQuestion = scheduleUpdateChecks(check, true);
    await vi.advanceTimersByTimeAsync(12_000);
    stopQuestion();
    const stopResults = scheduleUpdateChecks(check, true);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(18_000);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(check).toHaveBeenCalledTimes(3);
    stopResults();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("uses the slower schedule after leaving the game", async () => {
    const check = vi.fn();
    const stopGame = scheduleUpdateChecks(check, true);
    stopGame();
    const stopHome = scheduleUpdateChecks(check, false);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(299_999);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(3);
    stopHome();
  });
});
