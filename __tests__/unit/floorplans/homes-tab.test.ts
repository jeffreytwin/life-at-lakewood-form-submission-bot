import { describe, it, expect, vi, beforeEach } from "vitest";

// Richmond American's Estates at Rivers Edge (Jeff, 2026-10-24): the
// homes sit behind a "Move-in ready" tab, and about half the loads of the
// page never draw. One such load cost the night's run all ten homes, and
// the run came back "partial: 5 of the 15 plans".

const db = vi.hoisted(() => {
  const chain = () => {
    const api: Record<string, unknown> = {};
    const self = () => api;
    for (const m of ["select", "eq", "update", "delete", "in", "gte", "order", "limit", "match", "not", "is", "or"]) api[m] = self;
    api.maybeSingle = async () => ({ data: null, error: null });
    api.insert = async () => ({ error: null });
    api.upsert = async () => ({ error: null });
    api.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
    return api;
  };
  return { from: vi.fn(() => chain()) };
});
vi.mock("@/lib/supabase/client", () => ({ supabase: { from: db.from } }));

const claude = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: claude.create, stream: (body: unknown) => ({ finalMessage: async () => claude.create(body) }) };
  },
}));

type Rendered = { url: string; html: string; pressed: string | null };
const browser = vi.hoisted(() => ({ render: vi.fn<(url: string, opts?: { press?: readonly string[] }) => Promise<Rendered>>() }));
vi.mock("@/lib/floorplans/extractors/render", () => ({
  withRenderer: async <T,>(_budget: number, work: (render: typeof browser.render) => Promise<T>) => work(browser.render),
  siteStopsBrowsers: () => false,
}));

import { extractWithRender, homesBehindTab } from "@/lib/floorplans/extractors/claude-extract";

process.env.ANTHROPIC_API_KEY = "test";

const url = "https://www.richmondamerican.com/florida/tampa-new-homes/parrish/estates-at-rivers-edge/";
const page = (body: string) => `<html><body><h1>Estates at Rivers Edge in Parrish, Florida</h1>${body}</body></html>`;
const plansShown = page("<p>The Ammolite, 2,060 sq. ft., 4 beds, from $449,950. The Slate, 2,280 sq. ft., 4 beds, from $469,950.</p>".repeat(8));
const homesShown = page("<p>14518 Banks Court, a Slate, 2,280 sq. ft., 4 beds, $479,950. Ready for move-in now.</p>".repeat(8));
// What a load that lost its connection shows: the page's words, and not one price, size or bed count.
const neverDrew = page("<p>Discover new homes in Parrish with resort-style amenities, top-rated schools and easy access to the Gulf coast.</p>".repeat(8));

const answer = (plans: Record<string, unknown>[]) => ({
  content: [{ type: "tool_use", id: "t", name: "report_floor_plans", input: { plans } }],
  usage: { input_tokens: 10_000, output_tokens: 900 },
  stop_reason: "tool_use",
});
const asked = (body: unknown) => String((body as { messages: { content: string }[] }).messages[0].content);

beforeEach(() => {
  browser.render.mockReset();
  claude.create.mockReset();
  claude.create.mockImplementation(async (body: unknown) =>
    /Every entry is a quick move-in/.test(asked(body))
      ? answer([{ name: "14518 Banks Court", price: 479950, beds: 4, sqft: 2280, quickMoveIn: true, relatedPlanName: "Slate" }])
      : answer([
          { name: "Ammolite", price: 449950, beds: 4, sqft: 2060 },
          { name: "Slate", price: 469950, beds: 4, sqft: 2280 },
        ])
  );
});

const pressesOf = () => browser.render.mock.calls.filter(([, opts]) => opts?.press).length;

describe("a community's homes behind its own tab", () => {
  it("loads the page again when a load never drew, and reads the homes from the load that did", async () => {
    let loads = 0;
    browser.render.mockImplementation(async (_u, opts) => {
      if (!opts?.press) return { url, html: plansShown, pressed: null };
      loads += 1;
      return loads === 1 ? { url, html: neverDrew, pressed: null } : { url, html: homesShown, pressed: "move-in ready" };
    });
    const plans = await extractWithRender({ url });
    expect(plans.map((p) => p.name)).toEqual(["Ammolite", "Slate", "14518 Banks Court"]);
    expect(pressesOf()).toBe(2);
  });

  it("loads it again when the tab was pressed and the page then came back almost empty", async () => {
    let loads = 0;
    browser.render.mockImplementation(async (_u, opts) => {
      if (!opts?.press) return { url, html: plansShown, pressed: null };
      loads += 1;
      // The night of 10-24: pressed, and read as 2,930 bytes.
      return loads === 1 ? { url, html: "<html><body>Loading</body></html>", pressed: "move-in ready" } : { url, html: homesShown, pressed: "move-in ready" };
    });
    const plans = await extractWithRender({ url });
    expect(plans.filter((p) => p.quickMoveIn).map((p) => p.name)).toEqual(["14518 Banks Court"]);
    expect(pressesOf()).toBe(2);
  });

  it("takes a page that drew with no such tab at its word, once", async () => {
    browser.render.mockResolvedValue({ url, html: plansShown, pressed: null });
    const plans = await extractWithRender({ url });
    expect(plans.map((p) => p.name)).toEqual(["Ammolite", "Slate"]);
    expect(pressesOf()).toBe(1);
  });

  it("gives up on the homes after three loads that never drew, and keeps the plans", async () => {
    browser.render.mockImplementation(async (_u, opts) => (opts?.press ? { url, html: neverDrew, pressed: null } : { url, html: plansShown, pressed: null }));
    const plans = await extractWithRender({ url });
    expect(plans.map((p) => p.name)).toEqual(["Ammolite", "Slate"]);
    expect(pressesOf()).toBe(3);
  });
});

describe("homesBehindTab", () => {
  it("does not load the page again once the run has no time left to read it", async () => {
    const read = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("page produced almost no text"));
    await expect(homesBehindTab(read, url, Date.now() + 10_000)).rejects.toThrow("almost no text");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads once when the first load is good", async () => {
    const read = vi.fn<() => Promise<string>>().mockResolvedValue("homes");
    expect(await homesBehindTab(read, url, Date.now() + 200_000)).toBe("homes");
    expect(read).toHaveBeenCalledTimes(1);
  });
});
