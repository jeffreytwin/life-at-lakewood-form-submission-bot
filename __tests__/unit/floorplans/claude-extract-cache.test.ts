import { describe, it, expect, vi, beforeEach } from "vitest";

// A Supabase that remembers one page read and takes usage rows: every
// call chains, a lookup answers with the row, and the rest answer with
// nothing wrong.
const db = vi.hoisted(() => {
  const state: { read: Record<string, unknown> | null; usage: Record<string, unknown>[]; remembered: Record<string, unknown>[] } = {
    read: null,
    usage: [],
    remembered: [],
  };
  const chain = (table: string) => {
    const api: Record<string, unknown> = {};
    const self = () => api;
    for (const m of ["select", "eq", "update", "delete", "in", "gte", "order", "limit", "match", "not", "is", "or"]) api[m] = self;
    api.maybeSingle = async () => ({ data: table === "fp_page_reads" ? state.read : null, error: null });
    api.insert = async (row: Record<string, unknown>) => {
      if (table === "fp_ai_usage") state.usage.push(row);
      return { error: null };
    };
    api.upsert = async (row: Record<string, unknown>) => {
      if (table === "fp_page_reads") state.remembered.push(row);
      return { error: null };
    };
    api.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
    return api;
  };
  return { state, from: vi.fn((table: string) => chain(table)) };
});
vi.mock("@/lib/supabase/client", () => ({ supabase: { from: db.from } }));

const claude = vi.hoisted(() => ({
  create: vi.fn(async () => ({
    content: [{ type: "tool_use", id: "t1", name: "report_plan_page", input: { garages: "3 car", description: "A fine home with a den and a lanai." } }],
    usage: { input_tokens: 5_000, output_tokens: 200 },
    stop_reason: "tool_use",
  })),
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: claude.create, stream: () => ({ finalMessage: async () => claude.create() }) };
  },
}));

import { readPlanPageWithClaude } from "@/lib/floorplans/extractors/claude-extract";
import { digestOf, normalizedText, variantOf } from "@/lib/floorplans/page-reads";
import { distill } from "@/lib/floorplans/extractors/claude-extract";
import type { NormalizedPlan } from "@/lib/floorplans/types";

process.env.ANTHROPIC_API_KEY = "test";

const html = `<html><body><h1>The Lori</h1><p>${"A three bedroom home with a great room, a den, a lanai and a three car garage. ".repeat(12)}</p><p>Priced from $459,990</p></body></html>`;
const plan: NormalizedPlan = {
  planKey: "lori",
  name: "Lori",
  price: null,
  priceDisplay: null,
  beds: "3",
  baths: "2",
  sqft: 2_400,
  garages: null,
  homeType: null,
  quickMoveIn: false,
  comingSoon: false,
  sourceUrl: "https://builder.example/plans/lori/",
  galleryImages: [],
  blueprintImages: [],
  description: null,
};
const read = async (url: string) => ({ url, html });

describe("readPlanPageWithClaude with a page read once (2026-09-29)", () => {
  beforeEach(() => {
    db.state.read = null;
    db.state.usage = [];
    db.state.remembered = [];
    claude.create.mockClear();
  });

  it("asks Claude about a page nobody has read, writes the call down, and remembers what it said", async () => {
    const out = await readPlanPageWithClaude(plan, read);
    expect(claude.create).toHaveBeenCalledTimes(1);
    expect(out.garages).toBe("3 car");
    expect(out.description).toBe("A fine home with a den and a lanai.");
    expect(db.state.usage).toHaveLength(1);
    expect(db.state.usage[0]).toMatchObject({ purpose: "plan-page", model: "claude-sonnet-5", cached: false, input_tokens: 5_000, output_tokens: 200, cost_cents: 1.2 });
    expect(db.state.remembered).toHaveLength(1);
    const kept = db.state.remembered[0];
    expect(kept.url).toBe(plan.sourceUrl);
    expect(kept.kind).toBe("plan");
    expect(kept.digest).toBe(digestOf("plan", distill(html, plan.sourceUrl!)));
    expect(kept.facts).toEqual({ garages: "3 car", description: "A fine home with a den and a lanai." });
    // The text it was digested from is kept too, and there was nothing to compare it with.
    expect(kept.text).toBe(normalizedText("plan", distill(html, plan.sourceUrl!)));
    expect(kept).not.toHaveProperty("last_change");
  });

  it("does not ask about a page that reads the same as last time: the remembered facts stand, at no cost", async () => {
    // What the first read would have remembered, as the table holds it.
    const first = await readPlanPageWithClaude(plan, read);
    const kept = db.state.remembered[0];
    db.state.read = { digest: kept.digest, variant: kept.variant, facts: kept.facts, model: "claude-sonnet-5", read_at: new Date().toISOString(), hits: 0 };
    claude.create.mockClear();
    db.state.usage = [];

    const again = await readPlanPageWithClaude(plan, read);
    expect(claude.create).not.toHaveBeenCalled();
    expect(again.garages).toBe(first.garages);
    expect(again.description).toBe(first.description);
    expect(db.state.usage).toHaveLength(1);
    expect(db.state.usage[0]).toMatchObject({ purpose: "plan-page", cached: true, cost_cents: 0, input_tokens: 0 });
  });

  it("asks again when the page's text has changed, or when it is read another way, and writes down what changed", async () => {
    const text = normalizedText("plan", distill(html, plan.sourceUrl!));
    const stale = {
      digest: "not-this-page",
      variant: variantOf("plan", {}),
      facts: { garages: "2 car" },
      model: "claude-sonnet-5",
      read_at: new Date().toISOString(),
      hits: 0,
      text: text.replace("$459,990", "$449,990"),
    };
    db.state.read = stale;
    const out = await readPlanPageWithClaude(plan, read);
    expect(claude.create).toHaveBeenCalledTimes(1);
    expect(out.garages).toBe("3 car");
    const kept = db.state.remembered[0];
    expect(kept.text).toBe(text);
    const change = kept.last_change as { before: string; after: string; at: number };
    expect(change.before).toContain("$449,990");
    expect(change.after).toContain("$459,990");
    expect(change.at).toBeGreaterThan(0);
  });
});
