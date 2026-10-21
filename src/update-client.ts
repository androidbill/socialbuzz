import { withRequestTimeout } from "./network";

export interface PublishedRelease {
  version: string;
  commit?: string;
}
const validVersion = /^\d{4}\.\d{2}\.\d{2}\.\d{2,}$/;
export function isNewerVersion(candidate: string, current: string): boolean {
  if (!validVersion.test(candidate) || !validVersion.test(current))
    return false;
  const a = candidate.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export async function fetchRelease(
  base: string,
  fetcher: typeof fetch = fetch,
): Promise<PublishedRelease> {
  const url = new URL("version.json", base);
  url.searchParams.set("check", Date.now().toString());
  const release = await withRequestTimeout(async (signal) => {
    const response = await fetcher(url, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
      signal,
    });
    if (!response.ok) throw new Error("Could not check for updates.");
    return response.json();
  }, 10000);
  if (
    !release ||
    typeof release.version !== "string" ||
    !validVersion.test(release.version)
  )
    throw new Error("Invalid release response.");
  return release;
}
export function requestWorkerActivation(
  registration: ServiceWorkerRegistration,
  container: ServiceWorkerContainer,
  targetVersion: string,
  timeoutMs = 20000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let sent: ServiceWorker | null = null;
    const tracked = new Set<ServiceWorker>();
    const cleanup = () => {
      clearTimeout(timeout);
      container.removeEventListener("controllerchange", changed);
      container.removeEventListener("message", activeVersion);
      registration.removeEventListener("updatefound", inspect);
      tracked.forEach((worker) =>
        worker.removeEventListener("statechange", inspect),
      );
    };
    const changed = () => {
      cleanup();
      resolve();
    };
    const activeVersion = (event: Event) => {
      const message = event as MessageEvent;
      if (
        message.source === registration.active &&
        message.data?.type === "SOCIALBUZZ_VERSION" &&
        (message.data.version === targetVersion ||
          isNewerVersion(message.data.version, targetVersion))
      )
        changed();
    };
    const inspect = () => {
      if (registration.installing && !tracked.has(registration.installing)) {
        tracked.add(registration.installing);
        registration.installing.addEventListener("statechange", inspect);
      }
      const waiting = registration.waiting;
      if (waiting && waiting !== sent) {
        sent = waiting;
        waiting.postMessage({ type: "SOCIALBUZZ_ACTIVATE_UPDATE" });
      }
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          "The update is still downloading. Please try Refresh again in a moment.",
        ),
      );
    }, timeoutMs);
    container.addEventListener("controllerchange", changed);
    container.addEventListener("message", activeVersion);
    registration.addEventListener("updatefound", inspect);
    inspect();
    registration.active?.postMessage({ type: "SOCIALBUZZ_GET_VERSION" });
    if (!registration.waiting)
      registration
        .update()
        .then(inspect)
        .catch((error) => {
          cleanup();
          reject(error);
        });
  });
}
export function refreshUrl(currentUrl: string, version: string): string {
  const url = new URL(currentUrl);
  url.searchParams.set("v", version);
  return url.href;
}
