import { describe, expect, it, vi } from "vitest";
import { FETCH_BY_ID_BATCH, MIN_REQUEST_INTERVAL_MS, MlsGridClient, MlsGridError, normalizeListingId } from "@/lib/listings/mlsgrid";

interface Call { url: string; headers: Record<string, string> }

function page(items: Array<{ ListingId: string; ModificationTimestamp?: string }>, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ value: items, ...extra }), { status: 200, headers: { "content-type": "application/json" } });
}

/** A client whose clock and sleep are simulated, with a scripted fetch. */
function makeClient(responder: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let clock = 1_000_000;
  const client = new MlsGridClient({
    token: "t",
    fetchImpl: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const call = { url: String(url), headers: (init?.headers ?? {}) as Record<string, string> };
      calls.push(call);
      return responder(call, calls.length);
    }) as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
  });
  return { client, calls, sleeps, tick: (ms: number) => { clock += ms; } };
}

describe("MlsGridClient", () => {
  it("requires a token", () => {
    const saved = process.env.MLSGRID_API_KEY;
    delete process.env.MLSGRID_API_KEY;
    expect(() => new MlsGridClient()).toThrow(MlsGridError);
    if (saved !== undefined) process.env.MLSGRID_API_KEY = saved;
  });

  it("normalises listing ids to the MFR prefix", () => {
    expect(normalizeListingId("A4670555")).toBe("MFRA4670555");
    expect(normalizeListingId(" MFRA4670555 ")).toBe("MFRA4670555");
  });

  it("pages an incremental pull through nextLink with the mfrmls filter and Media expanded", async () => {
    const { client, calls } = makeClient((_call, n) =>
      n === 1
        ? page([{ ListingId: "MFR1" }], { "@odata.count": 2, "@odata.nextLink": "https://api.mlsgrid.com/v2/Property?$skip=200" })
        : page([{ ListingId: "MFR2" }])
    );
    const result = await client.fetchModifiedSince(new Date("2026-09-14T14:00:00.000Z"));
    expect(result.items.map((i) => i.ListingId)).toEqual(["MFR1", "MFR2"]);
    expect(result).toMatchObject({ expectedCount: 2, requestCount: 2, pages: 2, truncated: false });
    const first = decodeURIComponent(calls[0].url);
    expect(first).toContain("$filter=OriginatingSystemName eq 'mfrmls' and ModificationTimestamp gt 2026-09-14T14:00:00.000Z");
    expect(first).toContain("$expand=Media");
    expect(first).toContain("$top=200");
    expect(calls[0].headers.authorization).toBe("Bearer t");
    expect(calls[1].url).toBe("https://api.mlsgrid.com/v2/Property?$skip=200");
    expect(client.stats.requests).toBe(2);
    expect(client.stats.bytes).toBeGreaterThan(0);
  });

  it("stops at maxPages and reports the pull as truncated", async () => {
    const { client } = makeClient(() => page([{ ListingId: "MFR1" }], { "@odata.nextLink": "https://api.mlsgrid.com/v2/Property?$skip=1" }));
    const result = await client.fetchModifiedSince(new Date(), { maxPages: 2 });
    expect(result.pages).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it("never sends two requests closer than the spacing", async () => {
    const { client, sleeps } = makeClient(() => page([], { "@odata.nextLink": undefined }));
    await client.fetchByIds(Array.from({ length: FETCH_BY_ID_BATCH * 3 }, (_, i) => `MFR${i}`));
    expect(client.stats.requests).toBe(3);
    // The first request needs no wait; the next two wait the full interval
    // because the simulated clock only advances while sleeping.
    expect(sleeps).toEqual([MIN_REQUEST_INTERVAL_MS, MIN_REQUEST_INTERVAL_MS]);
  });

  it("verifies ids in batches of 50 with an `in` filter and reports what was covered", async () => {
    const { client, calls } = makeClient(() => page([{ ListingId: "MFRA1" }]));
    const ids = Array.from({ length: 120 }, (_, i) => `A${i}`);
    const result = await client.fetchByIds(ids);
    expect(calls).toHaveLength(3);
    const filter = decodeURIComponent(calls[0].url);
    expect(filter).toContain("ListingId in ('MFRA0','MFRA1'");
    expect(result.verifiedIds).toHaveLength(120);
    expect(result.requestedIds[0]).toBe("MFRA0");
    expect(result.truncated).toBe(false);
  });

  it("stops verifying at the deadline and says which ids it covered", async () => {
    const { client, tick } = makeClient(() => {
      tick(10_000);
      return page([]);
    });
    const deadline = 1_000_000 + 5_000;
    const result = await client.fetchByIds(Array.from({ length: 100 }, (_, i) => `MFR${i}`), { deadline });
    expect(result.verifiedIds).toHaveLength(50);
    expect(result.truncated).toBe(true);
  });

  it("retries a 5xx with backoff, then succeeds", async () => {
    const { client, sleeps } = makeClient((_call, n) =>
      n === 1 ? new Response("boom", { status: 503 }) : page([{ ListingId: "MFR1" }])
    );
    const result = await client.fetchByIds(["MFR1"]);
    expect(result.items).toHaveLength(1);
    expect(client.stats.retries).toBe(1);
    expect(sleeps).toContain(1000);
  });

  it("does not retry a 429: the run stops so the token is not suspended for longer", async () => {
    const { client, calls } = makeClient(() => new Response("throttled", { status: 429 }));
    await expect(client.fetchByIds(["MFR1"])).rejects.toMatchObject({ status: 429, rateLimited: true });
    expect(calls).toHaveLength(1);
    expect(client.stats.rateLimited).toBe(1);
  });

  it("surfaces other client errors without retrying", async () => {
    const { client, calls } = makeClient(() => new Response("bad filter", { status: 400 }));
    await expect(client.fetchOne("MFR1")).rejects.toMatchObject({ status: 400, rateLimited: false });
    expect(calls).toHaveLength(1);
  });

  describe("fetchActive (discovery)", () => {
    it("asks for Active listings MLS-wide without Media, follows nextLink to the end and reports the newest timestamp", async () => {
      const { client, calls } = makeClient((call, n) =>
        n === 1
          ? page([{ ListingId: "MFR1", ModificationTimestamp: "2026-09-16T10:00:00.000Z" }, { ListingId: "MFR2", ModificationTimestamp: "2026-09-16T10:05:00.000Z" }], { "@odata.count": 3, "@odata.nextLink": "https://api.mlsgrid.com/v2/Property?next=2" })
          : page([{ ListingId: "MFR3", ModificationTimestamp: "2026-09-16T10:09:00.000Z" }])
      );
      const result = await client.fetchActive();
      expect(calls).toHaveLength(2);
      const first = decodeURIComponent(calls[0].url);
      expect(first).toContain("StandardStatus eq 'Active'");
      expect(first).toContain("OriginatingSystemName eq 'mfrmls'");
      expect(first).not.toContain("ModificationTimestamp");
      expect(first).not.toContain("$expand");
      expect(calls[1].url).toBe("https://api.mlsgrid.com/v2/Property?next=2");
      expect(result).toMatchObject({ expectedCount: 3, pages: 2, requestCount: 2, truncated: false, ordered: true, lastModificationTimestamp: "2026-09-16T10:09:00.000Z" });
      expect(result.items.map((i) => i.ListingId)).toEqual(["MFR1", "MFR2", "MFR3"]);
    });

    it("stops at maxPages, and a resumed scan asks for records modified after the last timestamp instead of using $skip", async () => {
      const { client } = makeClient((call, n) => page([{ ListingId: `MFR${n}`, ModificationTimestamp: `2026-09-16T10:0${n}:00.000Z` }], { "@odata.nextLink": `https://api.mlsgrid.com/v2/Property?$skip=${n * 200}` }));
      const first = await client.fetchActive({ maxPages: 2 });
      expect(first).toMatchObject({ pages: 2, truncated: true, lastModificationTimestamp: "2026-09-16T10:02:00.000Z" });

      const { client: resumed, calls } = makeClient((call, n) => (n === 1 ? page([{ ListingId: "MFR3", ModificationTimestamp: "2026-09-16T10:03:00.000Z" }]) : page([])));
      const rest = await resumed.fetchActive({ since: new Date(first.lastModificationTimestamp!) });
      const url = decodeURIComponent(calls[0].url);
      expect(url).toContain("StandardStatus eq 'Active' and ModificationTimestamp gt 2026-09-16T10:02:00.000Z");
      expect(url).not.toContain("$skip");
      expect(rest).toMatchObject({ pages: 1, truncated: false });
      expect(rest.items.map((i) => i.ListingId)).toEqual(["MFR3"]);
    });

    it("flags a page that comes back out of timestamp order", async () => {
      const { client } = makeClient(() => page([{ ListingId: "MFR1", ModificationTimestamp: "2026-09-16T10:05:00.000Z" }, { ListingId: "MFR2", ModificationTimestamp: "2026-09-16T10:01:00.000Z" }]));
      const result = await client.fetchActive();
      expect(result.ordered).toBe(false);
      expect(result.lastModificationTimestamp).toBe("2026-09-16T10:05:00.000Z");
    });

    it("stops at the deadline before requesting another page", async () => {
      const { client, calls, tick } = makeClient((call, n) => {
        tick(10_000);
        return page([{ ListingId: `MFR${n}` }], { "@odata.nextLink": `https://api.mlsgrid.com/v2/Property?next=${n + 1}` });
      });
      const result = await client.fetchActive({ deadline: 1_000_000 + 15_000 });
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(result.truncated).toBe(true);
      expect(result.pages).toBe(calls.length);
    });
  });
});
