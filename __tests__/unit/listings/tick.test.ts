import { describe, expect, it } from "vitest";
import { decideMode, RETRY_AFTER_ERROR_MINUTES } from "@/lib/listings/tick";

const MINUTE = 60_000;
const at = (iso: string) => new Date(iso);

describe("decideMode", () => {
  it("runs the full verify once a day after 03:00 UTC", () => {
    expect(decideMode({ now: at("2026-09-15T03:05:00Z"), state: { lastFullDate: "2026-09-14" }, lastOkIncremental: at("2026-09-15T02:50:00Z") })).toBe("full");
    expect(decideMode({ now: at("2026-09-15T02:55:00Z"), state: { lastFullDate: "2026-09-14" }, lastOkIncremental: at("2026-09-15T02:50:00Z") })).toBeNull();
    expect(decideMode({ now: at("2026-09-15T23:50:00Z"), state: { lastFullDate: "2026-09-15" }, lastOkIncremental: at("2026-09-15T23:40:00Z") })).toBeNull();
  });

  it("runs an incremental when the last complete one is about an hour old, or there is none", () => {
    const now = at("2026-09-15T12:00:00Z");
    expect(decideMode({ now, state: { lastFullDate: "2026-09-15" }, lastOkIncremental: null })).toBe("incremental");
    expect(decideMode({ now, state: { lastFullDate: "2026-09-15" }, lastOkIncremental: new Date(now.getTime() - 56 * MINUTE) })).toBe("incremental");
    expect(decideMode({ now, state: { lastFullDate: "2026-09-15" }, lastOkIncremental: new Date(now.getTime() - 40 * MINUTE) })).toBeNull();
  });

  it("backs off after a failed run instead of retrying every tick", () => {
    const now = at("2026-09-15T12:00:00Z");
    const recent = { lastFullDate: "2026-09-14", lastStatus: "error", lastRunAt: new Date(now.getTime() - 10 * MINUTE).toISOString() };
    expect(decideMode({ now, state: recent, lastOkIncremental: null })).toBeNull();
    const older = { ...recent, lastRunAt: new Date(now.getTime() - (RETRY_AFTER_ERROR_MINUTES + 1) * MINUTE).toISOString() };
    expect(decideMode({ now, state: older, lastOkIncremental: null })).toBe("full");
  });

  it("continues a discovery scan only when nothing else is due", () => {
    const now = at("2026-09-15T12:00:00Z");
    const cursor = { sinceTimestamp: "2026-09-15T10:58:00.000Z", startedAt: "2026-09-15T11:00:00Z", scanned: 1200, found: 40, pages: 6, expectedCount: 55_000 };
    const idle = { lastFullDate: "2026-09-15", discoverCursor: cursor };
    expect(decideMode({ now, state: idle, lastOkIncremental: new Date(now.getTime() - 20 * MINUTE) })).toBe("discover");
    // The hourly and the daily full still come first.
    expect(decideMode({ now, state: idle, lastOkIncremental: new Date(now.getTime() - 56 * MINUTE) })).toBe("incremental");
    expect(decideMode({ now: at("2026-09-15T03:05:00Z"), state: { ...idle, lastFullDate: "2026-09-14" }, lastOkIncremental: at("2026-09-15T02:50:00Z") })).toBe("full");
    // No cursor: an idle tick stays idle.
    expect(decideMode({ now, state: { lastFullDate: "2026-09-15" }, lastOkIncremental: new Date(now.getTime() - 20 * MINUTE) })).toBeNull();
  });
});
