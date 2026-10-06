import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "update", "delete", "in", "gte", "order", "limit", "match", "not", "is", "or"]) chain[m] = () => chain;
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.insert = async () => ({ error: null });
  chain.upsert = async () => ({ error: null });
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
  return { supabase: { from: () => chain } };
});
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => ({
        content: [{ type: "tool_use", id: "t1", name: "report_plan_page", input: { description: "A four bedroom home with a den." } }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "tool_use",
      }),
    };
  },
}));

import { isWilliamRyanPage, williamRyanPictures } from "@/lib/floorplans/extractors/william-ryan";
import { readPlanPageWithClaude } from "@/lib/floorplans/extractors/claude-extract";
import type { NormalizedPlan } from "@/lib/floorplans/types";

process.env.ANTHROPIC_API_KEY = "test";

// Plan 24777 in River Preserve Estates as its page carries it (2026-10-06):
// no <img> of the plan, every picture in the Next.js payload, escaped.
const media = (path: string) => `https://storage.googleapis.com/william-ryan-homes-com-media/${path}`;
const record = (id: number, path: string, seq: number, title?: string) =>
  `{\\"id\\":${id},\\"url\\":\\"${media(path)}\\",${title ? `\\"title\\":\\"${title}\\",` : ""}\\"seq\\":${seq}}`;
const elevations = [5060210, 5060211, 5060212];
const interiors = [1160464, 1160465, 1160466, 1160467, 1160468];
const carousel = [
  ...elevations.map((id, i) => record(id, `floorplan/24777/image/elevation-${id}.jpg`, i + 1)),
  ...interiors.map((id, i) => record(id, `floorplan/24777/image/interior-${id}.jpg`, i + 1)),
].join(",");
const styles = elevations.map((id, i) => record(id, `floorplan/24777/image/elevation-${id}.jpg`, i + 1, ["French Country", "Coastal", "Tuscan"][i])).join(",");
const pageUrl = "https://www.williamryanhomes.com/tampa/parrish/river-preserve-estates/floor-plans/24777";
const html = `<html><body>
  <img alt="William Ryan Homes - Making Homes Personal" src="/_next/static/media/logo.d1041f31.png"/>
  <h1>Maxine</h1>
  <p>${"A four bedroom, three bath home with a den, a lanai and a three car garage. ".repeat(10)}</p>
  <a href="${media("floorplan/24777/brochure/standard-5240170.pdf")}">Download floorplan brochure</a>
  <script>self.__next_f.push([1,"3a:{\\"image\\":\\"${media("division/3/image/osc_maxine.png")}\\"}\\n"])</script>
  <script>self.__next_f.push([1,"42:[\\"$\\",\\"div\\",null,{\\"className\\":\\"flex flex-col gap-2 px-0 pt-4 md:px-0\\",\\"children\\":[\\"$\\",\\"$L47\\",null,{\\"images\\":[${carousel}]}]}]\\n"])</script>
  <script>self.__next_f.push([1,"43:[[\\"$\\",\\"h2\\",null,{\\"children\\":\\"Elevation Styles\\"}],[\\"$\\",\\"$L47\\",null,{\\"images\\":[${styles}]}]]\\n"])</script>
  <script>self.__next_f.push([1,"44:{\\"imageUrl\\":\\"${media("floorplan/24778/image/elevation-4762938.jpg")}\\",\\"banner\\":\\"${media("community/1325/image/subdivisionbanner-1.jpg")}\\"}\\n"])</script>
</body></html>`;

const file = (url: string) => url.replace(/^.*\//, "");

describe("a William Ryan page's pictures (River Preserve Estates, Jeff 2026-10-06)", () => {
  it("knows William Ryan's pages", () => {
    expect(isWilliamRyanPage(pageUrl)).toBe(true);
    expect(isWilliamRyanPage("https://williamryanhomes.com/tampa")).toBe(true);
    expect(isWilliamRyanPage("https://www.ashtonwoods.com/tampa")).toBe(false);
    expect(isWilliamRyanPage(null)).toBe(false);
  });

  it("takes every picture filed under the plan, once each, in the page's order, its elevations as outside views", () => {
    const pictures = williamRyanPictures(html, pageUrl);
    expect(pictures.map((p) => file(p.src))).toEqual([
      ...elevations.map((id) => `elevation-${id}.jpg`),
      ...interiors.map((id) => `interior-${id}.jpg`),
    ]);
    expect(pictures[0].src).toBe(media("floorplan/24777/image/elevation-5060210.jpg"));
    expect(pictures.filter((p) => p.outside).map((p) => file(p.src))).toEqual(elevations.map((id) => `elevation-${id}.jpg`));
  });

  it("leaves the division's, the community's and another plan's pictures, and the brochure", () => {
    const srcs = williamRyanPictures(html, pageUrl).map((p) => p.src);
    expect(srcs.some((s) => /division|community|24778|brochure/.test(s))).toBe(false);
  });

  it("reads a home's page by its own number", () => {
    const home = html.replaceAll("floorplan/24777/image", "qmi/19051/image");
    const pictures = williamRyanPictures(home, "https://www.williamryanhomes.com/tampa/parrish/river-preserve-estates/quick-move-ins/19051");
    expect(pictures).toHaveLength(elevations.length + interiors.length);
    expect(williamRyanPictures(home, pageUrl)).toEqual([]);
  });

  it("takes nothing from a page that is not a plan's or a home's", () => {
    expect(williamRyanPictures(html, "https://www.williamryanhomes.com/tampa/parrish/river-preserve-estates")).toEqual([]);
  });

  it("gives the plan every picture, not only the one on the community's card", async () => {
    const plan: NormalizedPlan = {
      planKey: "maxine",
      name: "Maxine",
      price: 683_990,
      priceDisplay: "$683,990",
      beds: "4",
      baths: "3",
      sqft: 2_710,
      garages: "3",
      homeType: null,
      quickMoveIn: false,
      comingSoon: false,
      sourceUrl: pageUrl,
      galleryImages: [media("floorplan/24777/image/elevation-5060210.jpg")],
      blueprintImages: [],
      description: null,
    };
    const out = await readPlanPageWithClaude(plan, async (url) => ({ url, html }));
    expect(out.galleryImages.map(file).sort()).toEqual(
      [...elevations.map((id) => `elevation-${id}.jpg`), ...interiors.map((id) => `interior-${id}.jpg`)].sort()
    );
    expect(out.galleryMeta?.[media("floorplan/24777/image/elevation-5060211.jpg")]?.kind).toBe("exterior");
    expect(out.galleryMeta?.[media("floorplan/24777/image/interior-1160464.jpg")]?.kind).not.toBe("exterior");
  });
});
