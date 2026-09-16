import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/shared/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));

import { ESCALATE_AFTER, escalateRepeats, runErrorLevel, type PriorEvent } from "@/lib/listings/runs";

const prior = (patch: Partial<PriorEvent>): PriorEvent => ({ level: "warn", kind: "import_failed", site_id: "s1", listing_id: "MFR1", dismissed_at: null, ...patch });
const row = (patch: Record<string, unknown>): Record<string, unknown> => ({ level: "warn", kind: "import_failed", site_id: "s1", listing_id: "MFR1", message: "import failed", ...patch });

describe("escalateRepeats", () => {
  it("leaves a first or second warning alone", () => {
    const rows = [row({})];
    expect(escalateRepeats(rows, Array.from({ length: ESCALATE_AFTER - 1 }, () => prior({})))).toBe(0);
    expect(rows[0].level).toBe("warn");
  });

  it("promotes a warning the earlier runs already gave for the same problem", () => {
    const rows = [row({}), row({ listing_id: "MFR2" }), row({ kind: "insert", level: "info" })];
    const promoted = escalateRepeats(rows, [prior({}), prior({}), prior({ listing_id: "MFR9" })]);
    expect(promoted).toBe(1);
    expect(rows[0].level).toBe("error");
    expect(rows[0].message).toContain("2 earlier run(s)");
    expect(rows[1].level).toBe("warn");
    expect(rows[2].level).toBe("info");
  });

  it("does not raise a second error while the first is still open, and does again once dismissed", () => {
    const history = [prior({}), prior({}), prior({ level: "error" })];
    const rows = [row({})];
    expect(escalateRepeats(rows, history)).toBe(0);
    expect(rows[0].level).toBe("warn");
    const dismissed = [prior({}), prior({}), prior({ level: "error", dismissed_at: "2026-09-16T19:00:00.000Z" })];
    expect(escalateRepeats([row({})], dismissed)).toBe(1);
  });

  it("only touches the retried kinds", () => {
    const rows = [row({ kind: "download_failed" })];
    expect(escalateRepeats(rows, [prior({ kind: "download_failed" }), prior({ kind: "download_failed" })])).toBe(0);
  });
});

describe("runErrorLevel", () => {
  it("treats rate limits, upstream 5xx and network faults as warnings", () => {
    expect(runErrorLevel("MLSGrid 503: Service Unavailable")).toBe("warn");
    expect(runErrorLevel("MLSGrid 429: too many requests")).toBe("warn");
    expect(runErrorLevel("Wix API POST /wix-data/v2/bulk/items/save: 502 Bad Gateway")).toBe("warn");
    expect(runErrorLevel("fetch failed: ECONNRESET")).toBe("warn");
    expect(runErrorLevel("Media Manager folder lookup timed out after 20000 ms")).toBe("warn");
  });

  it("treats a client error or a bug as an error", () => {
    expect(runErrorLevel("MLSGrid 400: The $skip value (84800) is very high")).toBe("error");
    expect(runErrorLevel("Wix API POST /x: 403 Forbidden")).toBe("error");
    expect(runErrorLevel("Cannot read properties of undefined (reading 'id')")).toBe("error");
  });
});
