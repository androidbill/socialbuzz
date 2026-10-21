import { describe, expect, it, vi } from "vitest";
import {
  fetchRelease,
  isNewerVersion,
  refreshUrl,
  requestWorkerActivation,
} from "../src/update-client";
class Worker extends EventTarget {
  state = "installed";
  postMessage = vi.fn();
}
class Registration extends EventTarget {
  waiting: Worker | null = new Worker();
  installing: Worker | null = null;
  active: Worker | null = new Worker();
  update = vi.fn(async () => {});
}
function activation(reg: Registration, container: EventTarget, timeout = 1000) {
  return requestWorkerActivation(
    reg as unknown as ServiceWorkerRegistration,
    container as unknown as ServiceWorkerContainer,
    "2026.10.21.02",
    timeout,
  );
}
describe("app update handoff", () => {
  it("prompts only for newer valid releases, including new dates and counters above 99", () => {
    expect(isNewerVersion("2026.10.21.02", "2026.10.21.01")).toBe(true);
    expect(isNewerVersion("2026.10.22.01", "2026.10.21.99")).toBe(true);
    expect(isNewerVersion("2026.10.21.100", "2026.10.21.99")).toBe(true);
    expect(isNewerVersion("2026.10.21.01", "2026.10.21.01")).toBe(false);
    expect(isNewerVersion("2026.10.21.01", "2026.10.21.02")).toBe(false);
    expect(isNewerVersion("garbage", "2026.10.21.01")).toBe(false);
  });
  it("checks the network using an uncached, cache-busted version manifest", async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ version: "2026.10.21.02" })),
    );
    const release = await fetchRelease(
      "https://androidbill.github.io/socialbuzz/",
      fetcher as typeof fetch,
    );
    expect(release.version).toBe("2026.10.21.02");
    expect(fetcher.mock.calls[0][0].href).toContain(
      "/socialbuzz/version.json?check=",
    );
    expect(fetcher.mock.calls[0][1].cache).toBe("no-store");
  });
  it("treats network errors or an HTML fallback as failed checks rather than updates", async () => {
    await expect(
      fetchRelease(
        "https://example.com/",
        vi.fn(
          async () => new Response("offline", { status: 503 }),
        ) as typeof fetch,
      ),
    ).rejects.toThrow();
    await expect(
      fetchRelease(
        "https://example.com/",
        vi.fn(
          async () => new Response(JSON.stringify({ version: "oops" })),
        ) as typeof fetch,
      ),
    ).rejects.toThrow();
  });
  it("activates a waiting worker only when refresh is requested, then waits for control", async () => {
    const reg = new Registration();
    const container = new EventTarget();
    expect(reg.waiting!.postMessage).not.toHaveBeenCalled();
    const refreshed = activation(reg, container);
    expect(reg.waiting!.postMessage).toHaveBeenCalledWith({
      type: "SOCIALBUZZ_ACTIVATE_UPDATE",
    });
    container.dispatchEvent(new Event("controllerchange"));
    await refreshed;
  });
  it("waits for a downloading worker to become ready before activating it", async () => {
    const reg = new Registration();
    const container = new EventTarget();
    reg.installing = new Worker();
    reg.waiting = null;
    const refreshed = activation(reg, container);
    expect(reg.update).toHaveBeenCalled();
    const worker = reg.installing;
    reg.waiting = worker;
    worker.dispatchEvent(new Event("statechange"));
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "SOCIALBUZZ_ACTIVATE_UPDATE",
    });
    container.dispatchEvent(new Event("controllerchange"));
    await refreshed;
  });
  it("can refresh when another tab has already activated the latest worker", async () => {
    const reg = new Registration();
    const container = new EventTarget();
    reg.waiting = null;
    const refreshed = activation(reg, container);
    const message = new Event("message");
    Object.defineProperties(message, {
      source: { value: reg.active },
      data: { value: { type: "SOCIALBUZZ_VERSION", version: "2026.10.21.02" } },
    });
    container.dispatchEvent(message);
    await refreshed;
  });
  it("reports an incomplete download instead of reloading the old app", async () => {
    const reg = new Registration();
    reg.waiting = null;
    await expect(activation(reg, new EventTarget(), 10)).rejects.toThrow(
      "still downloading",
    );
  });
  it("preserves the room, host role, and URL fragment when refreshing", () => {
    expect(
      refreshUrl(
        "https://androidbill.github.io/socialbuzz/?host=ABCDEF#games",
        "2026.10.21.02",
      ),
    ).toBe(
      "https://androidbill.github.io/socialbuzz/?host=ABCDEF&v=2026.10.21.02#games",
    );
  });
});
