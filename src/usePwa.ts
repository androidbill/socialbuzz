import { useEffect, useRef, useState } from "react";
import release from "../release.json";
import { scheduleUpdateChecks } from "./update-polling";
import {
  fetchRelease,
  isNewerVersion,
  refreshUrl,
  requestWorkerActivation,
  type PublishedRelease,
} from "./update-client";
export const APP_VERSION = release.version;
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  !!(navigator as Navigator & { standalone?: boolean }).standalone;

export function usePwa(gameRound: string | null = null) {
  const [installed, setInstalled] = useState(standalone);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(
    null,
  );
  const [latest, setLatest] = useState<PublishedRelease | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const checkUpdates = useRef<() => void>(() => {});
  const base = new URL("./", window.location.href).href;

  useEffect(() => {
    let disposed = false;
    let checking = false;
    const mode = window.matchMedia("(display-mode: standalone)");
    const onMode = () => setInstalled(standalone());
    const offer = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    const added = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    const consider = (candidate: PublishedRelease) => {
      if (!disposed && isNewerVersion(candidate.version, APP_VERSION))
        setLatest((previous) =>
          !previous || isNewerVersion(candidate.version, previous.version)
            ? candidate
            : previous,
        );
    };
    const workerMessage = (event: MessageEvent) => {
      if (
        event.data?.type === "SOCIALBUZZ_VERSION" &&
        typeof event.data.version === "string"
      )
        consider(event.data);
    };
    const inspectWorker = () => {
      const waiting = registration.current?.waiting;
      if (waiting) waiting.postMessage({ type: "SOCIALBUZZ_GET_VERSION" });
    };
    const onFound = () => {
      const worker = registration.current?.installing;
      worker?.addEventListener("statechange", inspectWorker);
      inspectWorker();
    };
    const check = async () => {
      if (
        disposed ||
        checking ||
        !navigator.onLine ||
        document.visibilityState === "hidden"
      )
        return;
      checking = true;
      try {
        consider(await fetchRelease(base));
      } catch {
        /* Offline or a temporary deploy gap is not an update. */
      } finally {
        checking = false;
      }
      if (registration.current)
        void registration.current
          .update()
          .then(inspectWorker)
          .catch(() => {});
    };
    checkUpdates.current = () => void check();
    window.addEventListener("beforeinstallprompt", offer);
    window.addEventListener("appinstalled", added);
    mode.addEventListener("change", onMode);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    if ("serviceWorker" in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.addEventListener("message", workerMessage);
      void navigator.serviceWorker
        .register(new URL("sw.js", base), {
          scope: base,
          updateViaCache: "none",
        })
        .then((reg) => {
          if (disposed) return;
          registration.current = reg;
          reg.addEventListener("updatefound", onFound);
          onFound();
          void check();
        })
        .catch(() => {});
    }
    return () => {
      disposed = true;
      checkUpdates.current = () => {};
      window.removeEventListener("beforeinstallprompt", offer);
      window.removeEventListener("appinstalled", added);
      mode.removeEventListener("change", onMode);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
      if ("serviceWorker" in navigator)
        navigator.serviceWorker.removeEventListener("message", workerMessage);
      registration.current?.removeEventListener("updatefound", onFound);
    };
  }, [base]);

  useEffect(
    () => scheduleUpdateChecks(() => checkUpdates.current(), gameRound !== null),
    [base, gameRound],
  );

  async function install(): Promise<"accepted" | "dismissed" | "unavailable"> {
    if (!installPrompt) return "unavailable";
    try {
      await installPrompt.prompt();
      const result = await installPrompt.userChoice;
      if (result.outcome === "accepted") setInstalled(true);
      return result.outcome;
    } catch {
      return "unavailable";
    } finally {
      setInstallPrompt(null);
    }
  }
  async function checkForUpdates() {
    try {
      const candidate = await fetchRelease(base);
      const updateAvailable = isNewerVersion(candidate.version, APP_VERSION);
      if (updateAvailable) setLatest(candidate);
      if (registration.current)
        void registration.current.update().catch(() => {});
      return { version: candidate.version, updateAvailable };
    } catch {
      return null;
    }
  }
  async function refresh() {
    if (refreshing || !latest) return;
    setRefreshing(true);
    setUpdateError("");
    try {
      if (!navigator.onLine)
        throw new Error(
          "Reconnect to the internet, then choose Refresh to download the update.",
        );
      if ("serviceWorker" in navigator && import.meta.env.PROD) {
        const reg =
          registration.current ||
          (await navigator.serviceWorker.getRegistration(base));
        if (reg)
          await requestWorkerActivation(
            reg,
            navigator.serviceWorker,
            latest.version,
          );
      }
      window.location.replace(refreshUrl(window.location.href, latest.version));
    } catch (error) {
      setUpdateError(
        error instanceof Error
          ? error.message
          : "The update could not finish. Please try Refresh again.",
      );
      setRefreshing(false);
    }
  }
  return {
    installed,
    canPrompt: !!installPrompt,
    install,
    latest,
    refreshing,
    updateError,
    refresh,
    checkForUpdates,
  };
}
