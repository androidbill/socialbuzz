export function parts(version) {
  if (
    typeof version !== "string" ||
    !/^\d{4}\.\d{2}\.\d{2}\.\d{2,}$/.test(version)
  )
    throw new Error("Invalid SocialBuzz version: " + version);
  return version.split(".").map(Number);
}
export function compareVersions(a, b) {
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < 4; i++)
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
export function localDay(date = new Date(), timeZone = "America/Edmonton") {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${values.year}.${values.month}.${values.day}`;
}
export function nextVersion(
  previous,
  date = new Date(),
  timeZone = "America/Edmonton",
) {
  const day = localDay(date, timeZone);
  if (!previous) return day + ".01";
  const values = parts(previous);
  const previousDay = previous.split(".").slice(0, 3).join(".");
  // Never publish a lower version if a runner clock is behind the last release.
  return previousDay >= day
    ? previousDay + "." + String(values[3] + 1).padStart(2, "0")
    : day + ".01";
}
export function selectRelease({
  baseline,
  published,
  commit,
  date = new Date(),
  timeZone = "America/Edmonton",
}) {
  parts(baseline);
  if (published?.version) parts(published.version);
  if (published?.commit === commit && published?.version)
    return published.version;
  if (!published?.version) {
    const first = nextVersion(null, date, timeZone);
    return compareVersions(baseline, first) >= 0 ? baseline : first;
  }
  const next = nextVersion(published.version, date, timeZone);
  return compareVersions(baseline, next) > 0 ? baseline : next;
}
