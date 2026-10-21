import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = new URL("../dist/", import.meta.url);
const release = JSON.parse(
  await readFile(new URL("../release.json", import.meta.url), "utf8"),
);
let commit = process.env.GITHUB_SHA;
if (!commit) {
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    commit = "local";
  }
}
await writeFile(
  new URL("version.json", root),
  JSON.stringify({ version: release.version, commit }) + "\n",
);
async function files(dir, prefix = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.isDirectory())
      result.push(
        ...(await files(
          new URL(entry.name + "/", dir),
          prefix + entry.name + "/",
        )),
      );
    else if (entry.name !== "sw.js") result.push(prefix + entry.name);
  }
  return result.sort();
}
const paths = await files(root);
const hash = createHash("sha256");
for (const path of paths)
  hash.update(path).update(await readFile(new URL(path, root)));
const template = await readFile(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);
const source = template
  .replace(
    "socialbuzz-shell-v1",
    "socialbuzz-" + hash.digest("hex").slice(0, 12),
  )
  .replace("__APP_VERSION__", release.version)
  .replace(
    /const PRECACHE = .*;/,
    "const PRECACHE = " +
      JSON.stringify([
        "./",
        ...paths
          .filter((path) => path !== "index.html" && path !== "version.json")
          .map((path) => "./" + path),
      ]) +
      ";",
  );
await writeFile(new URL("sw.js", root), source);
console.log(
  `Offline shell: precached ${paths.filter((path) => path !== "version.json").length} versioned files.`,
);
