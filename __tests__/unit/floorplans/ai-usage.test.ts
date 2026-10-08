import { describe, it, expect, vi, beforeEach } from "vitest";

const { from, insert } = vi.hoisted(() => {
  const insert = vi.fn(async () => ({ error: null }));
  const from = vi.fn(() => ({ insert }));
  return { from, insert };
});
vi.mock("@/lib/supabase/client", () => ({ supabase: { from } }));

import { costCents, pricesOf, recordUsage, tally } from "@/lib/floorplans/ai-usage";
import { withRunContext } from "@/lib/floorplans/run-context";

describe("costCents (prices of 2026-09-29)", () => {
  it("prices a Sonnet 5 page read: input at $2, output at $10 a million", () => {
    // 10,000 in and 1,000 out: 2 cents + 1 cent.
    expect(costCents("claude-sonnet-5", { input_tokens: 10_000, output_tokens: 1_000 })).toBe(3);
  });

  it("prices cache reads and writes at their own rates", () => {
    expect(costCents("claude-opus-5", { input_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0, output_tokens: 0 })).toBe(50);
    expect(costCents("claude-opus-5", { cache_creation_input_tokens: 1_000_000 })).toBe(625);
  });

  it("prices a Haiku 5.5 page read at $0.10 in and $0.50 out a million, and a prompt past 100,000 tokens at $0.50 and $2.50", () => {
    // 10,000 in and 1,000 out: 0.1 cent + 0.05 cent.
    expect(costCents("claude-haiku-5-5", { input_tokens: 10_000, output_tokens: 1_000 })).toBe(0.15);
    // 100,000 is still the short prompt's price; cache reads count toward the length.
    expect(costCents("claude-haiku-5-5", { input_tokens: 100_000 })).toBe(1);
    expect(costCents("claude-haiku-5-5", { input_tokens: 60_000, cache_read_input_tokens: 60_000, output_tokens: 2_000 })).toBe(3.8);
  });

  it("knows a model by its id less a date, and prices an unknown one at nothing", () => {
    expect(pricesOf("claude-haiku-4-5-20251001")).toEqual(pricesOf("claude-haiku-4-5"));
    expect(costCents("claude-haiku-4-5-20251001", { input_tokens: 1_000_000 })).toBe(100);
    expect(costCents("claude-something-new", { input_tokens: 1_000_000 })).toBe(0);
    expect(costCents("claude-sonnet-5", null)).toBe(0);
  });
});

describe("tally", () => {
  it("counts calls, page reads and the reads served from memory, and sums the cost", () => {
    const totals = tally([
      { purpose: "list-page", cached: false, cost_cents: "1.5" },
      { purpose: "plan-page", cached: true, cost_cents: 0 },
      { purpose: "plan-page", cached: false, cost_cents: 2.25 },
      { purpose: "description", cached: false, cost_cents: 0.1 },
    ]);
    expect(totals).toEqual({ calls: 3, reads: 3, cached: 1, costCents: 3.85 });
  });
});

describe("recordUsage", () => {
  beforeEach(() => {
    from.mockClear();
    insert.mockClear();
  });

  it("writes the call down with the run it was made under, and returns its cost", async () => {
    const cost = await withRunContext({ source: "nightly", connectionId: "conn-1", runId: "manual-1" }, () =>
      recordUsage({ purpose: "plan-page", model: "claude-sonnet-5", usage: { input_tokens: 10_000, output_tokens: 1_000 }, ms: 1200, url: "https://b.com/p" })
    );
    expect(cost).toBe(3);
    expect(from).toHaveBeenCalledWith("fp_ai_usage");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "plan-page",
        model: "claude-sonnet-5",
        source: "nightly",
        connection_id: "conn-1",
        run_id: "manual-1",
        input_tokens: 10_000,
        output_tokens: 1_000,
        cached: false,
        ok: true,
        cost_cents: 3,
        url: "https://b.com/p",
      })
    );
  });

  it("writes a read served from memory down as costing nothing, outside any run", async () => {
    const cost = await recordUsage({ purpose: "plan-page", model: "claude-sonnet-5", cached: true });
    expect(cost).toBe(0);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ cached: true, cost_cents: 0, source: null, connection_id: null, run_id: null }));
  });

  it("never throws: a table that cannot be written is a warning", async () => {
    insert.mockImplementationOnce(async () => {
      throw new Error("down");
    });
    await expect(recordUsage({ purpose: "description", model: "claude-opus-5", usage: { input_tokens: 1 } })).resolves.toBeCloseTo(0.0005, 6);
  });
});
