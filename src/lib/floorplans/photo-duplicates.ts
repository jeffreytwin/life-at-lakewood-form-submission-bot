// The same photograph twice in one gallery, found by looking at the
// pictures. Builders file one picture at several sizes and crops under
// names a rule cannot always pair: Medallion's "ra_aruba-ii_a_3_car_02-
// 800x534.jpg" and "…-1200x801.jpg" side by side, SimplyDwell's
// "Elevation-A-1200x720-1.webp" leading a gallery and "Elevation-A-scaled-
// 1.webp" at its end. Jeff wants each photograph shown once (2026-09-23).
// Asked for from the edit overlay's "Sort the photos", beside the room
// labels (photo-rooms.ts); the gallery as a whole is compared, so the
// answer is not remembered picture by picture the way a room is.

import Anthropic from "@anthropic-ai/sdk";
import { logger } from "@/lib/shared/logger";
import { askedSize, pictureKey } from "@/lib/floorplans/extractors/plan-page";

const MODEL = "claude-opus-5";

/** Pictures compared in one request; a duplicate is found only among pictures seen together. */
const AT_ONCE = 60;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
    client = new Anthropic({ apiKey });
  }
  return client;
}

const SAME_TOOL: Anthropic.Tool = {
  name: "report_duplicates",
  description: "Report the pictures that are the same photograph.",
  input_schema: {
    type: "object" as const,
    properties: {
      same: {
        type: "array",
        items: { type: "array", items: { type: "integer" } },
        description:
          "One entry per photograph that appears more than once: the numbers of every picture that is that photograph. Empty when every picture is a different photograph.",
      },
    },
    required: ["same"],
  },
};

const PROMPT =
  `These are the numbered pictures of one new home's photo gallery. Some may be the same photograph more than once: the same shot at another size, cropped a little differently, or saved again in another format. Find those.\n\n` +
  `Two shots of the same room from another angle or at another moment are different photographs. So are two elevations (designs) of the house, however alike, and a daytime and a dusk shot of the same front. Report only pictures that are the same photograph.\n\n` +
  `Report each set of numbers that are one photograph, and none when every picture is a different photograph.`;

/** A picture Claude can look at: not a drawing's .svg, nor a format it does not read. */
const readable = (url: string) => !/\.(svg|avif|heic|tiff?|bmp)(?:[?#]|$)/i.test(url);

/** One request: the sets of these pictures that are one photograph, as positions in `urls`. */
async function sameIn(urls: string[]): Promise<number[][]> {
  const content: Anthropic.ContentBlockParam[] = [{ type: "text", text: PROMPT }];
  urls.forEach((url, i) => {
    content.push({ type: "text", text: `Picture ${i + 1}:` });
    content.push({ type: "image", source: { type: "url", url } });
  });
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 8_000,
    // Telling one shot from a near one is closer work than naming a room.
    output_config: { effort: "medium" },
    tools: [SAME_TOOL],
    tool_choice: { type: "tool", name: SAME_TOOL.name },
    messages: [{ role: "user", content }],
  });
  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  return sameFromAnswer((toolUse?.input as { same?: unknown } | undefined)?.same, urls.length);
}

/**
 * The sets an answer names, as positions: numbers that name no picture
 * are dropped, and a set left with fewer than two pictures says nothing.
 * Exported for tests.
 */
export function sameFromAnswer(same: unknown, count: number): number[][] {
  if (!Array.isArray(same)) return [];
  return same
    .filter(Array.isArray)
    .map((set: unknown[]) => [
      ...new Set(set.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= count).map((n) => n - 1)),
    ])
    .filter((set) => set.length >= 2);
}

/**
 * The sets of a gallery's pictures that are one photograph, as positions
 * in `urls`, by looking at them. `checked` is false when a request failed
 * (an empty account, a picture that would not load): nothing is taken out
 * on a look that did not happen.
 */
export async function samePhotos(urls: string[]): Promise<{ same: number[][]; checked: boolean }> {
  const lookable = urls.map((url, at) => ({ url, at })).filter(({ url }) => readable(url));
  const same: number[][] = [];
  let checked = true;
  for (let i = 0; i < lookable.length; i += AT_ONCE) {
    const batch = lookable.slice(i, i + AT_ONCE);
    if (batch.length < 2) continue;
    try {
      for (const set of await sameIn(batch.map((p) => p.url))) same.push(set.map((n) => batch[n].at));
    } catch (err) {
      checked = false;
      logger.warn("Photos could not be compared for duplicates", {
        count: batch.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { same, checked };
}

/**
 * How large a picture's address says it is: a size in its file's name
 * ("-1200x801"), WordPress's "-scaled" original, a width its query asks
 * for; a file that names no size is the original, as large as there is.
 */
function sizeOf(url: string): number {
  const file = url.replace(/[?#].*$/, "").split("/").pop() ?? "";
  const named = file.match(/-(\d{2,5})x(\d{2,5})(?=[-_.])/);
  if (named) return Math.max(Number(named[1]), Number(named[2]));
  if (/-scaled(?=[-_.])/i.test(file)) return 2560;
  return askedSize(url) || Infinity;
}

/**
 * One file however it is spelled (pictureKey), and whatever size WordPress
 * cut it to: "…_a_3_car_02-800x534.jpg" and "…-1200x801.jpg" are one
 * upload, and so are "Elevation-A-1200x720-1.webp" and
 * "Elevation-A-scaled-1.webp".
 */
const fileKey = (url: string) => pictureKey(url).replace(/-(?:\d{2,5}x\d{2,5}|scaled)(?=[-_.]|$)/gi, "");

/**
 * The gallery with each photograph once. Pictures that are one photograph
 * — the same file however spelled or sized (fileKey), or a set Claude
 * found — keep the place of the first of them, at the largest size any of
 * them is (sizeOf); the others are `removed`. Pure; exported for tests.
 */
export function withoutDuplicates(urls: string[], same: number[][]): { urls: string[]; removed: string[] } {
  const parent = urls.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a: number, b: number) => {
    const [x, y] = [find(a), find(b)];
    if (x !== y) parent[Math.max(x, y)] = Math.min(x, y);
  };
  const byKey = new Map<string, number>();
  urls.forEach((url, i) => {
    const key = fileKey(url);
    if (byKey.has(key)) join(byKey.get(key)!, i);
    else byKey.set(key, i);
  });
  for (const set of same) for (const i of set.slice(1)) if (urls[set[0]] != null && urls[i] != null) join(set[0], i);

  const members = new Map<number, number[]>();
  urls.forEach((_, i) => members.set(find(i), [...(members.get(find(i)) ?? []), i]));
  const kept: string[] = [];
  const removed: string[] = [];
  urls.forEach((url, i) => {
    const group = members.get(find(i))!;
    if (group[0] !== i) return;
    // The largest; of equals, the first.
    const best = group.reduce((a, b) => (sizeOf(urls[b]) > sizeOf(urls[a]) ? b : a));
    kept.push(urls[best]);
    removed.push(...group.filter((g) => g !== best).map((g) => urls[g]));
  });
  return { urls: kept, removed };
}
