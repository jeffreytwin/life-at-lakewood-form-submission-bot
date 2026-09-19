// Gallery ordering: the order the sites show a plan's photos in (Jeff,
// 2026-09-18): the primary picture, kitchen, living room, dining room,
// pool and lanai, office, hallways, stairs, bedrooms, bathrooms, laundry,
// closets, then the extra exterior options. This first pass reads the room
// off what the builder already says about a photo: its caption, its title,
// the words in its file name. A photo none of that places keeps its page
// order, after the rooms that were placed and before the exteriors. A
// vision pass can later fill `room` for those and reuse the same sort.

import { ROOM_ORDER, type GalleryMeta, type Room } from "@/lib/floorplans/types";

export interface GalleryInput {
  src: string;
  caption?: string | null;
  kind?: GalleryMeta["kind"];
  /** A room the builder named outright (DRB types its images, for example); beats the keyword reading. */
  room?: Room | null;
}

/**
 * The order of the checks matters: "owner's bath" is a bathroom before it
 * is a bedroom, "outdoor living" is outdoor before it is living, and a
 * "front porch" is outdoor before it is a front.
 */
const ROOM_KEYWORDS: [Room, RegExp][] = [
  ["outdoor", /\b(lanai|pool|patio|outdoor|terrace|veranda|porch|backyard|back yard|deck|summer kitchen)\b/i],
  ["laundry", /\b(laundry|utility room|mud ?room)\b/i],
  ["closet", /\b(closet|closets|wardrobe|walk-in)\b/i],
  ["bathroom", /\b(bath|baths|bathroom|bathrooms|shower|tub|powder room|vanity|vanities)\b/i],
  ["kitchen", /\b(kitchen|kitchens|pantry|center island|kitchen island|breakfast bar)\b/i],
  ["dining", /\b(dining|caf[eé]|breakfast|nook|eat-in)\b/i],
  ["living", /\b(great room|great rooms|living|family room|gathering|lounge|open-concept|open concept)\b/i],
  ["office", /\b(office|study|den|library|flex room|flex space)\b/i],
  ["stairs", /\b(stair|stairs|staircase|stairway|landing)\b/i],
  ["hallway", /\b(hall|hallway|foyer|entry|entryway|entrance)\b/i],
  ["bedroom", /\b(bedroom|bedrooms|bed|owner'?s? suite|primary suite|master suite|guest suite|suite)\b/i],
  ["exterior", /\b(exterior|exteriors|elevation|elevations|front|facade|curb|garage|streetscape|rendering)\b/i],
];

/** The words a file name carries, for builders that name photos by room ("cascadia-kitchen-4.jpeg", "02_KitchenDining.jpg"). */
export function fileNameWords(src: string): string {
  try {
    const last = decodeURIComponent(new URL(src).pathname.split("/").pop() ?? "");
    return last
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[^a-zA-Z]+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

/** The room a caption, title or file name names, or null when it names none. */
export function classifyRoom(text: string): Room | null {
  for (const [room, re] of ROOM_KEYWORDS) if (re.test(text)) return room;
  return null;
}

export interface OrderedGallery {
  urls: string[];
  meta: Record<string, GalleryMeta>;
}

/**
 * Orders gallery images by room and records what was known about each.
 * The primary picture leads whatever position it came in; exteriors trail.
 * Duplicated URLs keep their first appearance. The sort is stable, so
 * photos of the same room, and photos of no known room, keep page order.
 */
export function orderGallery(items: GalleryInput[]): OrderedGallery {
  const seen = new Set<string>();
  const entries: { src: string; rank: number; meta: GalleryMeta }[] = [];
  for (const item of items) {
    if (!item.src || seen.has(item.src)) continue;
    seen.add(item.src);
    const kind = item.kind ?? "photo";
    let room: Room | null;
    if (kind === "primary") room = "primary";
    else if (kind === "exterior") room = "exterior";
    else room = item.room ?? classifyRoom(`${item.caption ?? ""} ${fileNameWords(item.src)}`);
    entries.push({
      src: item.src,
      rank: ROOM_ORDER.indexOf(room ?? "other"),
      meta: { caption: item.caption?.trim() || null, room, kind },
    });
  }
  entries.sort((a, b) => a.rank - b.rank);
  return {
    urls: entries.map((e) => e.src),
    meta: Object.fromEntries(entries.map((e) => [e.src, e.meta])),
  };
}
