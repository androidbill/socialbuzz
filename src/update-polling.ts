// Starting a new schedule checks immediately, including at a round change.
export function scheduleUpdateChecks(check: () => void, playing: boolean) {
  check();
  const interval = setInterval(check, playing ? 30_000 : 5 * 60_000);
  return () => clearInterval(interval);
}
