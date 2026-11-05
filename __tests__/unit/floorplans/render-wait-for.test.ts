import { describe, it, expect, vi, beforeEach } from "vitest";

// Neal Signature's Waterbury Park (2026-11-05): the community page draws
// its four plan cards after its header, and the connection waits for
// ".p7-home-card". The page was loaded twice at once — once for its plans,
// once for a homes tab it does not have — and only one load drew the
// cards. The one read for plans was the other, three runs running, and
// each run failed as "zero results".

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

type Opts = { press?: readonly string[]; waitFor?: string; afresh?: boolean };
type Rendered = { url: string; html: string; pressed: string | null; waited?: boolean | null };
const browser = vi.hoisted(() => ({ render: vi.fn<(url: string, opts?: Opts) => Promise<Rendered>>() }));
vi.mock("@/lib/floorplans/extractors/render", () => ({
  withRenderer: async <T,>(_budget: number, work: (render: typeof browser.render) => Promise<T>) => work(browser.render),
  siteStopsBrowsers: () => false,
}));

import { extractWithRender } from "@/lib/floorplans/extractors/claude-extract";

process.env.ANTHROPIC_API_KEY = "test";

const url = "https://nealsignaturehomes.com/waterbury-park";
const waitFor = ".p7-home-card";
const header = "<h1>Waterbury Park</h1><p>3,138 – 4,189 Sq. Ft. Neal Signature Homes invites you to embrace the Luxury of Living Well.</p>".repeat(6);
const page = (body: string) => `<html><body>${header}${body}</body></html>`;
const withCards = page(
  '<div class="p7-home-card"><a href="https://nealsignaturehomes.com/waterbury-park/palm-bay-2/">Palm Bay 2</a> 3 Bed 3 Bath 3,138 Sq. Ft. Starting From $1,399,990</div>' +
    '<div class="p7-home-card"><a href="https://nealsignaturehomes.com/waterbury-park/kingfisher-2/">Kingfisher 2</a> 3 Bed 4.5 Bath 3,435 Sq. Ft. Starting From $1,454,990</div>'
);
const noCards = page("<p>Showing 0 of 0 results</p>");

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
    /Palm Bay 2/.test(asked(body))
      ? answer([
          { name: "Palm Bay 2", price: 1399990, beds: 3, sqft: 3138 },
          { name: "Kingfisher 2", price: 1454990, beds: 3, sqft: 3435 },
        ])
      : answer([])
  );
});

const listLoads = () => browser.render.mock.calls.filter(([u, o]) => u === url && !o?.press);

describe("a list page read once it shows what the connection waits for", () => {
  it("loads the page again as a first visit when its plan cards never showed, and reads the load that has them", async () => {
    let loads = 0;
    browser.render.mockImplementation(async (u, opts) => {
      if (u !== url) return { url: u, html: page("<p>3 Bed 3 Bath 3,138 Sq. Ft. $1,399,990</p>"), pressed: null, waited: null };
      if (opts?.press) return { url, html: withCards, pressed: null, waited: true };
      loads += 1;
      return loads === 1 ? { url, html: noCards, pressed: null, waited: false } : { url, html: withCards, pressed: null, waited: true };
    });
    const plans = await extractWithRender({ url, waitFor });
    expect(plans.map((p) => p.name)).toEqual(["Palm Bay 2", "Kingfisher 2"]);
    expect(listLoads().map(([, o]) => o)).toEqual([{ waitFor }, { waitFor, afresh: true }]);
  });

  it("loads the page once when the cards showed the first time", async () => {
    browser.render.mockImplementation(async (u) => ({ url: u, html: withCards, pressed: null, waited: true }));
    await extractWithRender({ url, waitFor });
    expect(listLoads()).toHaveLength(1);
  });

  it("presses for a homes tab only once the list page has been read, never beside it", async () => {
    const order: string[] = [];
    let inFlight = 0;
    let most = 0;
    browser.render.mockImplementation(async (u, opts) => {
      if (u !== url) return { url: u, html: withCards, pressed: null, waited: null };
      inFlight += 1;
      most = Math.max(most, inFlight);
      order.push(opts?.press ? "press" : "list");
      await new Promise((done) => setTimeout(done, 5));
      inFlight -= 1;
      return { url, html: withCards, pressed: null, waited: true };
    });
    await extractWithRender({ url, waitFor });
    expect(order[0]).toBe("list");
    expect(order).toContain("press");
    expect(most).toBe(1);
  });

  it("leaves a connection that waits for nothing as it was: the homes tab beside the list", async () => {
    const order: string[] = [];
    browser.render.mockImplementation(async (u, opts) => {
      if (u === url) order.push(opts?.press ? "press" : "list");
      return { url: u, html: withCards, pressed: null };
    });
    await extractWithRender({ url });
    expect(order[0]).toBe("press");
  });
});
