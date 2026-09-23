// The same photograph twice in one gallery, found by looking at the
// pictures. Builders file one picture at several sizes and crops under
// names a rule cannot always pair: Medallion's "ra_aruba-ii_a_3_car_02-
// 800x534.jpg" and "…-1200x801.jpg" side by side, SimplyDwell's
// "Elevation-A-1200x720-1.webp" leading a gallery and "Elevation-A-scaled-
// 1.webp" at its end. Jeff wants each photograph shown once (2026-09-23).
// Asked for from the edit overlay's "Sort the photos", beside the room
// labels (photo-rooms.ts); the gallery as a whole is compared, so the
// answer is not remembered picture by picture the way a room is.
//
// What decides is the picture, never its caption or its name: two photos
// captioned differently are still one photo shown twice (Jeff,
// 2026-09-23). Three things are asked:
//   - its pixels: each picture's fingerprint (a difference hash of it
//     shrunk to 9×8), which a copy at another size or quality keeps;
//   - its file: one upload however spelled or sized (fileKey);
//   - Claude, which looks at the whole gallery and can see a crop the
//     fingerprint cannot. Claude found none of Medallion's four pairs
//     of one rendering at two sizes on its own, and on one run called
//     two different SimplyDwell pictures one (2026-09-23), so what it
//     reports is taken only where the fingerprints are close as well.

import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { logger } from "@/lib/shared/logger";
import { askedSize, pictureKey } from "@/lib/floorplans/extractors/plan-page";
import { fetchImage } from "@/lib/floorplans/media";

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
  description: "Report what each picture shows, then the pictures that are the same photograph.",
  input_schema: {
    type: "object" as const,
    properties: {
      pictures: {
        type: "array",
        items: {
          type: "object",
          properties: { n: { type: "integer" }, shows: { type: "string" } },
          required: ["n", "shows"],
        },
        description:
          "Every picture in order: its number, and a few words on what it shows, from where, and a detail that tells it apart from the others",
      },
      same: {
        type: "array",
        items: { type: "array", items: { type: "integer" } },
        description:
          "One entry per photograph that appears more than once: the numbers of every picture that is that photograph. Empty when every picture is a different photograph.",
      },
    },
    required: ["pictures", "same"],
  },
};

const PROMPT =
  `These are the numbered pictures of one new home's photo gallery. Some may be the same photograph more than once: the same shot at another size, cropped a little differently, or saved again in another format. Find those.\n\n` +
  `First look at each picture closely and say in a few words what it shows, from where, and a detail that tells it apart. Then compare every picture with every other. ` +
  `Pictures that are one photograph show the same scene from the same spot: the same furniture in the same places, the same light, the same sky; one may be larger, smaller or cut down at its edges. ` +
  `Two shots of the same room from another angle or at another moment are different photographs. So are two different elevations (designs) of the house, which differ in roof, windows, colours or materials, and a daytime and a dusk shot of the same front. ` +
  `The same elevation rendering at two sizes is one photograph.\n\n` +
  `Report each set of numbers that are one photograph, and none when every picture is a different photograph.`;

/** A picture Claude can look at: not a drawing's .svg, nor a format it does not read. */
const readable = (url: string) => !/\.(svg|avif|heic|tiff?|bmp)(?:[?#]|$)/i.test(url);

/** One request: the sets of these pictures that are one photograph, as positions in `urls`, and what Claude said each shows. */
async function sameIn(urls: string[]): Promise<{ same: number[][]; shows: string[] }> {
  const content: Anthropic.ContentBlockParam[] = [{ type: "text", text: PROMPT }];
  urls.forEach((url, i) => {
    content.push({ type: "text", text: `Picture ${i + 1}:` });
    content.push({ type: "image", source: { type: "url", url } });
  });
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 16_000,
    // Telling one shot from a near one is closer work than naming a room.
    output_config: { effort: "high" },
    tools: [SAME_TOOL],
    tool_choice: { type: "tool", name: SAME_TOOL.name },
    messages: [{ role: "user", content }],
  });
  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const input = (toolUse?.input ?? {}) as { same?: unknown; pictures?: { n?: unknown; shows?: unknown }[] };
  const shows = urls.map((_, i) => {
    const said = Array.isArray(input.pictures) ? input.pictures.find((p) => Number(p?.n) === i + 1) : undefined;
    return typeof said?.shows === "string" ? said.shows : "";
  });
  return { same: sameFromAnswer(input.same, urls.length), shows };
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

/** Claude's sets across the gallery, in batches it can see at once; `checked` is false where a request failed. */
async function claudeSets(urls: string[]): Promise<{ same: number[][]; shows: string[]; checked: boolean }> {
  const lookable = urls.map((url, at) => ({ url, at })).filter(({ url }) => readable(url));
  const same: number[][] = [];
  const shows = urls.map(() => "");
  let checked = true;
  for (let i = 0; i < lookable.length; i += AT_ONCE) {
    const batch = lookable.slice(i, i + AT_ONCE);
    if (batch.length < 2) continue;
    try {
      const answer = await sameIn(batch.map((p) => p.url));
      for (const set of answer.same) same.push(set.map((n) => batch[n].at));
      answer.shows.forEach((said, n) => (shows[batch[n].at] = said));
    } catch (err) {
      checked = false;
      logger.warn("Photos could not be compared for duplicates", {
        count: batch.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { same, shows, checked };
}

/** Pictures fingerprinted at once. */
const PRINTING = 6;

/**
 * A picture's fingerprint: 64 bits, each whether a pixel of the picture
 * shrunk to 9×8 in grey is brighter than its right-hand neighbour. A copy
 * at another size or quality keeps nearly all of them; another photograph
 * keeps about half. Null when the picture cannot be fetched or read.
 */
async function printOf(url: string): Promise<string | null> {
  const fetched = await fetchImage(url);
  if (!fetched) return null;
  try {
    const { data } = await sharp(Buffer.from(fetched.data))
      .rotate()
      .flatten({ background: "#ffffff" })
      .grayscale()
      .resize(9, 8, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let bits = "";
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += data[y * 9 + x] > data[y * 9 + x + 1] ? "1" : "0";
    return bits;
  } catch {
    return null;
  }
}

/** How many of two fingerprints' 64 bits differ. Exported for tests. */
export function printDistance(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/** Fingerprints this close are one photograph, whatever anyone says: a copy at another size or quality. */
export const SAME_PRINT = 6;
/** Fingerprints this close may be one photograph cut down a little: taken as one where Claude says so. */
export const NEAR_PRINT = 22;

/**
 * The pairs that are one photograph: the fingerprints alone where they
 * all but match, and Claude's sets where the fingerprints are near too.
 * A pair whose fingerprints are far apart, or that could not be
 * fingerprinted, is not taken on Claude's word. Pure; exported for tests.
 */
export function confirmedSame(prints: (string | null)[], claude: number[][]): { same: number[][]; rejected: number[][] } {
  const same: number[][] = [];
  const rejected: number[][] = [];
  const near = (i: number, j: number, most: number) => {
    const [a, b] = [prints[i], prints[j]];
    return a != null && b != null && printDistance(a, b) <= most;
  };
  for (let i = 0; i < prints.length; i++) for (let j = i + 1; j < prints.length; j++) if (near(i, j, SAME_PRINT)) same.push([i, j]);
  for (const set of claude) {
    for (let k = 1; k < set.length; k++) (near(set[0], set[k], NEAR_PRINT) ? same : rejected).push([set[0], set[k]]);
  }
  return { same, rejected };
}

export interface SamePhotos {
  /** Pairs and sets that are one photograph, as positions in the gallery. */
  same: number[][];
  /** Whether Claude looked; false where a request failed. */
  checked: boolean;
  /** Sets Claude named that the fingerprints did not bear out. */
  rejected: number[][];
  /** What Claude said each picture shows. */
  shows: string[];
  prints: (string | null)[];
}

/**
 * The sets of a gallery's pictures that are one photograph, as positions
 * in `urls`: by their fingerprints and by Claude looking at them together
 * (confirmedSame). Nothing is taken out on a look that did not happen.
 */
export async function samePhotos(urls: string[]): Promise<SamePhotos> {
  const prints: (string | null)[] = new Array(urls.length).fill(null);
  let next = 0;
  const printing = Promise.all(
    Array.from({ length: Math.min(PRINTING, urls.length) }, async () => {
      while (next < urls.length) {
        const i = next++;
        prints[i] = await printOf(urls[i]);
      }
    })
  );
  const [claude] = await Promise.all([claudeSets(urls), printing]);
  const { same, rejected } = confirmedSame(prints, claude.same);
  return { same, checked: claude.checked, rejected, shows: claude.shows, prints };
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
