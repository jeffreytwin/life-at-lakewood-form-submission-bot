import { beforeEach, describe, expect, it, vi } from "vitest";

type Item = { id: string; data: Record<string, unknown> };
const collections: Record<string, Item[]> = {};

vi.mock("@/lib/wix/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wix/client")>();
  return {
    ...actual,
    // Wix's read: drafts only when asked for, a title filter of $eq or $contains, paging.
    queryItems: vi.fn(async (_site: string, collectionId: string, options: { filter?: { title?: { $eq?: string; $contains?: string } }; limit?: number; offset?: number; includeDrafts?: boolean } = {}) => {
      let items = (collections[collectionId] ?? []).filter((it) => options.includeDrafts || it.data._publishStatus !== "DRAFT");
      const title = options.filter?.title;
      if (title?.$eq != null) items = items.filter((it) => it.data.title === title.$eq);
      if (title?.$contains != null) items = items.filter((it) => String(it.data.title).includes(title.$contains!));
      const offset = options.offset ?? 0;
      return { items: items.slice(offset, offset + (options.limit ?? 100)), total: items.length };
    }),
  };
});

import { referenceIdOf } from "@/lib/floorplans/writeback";

describe("referenceIdOf: the Builders and villages items a row points at", () => {
  beforeEach(() => {
    collections.Builders = [
      { id: "pulte", data: { title: "Pulte Homes", _publishStatus: "PUBLISHED" } },
      { id: "richmond", data: { title: "Richmond American Homes", _publishStatus: "DRAFT" } },
    ];
    collections.Villages = [
      { id: "dwe", data: { title: "Del Webb Explore" } },
      { id: "dws", data: { title: "Del Webb Sunchase" } },
      { id: "nrr", data: { title: "North River Ranch" } },
    ];
  });

  it("finds a builder Parrish keeps as a draft (Richmond American Homes)", async () => {
    expect(await referenceIdOf("parrish", "Builders", "Richmond American Homes")).toBe("richmond");
  });

  it("takes a published item over a draft of the same name", async () => {
    collections.Builders.unshift({ id: "pulte-draft", data: { title: "Pulte Homes", _publishStatus: "DRAFT" } });
    expect(await referenceIdOf("parrish-2", "Builders", "Pulte Homes")).toBe("pulte");
  });

  it("files a community under the neighborhood its name begins with (Del Webb Explore)", async () => {
    expect(await referenceIdOf("parrish", "Villages", "Del Webb Explore North River Ranch")).toBe("dwe");
    expect(await referenceIdOf("parrish", "Villages", "North River Ranch")).toBe("nrr");
    expect(await referenceIdOf("parrish", "Villages", "Riversong")).toBeNull();
  });
});
