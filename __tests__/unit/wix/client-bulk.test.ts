import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WIX_BULK_LIMIT,
  WIX_BULK_MAX_BYTES,
  WixApiError,
  bulkInsertItems,
  bulkRemoveItems,
  bulkSaveItems,
  bulkUpdateItems,
  chunkBulkEntries,
  insertItem,
} from "@/lib/wix/client";

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

type Responder = (body: Record<string, unknown>) => Response;

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Answers a bulk request with one successful result per submitted entry. */
function echoBulk(action: (entry: unknown) => string): Responder {
  return (body) => {
    const entries = (body.dataItems ?? body.dataItemIds ?? []) as unknown[];
    return jsonResponse({
      results: entries.map((entry, originalIndex) => {
        const item = entry as { id?: string; data?: { _id?: string } };
        const id =
          typeof entry === "string" ? entry : (item.id ?? item.data?._id ?? `generated-${originalIndex}`);
        return { action: action(entry), itemMetadata: { id, originalIndex, success: true } };
      }),
      bulkActionMetadata: { totalSuccesses: entries.length, totalFailures: 0 },
    });
  };
}

describe("wix client bulk writes", () => {
  const calls: RecordedCall[] = [];
  let respond: Responder;

  beforeEach(() => {
    calls.length = 0;
    process.env.WIX_API_KEY = "test-key";
    respond = echoBulk(() => "INSERT");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
        calls.push({ url, headers: init.headers as Record<string, string>, body });
        return respond(body);
      })
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts to the bulk insert endpoint with the site header and merges chunked results", async () => {
    const items = Array.from({ length: WIX_BULK_LIMIT + 5 }, (_, i) => ({ _id: `MFR${i}`, price: i }));

    const result = await bulkInsertItems("site-1", "HousesforSale_Engine", items);

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://www.wixapis.com/wix-data/v2/bulk/items/insert");
    expect(calls[0].headers["wix-site-id"]).toBe("site-1");
    expect(calls[0].headers.authorization).toBe("test-key");
    expect(calls[0].body.dataCollectionId).toBe("HousesforSale_Engine");
    expect(calls[0].body.returnEntity).toBeUndefined();
    expect(calls[0].body.publishPluginOptions).toBeUndefined();
    expect(calls[0].body.dataItems).toHaveLength(WIX_BULK_LIMIT);
    expect(calls[1].body.dataItems).toHaveLength(5);
    // A caller-supplied _id rides as dataItem.id too (Wix rejects a mismatch).
    expect(calls[0].body.dataItems).toEqual(
      expect.arrayContaining([{ id: "MFR0", data: { _id: "MFR0", price: 0 } }])
    );

    expect(result.requests).toBe(2);
    expect(result.totalSuccesses).toBe(WIX_BULK_LIMIT + 5);
    expect(result.totalFailures).toBe(0);
    expect(result.results).toHaveLength(WIX_BULK_LIMIT + 5);
    // Indexes are relative to the caller's array, not to the chunk.
    expect(result.results[WIX_BULK_LIMIT + 4]).toMatchObject({
      originalIndex: WIX_BULK_LIMIT + 4,
      id: `MFR${WIX_BULK_LIMIT + 4}`,
      success: true,
      action: "INSERT",
    });
  });

  it("marks draft inserts and passes returnEntity through", async () => {
    const result = await bulkInsertItems("site-1", "col", [{ name: "a" }], {
      asDraft: true,
      returnEntity: true,
    });

    expect(calls[0].body.returnEntity).toBe(true);
    expect(calls[0].body.dataItems).toEqual([{ data: { name: "a", _publishStatus: "DRAFT" } }]);
    expect(result.results[0].id).toBe("generated-0");
  });

  it("single insert sends dataItem.id only when the caller supplied an _id", async () => {
    respond = (body) => {
      const item = body.dataItem as { id?: string; data: Record<string, unknown> };
      return jsonResponse({ dataItem: { id: item.id ?? "generated", dataCollectionId: "col", data: item.data } });
    };

    const keyedItem = await insertItem("site-1", "col", { _id: "MFRA1", price: 1 });
    const generated = await insertItem("site-1", "col", { price: 2 });

    expect(calls[0].url).toBe("https://www.wixapis.com/wix-data/v2/items");
    expect(calls[0].body.dataItem).toEqual({ id: "MFRA1", data: { _id: "MFRA1", price: 1 } });
    expect(calls[1].body.dataItem).toEqual({ data: { price: 2 } });
    expect(keyedItem.id).toBe("MFRA1");
    expect(generated.id).toBe("generated");
  });

  it("bulk update sends the id beside the data and can include drafts", async () => {
    respond = echoBulk(() => "UPDATE");

    const result = await bulkUpdateItems(
      "site-1",
      "col",
      [{ _id: "MFRA1", price: 2 }],
      { includeDrafts: true }
    );

    expect(calls[0].url).toBe("https://www.wixapis.com/wix-data/v2/bulk/items/update");
    expect(calls[0].body.publishPluginOptions).toEqual({ includeDraftItems: true });
    expect(calls[0].body.dataItems).toEqual([{ id: "MFRA1", data: { _id: "MFRA1", price: 2 } }]);
    expect(result.results[0]).toMatchObject({ id: "MFRA1", success: true, action: "UPDATE" });
  });

  it("bulk save keeps caller ids and reports the action Wix chose", async () => {
    respond = echoBulk((entry) => ((entry as { id?: string }).id ? "UPDATE" : "INSERT"));

    const result = await bulkSaveItems("site-1", "col", [{ _id: "MFRA1", price: 1 }, { price: 2 }]);

    expect(calls[0].url).toBe("https://www.wixapis.com/wix-data/v2/bulk/items/save");
    expect(calls[0].body.dataItems).toEqual([
      { id: "MFRA1", data: { _id: "MFRA1", price: 1 } },
      { data: { price: 2 } },
    ]);
    expect(result.results.map((r) => r.action)).toEqual(["UPDATE", "INSERT"]);
  });

  it("bulk remove posts the ids", async () => {
    respond = echoBulk(() => "DELETE");

    const result = await bulkRemoveItems("site-1", "col", ["MFRA1", "MFRA2"]);

    expect(calls[0].url).toBe("https://www.wixapis.com/wix-data/v2/bulk/items/remove");
    expect(calls[0].body).toEqual({ dataCollectionId: "col", dataItemIds: ["MFRA1", "MFRA2"] });
    expect(result.totalSuccesses).toBe(2);
    expect(result.results.map((r) => r.id)).toEqual(["MFRA1", "MFRA2"]);
  });

  it("does not call the API for an empty batch", async () => {
    const result = await bulkInsertItems("site-1", "col", []);

    expect(calls).toHaveLength(0);
    expect(result).toEqual({
      results: [],
      totalSuccesses: 0,
      totalFailures: 0,
      undetailedFailures: 0,
      requests: 0,
    });
  });

  it("surfaces per-item failures without throwing", async () => {
    respond = () =>
      jsonResponse({
        results: [
          { action: "INSERT", itemMetadata: { id: "MFRA1", originalIndex: 0, success: true } },
          {
            action: "INSERT",
            itemMetadata: {
              id: "MFRA2",
              originalIndex: 1,
              success: false,
              error: { code: "ITEM_ALREADY_EXISTS", description: "already there" },
            },
          },
        ],
        bulkActionMetadata: { totalSuccesses: 1, totalFailures: 1 },
      });

    const result = await bulkInsertItems("site-1", "col", [{ _id: "MFRA1" }, { _id: "MFRA2" }]);

    expect(result.totalSuccesses).toBe(1);
    expect(result.totalFailures).toBe(1);
    expect(result.results[1]).toMatchObject({
      id: "MFRA2",
      success: false,
      error: { code: "ITEM_ALREADY_EXISTS" },
    });
  });

  it("chunks by serialized size as well as by count", () => {
    const big = { _id: "x", description: "y".repeat(300_000) };
    const chunks = chunkBulkEntries([big, big, big, { _id: "small" }]);
    expect(chunks.map((c) => [c.start, c.entries.length])).toEqual([[0, 2], [2, 2]]);
    expect(chunks.every((c) => Buffer.byteLength(JSON.stringify(c.entries)) < WIX_BULK_MAX_BYTES + 100)).toBe(true);
    expect(chunkBulkEntries([], 10, 10)).toEqual([]);
  });

  it("halves a chunk Wix calls too large and keeps the caller's indexes", async () => {
    const ok = echoBulk(() => "UPDATE");
    respond = (body) => {
      const entries = (body.dataItems ?? []) as unknown[];
      if (entries.length > 2) {
        return jsonResponse({ message: "WDE0109: Payload is too large.", details: { applicationError: { code: "WDE0109" } } }, 400);
      }
      return ok(body);
    };
    const items = Array.from({ length: 7 }, (_, i) => ({ _id: `MFR${i}` }));

    const result = await bulkSaveItems("site-1", "col", items);

    // 7 -> refused; 4 + 3 -> refused; 2 + 2 + 2 + 1 -> accepted: 3 refusals and 4 writes.
    expect(result.requests).toBe(7);
    expect(result.totalSuccesses).toBe(7);
    expect(result.totalFailures).toBe(0);
    expect(result.results.map((r) => [r.originalIndex, r.id])).toEqual(items.map((item, i) => [i, item._id]));
  });

  it("reports a single item Wix refuses as that item's failure", async () => {
    respond = (body) => {
      const entries = (body.dataItems ?? []) as Array<{ id?: string }>;
      if (entries.some((e) => e.id === "MFRHUGE")) {
        return jsonResponse({ message: "WDE0109: Payload is too large." }, 400);
      }
      return echoBulk(() => "INSERT")(body);
    };

    const result = await bulkInsertItems("site-1", "col", [{ _id: "MFRA1" }, { _id: "MFRHUGE" }, { _id: "MFRA3" }]);

    expect(result.totalSuccesses).toBe(2);
    expect(result.totalFailures).toBe(1);
    expect(result.results.map((r) => [r.originalIndex, r.success])).toEqual([[0, true], [1, false], [2, true]]);
    expect(result.results[1].error?.code).toBe("WDE0109");
  });

  it("throws a WixApiError carrying the retry-after on a 429", async () => {
    respond = () => jsonResponse({ message: "throttled" }, 429, { "retry-after": "7" });

    const attempt = bulkInsertItems("site-1", "col", [{ _id: "MFRA1" }]);

    await expect(attempt).rejects.toBeInstanceOf(WixApiError);
    await attempt.catch((error: WixApiError) => {
      expect(error.status).toBe(429);
      expect(error.rateLimited).toBe(true);
      expect(error.retryAfterSeconds).toBe(7);
    });
  });
});
