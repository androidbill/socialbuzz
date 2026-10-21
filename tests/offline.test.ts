import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function worker() {
  const origin = "https://androidbill.github.io/socialbuzz/";
  const entries = new Map<
    string,
    Map<string, { url: string; ok: boolean; clone: () => unknown }>
  >();
  entries.set("another-app-v1", new Map());
  entries.set("socialbuzz-old", new Map());
  const handlers: Record<string, (event: unknown) => void> = {};
  let offline = false;
  const response = (url: string) => ({
    url,
    ok: true,
    clone() {
      return this;
    },
  });
  const caches = {
    open: async (name: string) => {
      if (!entries.has(name)) entries.set(name, new Map());
      const cache = entries.get(name)!;
      return {
        addAll: async (paths: string[]) =>
          paths.forEach((path) =>
            cache.set(
              new URL(path, origin).href,
              response(new URL(path, origin).href),
            ),
          ),
        put: async (path: string, value: ReturnType<typeof response>) =>
          cache.set(new URL(path, origin).href, value),
      };
    },
    keys: async () => [...entries.keys()],
    delete: async (key: string) => entries.delete(key),
    match: async (request: string | { url: string }) => {
      const url =
        typeof request === "string"
          ? new URL(request, origin).href
          : request.url;
      for (const cache of entries.values())
        if (cache.has(url)) return cache.get(url);
    },
  };
  runInNewContext(
    readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"),
    {
      URL,
      caches,
      self: {
        location: new URL(origin + "sw.js"),
        addEventListener: (
          name: string,
          callback: (event: unknown) => void,
        ) => {
          handlers[name] = callback;
        },
        skipWaiting: () => {},
        clients: { claim: async () => {} },
      },
      fetch: async (request: { url: string }) => {
        if (offline) throw new Error("offline");
        return response(request.url);
      },
    },
  );
  return {
    entries,
    handlers,
    goOffline: () => {
      offline = true;
    },
    origin,
  };
}

describe("offline party app", () => {
  it("installs a cached home screen and serves it when navigation is offline", async () => {
    const w = worker();
    let installed: Promise<unknown> = Promise.resolve();
    w.handlers.install({
      waitUntil: (promise: Promise<unknown>) => {
        installed = promise;
      },
    });
    await installed;
    w.goOffline();
    let served: Promise<{ url: string }> | undefined;
    w.handlers.fetch({
      request: {
        url: w.origin + "?room=ABCDEF",
        method: "GET",
        mode: "navigate",
      },
      respondWith: (promise: Promise<{ url: string }>) => {
        served = promise;
      },
    });
    expect((await served)?.url).toBe(w.origin);
  });
  it("cleans old SocialBuzz caches while preserving other apps on GitHub Pages", async () => {
    const w = worker();
    let completed: Promise<unknown> = Promise.resolve();
    w.handlers.activate({
      waitUntil: (promise: Promise<unknown>) => {
        completed = promise;
      },
    });
    await completed;
    expect(w.entries.has("socialbuzz-old")).toBe(false);
    expect(w.entries.has("another-app-v1")).toBe(true);
  });
  it("leaves cross-origin Firebase requests alone", () => {
    const w = worker();
    let intercepted = false;
    w.handlers.fetch({
      request: {
        url: "https://socialbuzz-party-2026-default-rtdb.firebaseio.com/rooms.json",
        method: "GET",
      },
      respondWith: () => {
        intercepted = true;
      },
    });
    expect(intercepted).toBe(false);
  });
});
