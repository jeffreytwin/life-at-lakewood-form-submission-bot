import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Ashton Woods' Oakfield (2026-10-09): the community's list outgrew the
// room its answer had, the answer was cut off before its list began, and
// "no plans" was remembered — and replayed by every run after it.

const db = vi.hoisted(() => {
  const state: { read: Record<string, unknown> | null; remembered: Record<string, unknown>[] } = { read: null, remembered: [] };
  const chain = (table: string) => {
    const api: Record<string, unknown> = {};
    const self = () => api;
    for (const m of ["select", "eq", "update", "delete", "in", "gte", "order", "limit", "match", "not", "is", "or"]) api[m] = self;
    api.maybeSingle = async () => ({ data: table === "fp_page_reads" ? state.read : null, error: null });
    api.insert = async () => ({ error: null });
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

const claude = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: claude.create, stream: (body: unknown) => ({ finalMessage: async () => claude.create(body) }) };
  },
}));

import { askAgain, distill, extractWithClaude, LIST_READ_MODEL } from "@/lib/floorplans/extractors/claude-extract";
import { digestOf, readVersion, variantOf } from "@/lib/floorplans/page-reads";

process.env.ANTHROPIC_API_KEY = "test";

const url = "https://www.ashtonwoods.com/tampa/oakfield-trails";
const html = `<html><body><h1>Oakfield Trails</h1>${"<p>The Duval, 4,093 sq. ft., 5 beds, from $547,145. The Griffin, 3,629 sq. ft., 4 beds, from $501,695.</p>".repeat(12)}</body></html>`;
const cutOff = { content: [{ type: "tool_use", id: "t", name: "report_floor_plans", input: {} }], usage: { input_tokens: 67_000, output_tokens: 32_768 }, stop_reason: "max_tokens" };
const noPlans = { content: [{ type: "tool_use", id: "t", name: "report_floor_plans", input: { plans: [] } }], usage: { input_tokens: 67_000, output_tokens: 20 }, stop_reason: "tool_use" };

describe("askAgain", () => {
  it("asks again for any answer cut off by its room, whatever it parsed as", () => {
    expect(askAgain({ reported: undefined, stop: "max_tokens" })).toBe(true);
    expect(askAgain({ reported: [{ name: "Duval" }], stop: "max_tokens" })).toBe(true);
  });
  it("asks again for a list written as text, and not for a finished list or none", () => {
    expect(askAgain({ reported: "the plans are…", stop: "tool_use" })).toBe(true);
    expect(askAgain({ reported: [{ name: "Duval" }], stop: "tool_use" })).toBe(false);
    expect(askAgain({ reported: undefined, stop: "tool_use" })).toBe(false);
  });
});

describe("a community's list read (Ashton Woods' Oakfield, 2026-10-09)", () => {
  beforeEach(() => {
    db.state.read = null;
    db.state.remembered = [];
    claude.create.mockReset();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, url, text: async () => html })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads again a list remembered as empty, asks again with more room when cut off, and keeps nothing cut off", async () => {
    const content = distill(html, url);
    db.state.read = {
      digest: digestOf("list", content),
      variant: variantOf("list", { model: LIST_READ_MODEL, version: readVersion(undefined), mode: "both", hint: null }),
      facts: [],
      model: LIST_READ_MODEL,
      read_at: new Date().toISOString(),
      hits: 5,
    };
    claude.create.mockResolvedValue(cutOff);
    await expect(extractWithClaude({ url })).rejects.toThrow(/did not fit in one answer/);
    expect(claude.create).toHaveBeenCalledTimes(2);
    const [first, second] = claude.create.mock.calls.map((c) => (c as [{ max_tokens: number }])[0].max_tokens);
    expect(second).toBeGreaterThan(first);
    expect(db.state.remembered).toEqual([]);
  });

  it("does not remember a list that came back empty", async () => {
    claude.create.mockResolvedValue(noPlans);
    await expect(extractWithClaude({ url })).rejects.toThrow();
    expect(claude.create).toHaveBeenCalledTimes(1);
    expect(db.state.remembered).toEqual([]);
  });
});
