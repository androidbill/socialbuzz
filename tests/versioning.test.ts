import { describe, expect, it } from "vitest";
import {
  compareVersions,
  localDay,
  nextVersion,
  selectRelease,
} from "../scripts/version-utils.mjs";
describe("dated release versions", () => {
  const date = new Date("2026-10-21T20:00:00Z");
  it("starts the requested first release at 2026.10.21.01", () => {
    expect(
      selectRelease({
        baseline: "2026.10.21.01",
        published: null,
        commit: "first",
        date,
      }),
    ).toBe("2026.10.21.01");
  });
  it("increments the same day and does not compare counters alphabetically", () => {
    expect(nextVersion("2026.10.21.09", date)).toBe("2026.10.21.10");
    expect(nextVersion("2026.10.21.99", date)).toBe("2026.10.21.100");
    expect(compareVersions("2026.10.21.100", "2026.10.21.99")).toBe(1);
  });
  it("resets the sequence on a new Edmonton day, month, and year", () => {
    expect(nextVersion("2026.10.21.04", new Date("2026-10-22T06:01:00Z"))).toBe(
      "2026.10.22.01",
    );
    expect(nextVersion("2026.10.31.04", new Date("2026-11-01T18:00:00Z"))).toBe(
      "2026.11.01.01",
    );
    expect(nextVersion("2026.12.31.04", new Date("2027-01-01T18:00:00Z"))).toBe(
      "2027.01.01.01",
    );
  });
  it("uses Edmonton rather than UTC at midnight", () => {
    expect(localDay(new Date("2026-10-22T01:00:00Z"))).toBe("2026.10.21");
  });
  it("advances a new commit even if the source version bump was forgotten", () => {
    expect(
      selectRelease({
        baseline: "2026.10.21.01",
        published: { version: "2026.10.21.03", commit: "old" },
        commit: "new",
        date,
      }),
    ).toBe("2026.10.21.04");
  });
  it("does not double-bump an explicitly advanced source release", () => {
    expect(
      selectRelease({
        baseline: "2026.10.21.04",
        published: { version: "2026.10.21.03", commit: "old" },
        commit: "new",
        date,
      }),
    ).toBe("2026.10.21.04");
  });
  it("reuses the published version when the same commit is redeployed", () => {
    expect(
      selectRelease({
        baseline: "2026.10.21.01",
        published: { version: "2026.10.21.04", commit: "same" },
        commit: "same",
        date: new Date("2026-10-22T20:00:00Z"),
      }),
    ).toBe("2026.10.21.04");
  });
  it("rejects bad version metadata and never rolls back for a clock error", () => {
    expect(() => compareVersions("broken", "2026.10.21.01")).toThrow();
    expect(nextVersion("2026.10.22.02", date)).toBe("2026.10.22.03");
  });
});
