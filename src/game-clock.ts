// Read the shared clock on every paint tick; never count down local intervals.
// Mobile browsers can pause a page, so catch up immediately when it returns.
export function observeGameClock(
  tick: (time: number) => void,
  now: () => number,
  page: Pick<
    Document,
    "visibilityState" | "addEventListener" | "removeEventListener"
  > = document,
  events: Pick<Window, "addEventListener" | "removeEventListener"> = window,
) {
  let interval: ReturnType<typeof setInterval> | undefined;
  const paint = () => tick(now());
  const resume = () => {
    clearInterval(interval);
    interval = undefined;
    if (page.visibilityState === "hidden") return;
    paint();
    interval = setInterval(paint, 100);
  };
  page.addEventListener("visibilitychange", resume);
  events.addEventListener("pageshow", resume);
  events.addEventListener("focus", resume);
  resume();
  return () => {
    clearInterval(interval);
    page.removeEventListener("visibilitychange", resume);
    events.removeEventListener("pageshow", resume);
    events.removeEventListener("focus", resume);
  };
}
