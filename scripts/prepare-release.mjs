import { readFile, writeFile } from "node:fs/promises";
import { selectRelease } from "./version-utils.mjs";
const path = new URL("../release.json", import.meta.url);
const release = JSON.parse(await readFile(path, "utf8"));
if (process.env.GITHUB_ACTIONS === "true") {
  const url = new URL("https://androidbill.github.io/socialbuzz/version.json");
  url.searchParams.set(
    "release-check",
    process.env.GITHUB_RUN_ID + "-" + process.env.GITHUB_RUN_ATTEMPT,
  );
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok && response.status !== 404)
    throw new Error(
      "Cannot verify the published version. Stopping rather than reusing an old version.",
    );
  const published = response.ok ? await response.json() : null;
  release.version = selectRelease({
    baseline: release.version,
    published,
    commit: process.env.GITHUB_SHA,
    timeZone: release.timeZone,
  });
  await writeFile(path, JSON.stringify(release, null, 2) + "\n");
}
console.log("Building SocialBuzz " + release.version);
