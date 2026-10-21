import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRelease } from "../src/update-client";
import { withRequestTimeout } from "../src/network";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("mobile-compatible network timeouts", () => {
  it("can check releases when Safari has no AbortSignal.timeout", async () => {
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      throw new Error("unsupported on this browser");
    });
    const result = await fetchRelease(
      "https://example.com/",
      vi.fn(
        async () => new Response(JSON.stringify({ version: "2026.10.21.03" })),
      ),
    );
    expect(result.version).toBe("2026.10.21.03");
  });

  it("aborts a hung request and releases its timer after success", async () => {
    vi.useFakeTimers();
    const request = withRequestTimeout(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      1000,
    );
    const rejected = expect(request).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    expect(await withRequestTimeout(async () => "done", 1000)).toBe("done");
    expect(vi.getTimerCount()).toBe(0);
  });
});
