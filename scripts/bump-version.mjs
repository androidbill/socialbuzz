import { readFile, writeFile } from "node:fs/promises";
import { compareVersions, nextVersion } from "./version-utils.mjs";
const path = new URL("../release.json", import.meta.url);
const release = JSON.parse(await readFile(path, "utf8"));
const response = await fetch(
  "https://androidbill.github.io/socialbuzz/version.json?check=" + Date.now(),
  { cache: "no-store", signal: AbortSignal.timeout(15000) },
);
if (!response.ok && response.status !== 404)
  throw new Error(
    "Could not check the live version. Try the version bump again when the connection is available.",
  );
const published = response.ok ? await response.json() : null;
const previous =
  published?.version && compareVersions(published.version, release.version) > 0
    ? published.version
    : release.version;
release.version = nextVersion(previous, new Date(), release.timeZone);
await writeFile(path, JSON.stringify(release, null, 2) + "\n");
console.log("Next SocialBuzz release: " + release.version);
