// What room each of a plan's photos shows, read from the picture itself.
//
// The gallery order the sites use (gallery-order.ts) needs to know what a
// photo shows, and until now that could only be read off the file name or a
// caption. Plenty of builders give neither — SimplyDwell's are
// "4638-8-scaled-1.webp", Stock's are a media store's UUID — so those
// galleries came through in page order and Jeff arranged them by hand
// (2026-09-22). This asks Claude to look at the pictures instead, from a
// button in the Hub's edit overlay rather than on every sync: it costs a
// request per picture-ful of gallery, so it is asked for, not assumed.
//
// A picture is looked at once, ever: the answer is kept by its URL
// (fp_photo_rooms, migration 073) and every later plan that shows the same
// picture reads it from there.

import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { ROOM_ORDER, type GalleryMeta, type NormalizedPlan, type Room } from "@/lib/floorplans/types";
import { orderGallery, type GalleryInput, type OrderedGallery } from "@/lib/floorplans/gallery-order";
import { askableBatches } from "@/lib/floorplans/media";
import { fetchPictures, imageBlock } from "@/lib/floorplans/claude-image";

const MODEL = "claude-opus-5";

/**
 * How many pictures go in one request. Small enough that the answers stay
 * lined up with the pictures they are for, big enough that a gallery of
 * thirty is two requests, not thirty.
 */
const BATCH = 15;

/** Pictures asked about at once, so a gallery of thirty does not wait on one request after another. */
const PARALLEL = 3;

/**
 * What a picture can show. Every one but "front" is a room the gallery
 * order already knows (ROOM_ORDER); "front" is the one picture that leads —
 * the house from the street — which is a position rather than a room.
 */
export const PHOTO_LABELS = ["front", ...ROOM_ORDER.filter((r) => r !== "primary")] as const;
export type PhotoLabel = (typeof PHOTO_LABELS)[number];

const isLabel = (value: unknown): value is PhotoLabel => PHOTO_LABELS.includes(value as PhotoLabel);

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
    client = new Anthropic({ apiKey });
  }
  return client;
}

const LOOK_TOOL: Anthropic.Tool = {
  name: "report_rooms",
  description: "Report what each of the numbered pictures shows.",
  input_schema: {
    type: "object" as const,
    properties: {
      rooms: {
        type: "array",
        items: { type: "string", enum: [...PHOTO_LABELS] },
        description:
          "One entry per picture, in the order the pictures were given, and the same number of entries as there were pictures",
      },
    },
    required: ["rooms"],
  },
};

const PROMPT =
  `These are photographs of one new home, in no particular order. Say what each one shows, one answer per picture, in the order they are given.\n\n` +
  `Use "front" only for a picture of the front of the house seen from the street — the one a listing would lead with — whether a photograph or a rendering. ` +
  `Use "exterior" for any other outside view: the back of the house, an aerial, a streetscape, an alternative elevation, a floor plan drawing. ` +
  `Use "outdoor" for a lanai, pool, patio or summer kitchen — an outdoor room of this house rather than a view of the building. ` +
  `Use "living" for a great room or family room, "office" for a study or den, "hallway" for a foyer or entry. ` +
  `Use "other" when the picture is of this home but none of the rooms fits, and when you cannot tell.\n\n` +
  `Answer for every picture. Do not leave one out and do not add one.`;

/**
 * One request: what each of these pictures shows, in the order given. The
 * pictures are fetched here and sent whole (claude-image.ts): Anthropic's
 * own fetcher is turned away by Dream Finders' robots.txt.
 */
async function lookAt(urls: string[]): Promise<(PhotoLabel | null)[]> {
  const pictures = await fetchPictures(urls);
  const content: Anthropic.ContentBlockParam[] = [{ type: "text", text: PROMPT }];
  urls.forEach((url, i) => {
    content.push({ type: "text", text: `Picture ${i + 1}:` });
    content.push(imageBlock(url, pictures[i]));
  });

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 16_000,
    // Naming a room from a photograph is not deep work; the pictures are.
    output_config: { effort: "low" },
    tools: [LOOK_TOOL],
    tool_choice: { type: "tool", name: LOOK_TOOL.name },
    messages: [{ role: "user", content }],
  });

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const rooms = (toolUse?.input as { rooms?: unknown } | undefined)?.rooms;
  const answers = Array.isArray(rooms) ? rooms : [];
  // A picture with no answer of its own stays unplaced rather than taking
  // the next picture's: an answer only counts where it lines up.
  return urls.map((_, i) => (isLabel(answers[i]) ? answers[i] : null));
}

/** Runs `fn` over the items a few at a time, keeping order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

/** The pictures split into requests of at most BATCH. Exported for tests. */
export function batches<T>(items: T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * What was learned before about each of these pictures, without looking at
 * any: only the remembered answers, so it costs a read and nothing else. A
 * picture never looked at is absent; one looked at and not placed is null.
 */
export async function rememberedRooms(urls: string[]): Promise<Map<string, PhotoLabel | null>> {
  const wanted = urls.filter((url, i) => url && urls.indexOf(url) === i);
  const known = new Map<string, PhotoLabel | null>();
  // Asked for in batches an address can carry: a filter travels in the
  // address, and a gateway answers "Bad Request" to one too long, which
  // would quietly cost a second look at every picture (Jeff, 2026-09-22).
  for (const batch of askableBatches(wanted)) {
    const { data: cached, error } = await supabase
      .from("fp_photo_rooms")
      .select("source_url, room")
      .in("source_url", batch);
    if (error) logger.warn("Remembered photo rooms could not be read", { error: error.message });
    for (const row of cached ?? []) known.set(row.source_url, isLabel(row.room) ? row.room : null);
  }
  return known;
}

/**
 * What each picture shows: from what was learned about it before, else by
 * looking at it now and remembering the answer. A picture Claude cannot
 * place is remembered as unplaced, so it is not paid for twice.
 */
export async function labelPhotos(urls: string[], parallel = PARALLEL): Promise<Map<string, PhotoLabel | null>> {
  const wanted = urls.filter((url, i) => url && urls.indexOf(url) === i);
  const known = await rememberedRooms(wanted);
  const fresh = wanted.filter((url) => !known.has(url));
  if (!fresh.length) return known;

  // A request that failed says nothing about its pictures — an empty
  // account, a timeout — so they are not remembered, and are looked at
  // again next time rather than filed as unplaced for good.
  const looked = await mapLimit(batches(fresh), parallel, async (batch) => {
    try {
      return await lookAt(batch);
    } catch (err) {
      logger.warn("Photos could not be looked at", {
        count: batch.length,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  });

  const rows: { source_url: string; room: PhotoLabel | null; model: string }[] = [];
  batches(fresh).forEach((batch, b) => {
    const answers = looked[b];
    if (!answers) return;
    batch.forEach((url, i) => {
      const room = answers[i] ?? null;
      known.set(url, room);
      rows.push({ source_url: url, room, model: MODEL });
    });
  });
  if (rows.length) {
    const { error: writeError } = await supabase
      .from("fp_photo_rooms")
      .upsert(rows, { onConflict: "source_url" });
    if (writeError) logger.warn("Photo rooms could not be remembered", { error: writeError.message });
  }
  return known;
}

/**
 * The gallery in the order the sites show it, using what the pictures
 * themselves say: the front of the house leads, the rooms follow in the
 * site's order, the other outside views go last (gallery-order.ts). A
 * picture nothing could be read from keeps its place among the unplaced,
 * and where nothing at all could be read the gallery is returned as it
 * came. Pure.
 *
 * Where no picture was called the front, the first outside view leads,
 * in the order the gallery came: never a room. Pulte's homes open on
 * "Exterior Rendering; Elevation CO1", which Claude called an outside view
 * rather than the front, and with nothing to lead them the kitchen did,
 * and a quick move-in shows the site its first picture alone (Jeff,
 * 2026-09-23).
 */
export function sortByRooms(urls: string[], labels: Map<string, PhotoLabel | null>): OrderedGallery {
  const lead = urls.find((src) => labels.get(src) === "front") ?? urls.find((src) => labels.get(src) === "exterior");
  const items: GalleryInput[] = urls.map((src) => {
    const label = labels.get(src) ?? null;
    if (src === lead) return { src, kind: "primary" as const };
    // Another picture of the front is an alternative elevation, like any other outside view.
    if (label === "front" || label === "exterior") return { src, kind: "exterior" as const };
    return { src, room: label as Room | null };
  });
  return orderGallery(items);
}

/**
 * Whether a gallery leads with a room while it holds an outside view of
 * the house: sorted before sortByRooms fell back to the first outside
 * view, it is sorted again. Exported for tests.
 */
export function leadsWithARoom(plan: Pick<NormalizedPlan, "galleryImages" | "galleryMeta">): boolean {
  const urls = plan.galleryImages ?? [];
  const label = (url: string) => labelFromMeta(plan.galleryMeta?.[url]);
  const first = urls.length ? label(urls[0]) : null;
  return Boolean(first && first !== "front" && first !== "exterior") && urls.slice(1).some((url) => label(url) === "exterior" || label(url) === "front");
}

/**
 * What a gallery already says about a picture nobody has looked at, in the
 * labels' terms: the lead is the front, an elevation is an outside view, a
 * room read off a caption or a file name is that room. Exported for tests.
 */
export function labelFromMeta(meta: GalleryMeta | undefined): PhotoLabel | null {
  if (!meta) return null;
  if (meta.kind === "primary") return "front";
  if (meta.kind === "exterior" || meta.room === "exterior") return "exterior";
  if (!meta.room || meta.room === "primary" || meta.room === "other") return null;
  return meta.room;
}

/**
 * A plan's photos in the site's order, using what has been learned by
 * looking at them (fp_photo_rooms), and what the gallery already said for
 * the pictures nobody has looked at yet. A plan none of whose pictures has
 * been looked at comes back as it was. Pure, and the same every run for the
 * same answers — the diff compares galleries in order, so an order that
 * moved from one run to the next would be proposed as a change every night.
 */
export function withLookedAtRooms(plan: NormalizedPlan, looked: Map<string, PhotoLabel | null>): NormalizedPlan {
  const urls = plan.galleryImages;
  if (urls.length < 2 || !urls.some((url) => looked.get(url))) return plan;
  // A picture seen to be the front outranks one only presumed to be: Pulte
  // led 12510 Adobe Street with a "Peace of Mind" graphic its feed ranked
  // first, and put "Elevation C1" last (2026-09-23).
  const seenFront = urls.some((url) => looked.get(url) === "front");
  const presumed = (url: string) => {
    const label = labelFromMeta(plan.galleryMeta?.[url]);
    if (label === "front" && seenFront) return null;
    // The builder's own lead, not looked at yet, keeps the lead until it
    // is: Meritage gave 7733 Satterfield Ter a new front photo, and ordered
    // among photos already looked at, the one not yet seen went to the
    // back and the kitchen led the home (Jeff, 2026-09-25).
    if (!label && url === urls[0] && !seenFront && looked.get(url) == null) return "front";
    return label;
  };
  const labels = new Map(urls.map((url) => [url, looked.get(url) ?? presumed(url)] as const));
  const ordered = sortByRooms(urls, labels);
  const meta = Object.fromEntries(
    ordered.urls.map((url) => [url, { ...ordered.meta[url], caption: plan.galleryMeta?.[url]?.caption ?? null }])
  );
  return { ...plan, galleryImages: ordered.urls, galleryMeta: meta };
}

/** Whether most of a gallery's photos are placed already, so looking at them would buy little. Exported for tests. */
export function mostlyPlaced(plan: Pick<NormalizedPlan, "galleryImages" | "galleryMeta">): boolean {
  const urls = plan.galleryImages ?? [];
  if (urls.length < 3) return true;
  const unplaced = urls.filter((url) => !labelFromMeta(plan.galleryMeta?.[url])).length;
  return unplaced / urls.length < 0.25;
}
