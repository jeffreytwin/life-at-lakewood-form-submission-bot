// Cardel Homes: the plans are read off the community's page as for any
// builder (claude-extract.ts), but its homes for sale are not on that page
// at all. They sit on Florida's quick move-ins page, one tab per community,
// and the tabs are drawn from the data the page carries for its scripts —
// so a fetch of either page showed Claude no homes (North River Ranch,
// Jeff 2026-09-27: twelve plans came back and none of its ten homes).
//
// The data is a script's object literal (SvelteKit's), keyed by each
// community's slug:
//
//   "north-river-ranch":[{address:"10709 Wading River Ave Parrish, FL 34219 - Lot 17",
//     availability:"Move-in ready", bathrooms:2.5, bedrooms:3, squareFootage:2104,
//     name:"Sylvan Paired Home", poster:{src:{…}}, slug:"sylvan-paired-10709-…",
//     gallery:[…], pricing:{current:389990,previous:…}, status:"available", …}, …]
//
// and each home has its own page at /florida/<community>/quick-move-ins/<slug>.

import { extractWithClaude, type ClaudeExtractParams } from "@/lib/floorplans/extractors/claude-extract";
import { standardHomeType } from "@/lib/floorplans/standardize";
import { type NormalizedPlan, normKey } from "@/lib/floorplans/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
/** Where the data's relative picture paths ("public/galleries/…") live. */
const STORAGE = "https://storage.googleapis.com/cardel-website.appspot.com/";

/**
 * A script's object literal as a value: unquoted keys, strings, numbers,
 * arrays and objects. A name the script would look up elsewhere ("a", "new
 * Date(…)") reads as null. Returns the value and where it ends. Pure;
 * exported for tests.
 */
export function readLiteral(text: string, at: number): { value: unknown; end: number } {
  let i = at;
  const space = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const str = (): string => {
    const quote = text[i++];
    let out = "";
    while (i < text.length && text[i] !== quote) {
      if (text[i] === "\\") {
        const c = text[i + 1];
        if (c === "u") {
          out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
          i += 6;
          continue;
        }
        if (c === "x") {
          out += String.fromCharCode(parseInt(text.slice(i + 2, i + 4), 16));
          i += 4;
          continue;
        }
        out += ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" } as Record<string, string>)[c] ?? c;
        i += 2;
        continue;
      }
      out += text[i++];
    }
    i++;
    return out;
  };
  const value = (): unknown => {
    space();
    const c = text[i];
    if (c === '"' || c === "'") return str();
    if (c === "[") {
      i++;
      const list: unknown[] = [];
      for (;;) {
        space();
        if (text[i] === "]") {
          i++;
          return list;
        }
        list.push(value());
        space();
        if (text[i] === ",") i++;
      }
    }
    if (c === "{") {
      i++;
      const obj: Record<string, unknown> = {};
      for (;;) {
        space();
        if (text[i] === "}") {
          i++;
          return obj;
        }
        let key: string;
        if (text[i] === '"' || text[i] === "'") key = str();
        else {
          const m = /^[A-Za-z_$][\w$]*|^\d+/.exec(text.slice(i, i + 200));
          if (!m) throw new Error(`unreadable key at ${i}`);
          key = m[0];
          i += key.length;
        }
        space();
        if (text[i] !== ":") throw new Error(`expected ":" at ${i}`);
        i++;
        obj[key] = value();
        space();
        if (text[i] === ",") i++;
      }
    }
    const num = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(text.slice(i, i + 40));
    if (num) {
      i += num[0].length;
      return Number(num[0]);
    }
    const word = /^(?:void 0|new [A-Za-z_$][\w$.]*\([^)]*\)|[A-Za-z_$][\w$.]*(?:\([^)]*\))?)/.exec(text.slice(i, i + 200));
    if (!word) throw new Error(`unreadable value at ${i}`);
    i += word[0].length;
    return word[0] === "true" ? true : word[0] === "false" ? false : null;
  };
  const v = value();
  return { value: v, end: i };
}

export interface CardelHome {
  address?: string;
  availability?: string;
  bathrooms?: number;
  bedrooms?: number;
  squareFootage?: number;
  name?: string;
  slug?: string;
  status?: string;
  pricing?: { current?: number | null };
  poster?: { src?: Record<string, string> };
  gallery?: unknown[];
}

/** A community's homes as the quick move-ins page's data lists them. Exported for tests. */
export function homesIn(html: string, community: string): CardelHome[] {
  const key = `"${community}":[`;
  for (let at = html.indexOf(key); at >= 0; at = html.indexOf(key, at + 1)) {
    try {
      const { value } = readLiteral(html, at + key.length - 1);
      const list = Array.isArray(value) ? (value as CardelHome[]) : [];
      if (list.some((h) => h && typeof h.address === "string")) return list;
    } catch {
      // Not the data this is: the key again somewhere else on the page.
    }
  }
  return [];
}

const SUFFIX =
  /^(\d+\s+.+?\b(?:Ave|Avenue|St|Street|Dr|Drive|Trl|Trail|Ln|Lane|Ct|Court|Cir|Circle|Pl|Place|Way|Loop|Blvd|Boulevard|Rd|Road|Ter|Terrace|Run|Cove|Path|Pkwy|Parkway|Crossing|Xing|Pt|Point|Glen|Row|Walk)\b\.?)/i;

/** The street address alone: "10709 Wading River Ave Parrish, FL 34219 - Lot 17" is 10709 Wading River Ave. Pure; exported for tests. */
export function streetOf(address: string): string {
  const bare = address.replace(/\s*-\s*Lot\s+\S+\s*$/i, "").trim();
  return (SUFFIX.exec(bare)?.[1] ?? bare.split(",")[0]).replace(/\s+/g, " ").replace(/\.$/, "").trim();
}

const biggest = (src: Record<string, string> | undefined) =>
  src ? (src["2xl"] ?? src.xl ?? src.lg ?? src.md ?? src.sm ?? null) : null;

/**
 * A gallery entry's picture at its largest: an address under "src", or a
 * path under "paths", on the entry or one level into it — the data wraps
 * each photograph ({image:{src:{…},paths:{…}}}) where the poster is bare.
 * Pure; exported for tests.
 */
export function pictureOf(entry: unknown, depth = 0): string | null {
  if (!entry || typeof entry !== "object" || depth > 2) return null;
  const e = entry as { src?: Record<string, string>; paths?: Record<string, string> };
  const found = biggest(e.src) ?? (biggest(e.paths) ? STORAGE + biggest(e.paths) : null);
  if (found) return found;
  for (const inner of Object.values(entry)) {
    const deeper = pictureOf(inner, depth + 1);
    if (deeper) return deeper;
  }
  return null;
}

/** One home of the data as a quick move-in. Pure; exported for tests. */
export function normalizeCardelHome(home: CardelHome, region: string, community: string): NormalizedPlan | null {
  if (!home.address || (home.status && home.status !== "available")) return null;
  const name = streetOf(home.address);
  const pictures = [
    biggest(home.poster?.src),
    ...(home.gallery ?? []).map((g) => pictureOf(g)),
  ].filter((u, i, all): u is string => Boolean(u) && all.indexOf(u) === i);
  const price = typeof home.pricing?.current === "number" && home.pricing.current > 0 ? home.pricing.current : null;
  return {
    planKey: normKey(name),
    name,
    price,
    priceDisplay: price ? "$" + price.toLocaleString("en-US") : null,
    beds: home.bedrooms ? String(home.bedrooms) : "",
    baths: home.bathrooms ? String(home.bathrooms) : "",
    sqft: home.squareFootage ?? null,
    garages: null,
    homeType: null,
    quickMoveIn: true,
    comingSoon: false,
    // "Sylvan Paired Home" is built from the Sylvan Paired.
    relatedPlanName: (home.name ?? "").replace(/\s+home\s*$/i, "").trim() || null,
    sourceUrl: home.slug ? `https://www1.cardelhomes.com/${region}/${community}/quick-move-ins/${home.slug}` : null,
    galleryImages: pictures,
    blueprintImages: [],
    description: null,
  };
}

/** The region and community a Cardel community page names: ".../florida/north-river-ranch/homes". Exported for tests. */
export function cardelCommunityOf(url: string): { region: string; community: string } | null {
  const m = /cardelhomes\.com\/([a-z-]+)\/([a-z0-9-]+)/i.exec(url);
  return m ? { region: m[1].toLowerCase(), community: m[2].toLowerCase() } : null;
}

/**
 * A Cardel plan's home type, where its page gave none: its name says it —
 * the "Paired" plans are Cardel's paired villas, and the rest of what it
 * builds in Florida are single-family homes (the site's own rows,
 * 2026-09-27: Birchwood, Sylvan and Timberland "Attached Villa", every
 * other plan "Single Family Home"). Pure; exported for tests.
 */
export function cardelHomeType(plan: NormalizedPlan): NormalizedPlan {
  if (plan.quickMoveIn || plan.homeType) return plan;
  return { ...plan, homeType: standardHomeType(plan.name) === "Attached Villa" ? "Attached Villa" : "Single Family Home" };
}

/** A Cardel picture's file name, decoded: ".../o/public%2Fposters%2Fbirchwood-c-…_640x640.webp?alt=media" is "birchwood-c-…_640x640.webp". */
const fileOf = (url: string) => {
  let path = url.replace(/[?#].*$/, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    // left as written
  }
  return path.slice(path.lastIndexOf("/") + 1);
};

/** How large a Cardel picture is by its name ("…_1536x1536.webp"); the largest when it names no size. */
const cardelSize = (url: string) => {
  const m = fileOf(url).match(/_(\d{2,5})x(\d{2,5})\.[a-z]+$/i);
  return m ? Math.max(Number(m[1]), Number(m[2])) : Infinity;
};

/** One picture however large it is drawn: its name without the size. */
const cardelKey = (url: string) => fileOf(url).toLowerCase().replace(/_\d{2,5}x\d{2,5}(?=\.[a-z]+$)/i, "").replace(/\.[a-z]+$/i, "");

/**
 * The pictures of a plan's elevations page: each elevation Cardel draws
 * the plan in ("Southern Prairie - A", "Coastal - B", "Modern Farmhouse -
 * C"), which the plan's own page shows one of. Every picture the page
 * carries from Cardel's store — as an address or as a path in its data —
 * whose name is the plan's ("birchwood-c-modern-farmhouse-nrr-villa-…" for
 * the Birchwood Paired), each once, at its largest. Pure; exported for
 * tests.
 */
/**
 * Whether a file is named for the plan: its name holds the plan's first
 * word as a word of its own, wherever it stands. The paired villas'
 * elevations name the community's villas first —
 * "nrr-villa-timberland-a-craftsman-…" for the Timberland Paired Villa —
 * where their posters and the single-family plans' pictures start with
 * the plan ("timberland-b-coastal-nrr-villa-poster-…", "northwood-3.0-…"),
 * so a picture was only taken when its name started with the plan's and
 * every villa came through with its poster alone (Jeff, 2026-09-29).
 */
const namedFor = (file: string, word: string) => new RegExp(`(?:^|[-_.])${word}(?:[-_.]|$)`).test(file.toLowerCase());

export function elevationPictures(html: string, planName: string): string[] {
  const word = normKey(planName).split("-")[0].replace(/[^a-z0-9]/g, "");
  if (!word) return [];
  const text = html.replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
  const found = [
    ...[...text.matchAll(/https?:\/\/(?:firebasestorage\.googleapis\.com\/v0\/b\/cardel-website\.appspot\.com\/o\/|storage\.googleapis\.com\/cardel-website\.appspot\.com\/)[^"'\s<>)\\]+/gi)].map((m) => m[0].replace(/&amp;/g, "&")),
    ...[...text.matchAll(/["'](public\/[^"'\s]+?\.(?:webp|jpe?g|png))["']/gi)].map((m) => STORAGE + m[1]),
  ].filter((url) => /\.(?:webp|jpe?g|png)$/i.test(fileOf(url)) && namedFor(fileOf(url), word));
  return largestOfEach(found);
}

/** Each picture once, at its largest, in the place its first size came. */
function largestOfEach(urls: string[]): string[] {
  const at = new Map<string, number>();
  const out: string[] = [];
  for (const url of urls) {
    const key = cardelKey(url);
    const i = at.get(key);
    if (i === undefined) {
      at.set(key, out.length);
      out.push(url);
    } else if (cardelSize(url) > cardelSize(out[i])) out[i] = url;
  }
  return out;
}

/**
 * A plan with the pictures of its elevations page after its own: its page
 * shows the plan in one elevation, and a gallery of one poster was all
 * the plans had (Jeff, 2026-09-28: "only seeing one picture per floor
 * plan"). A page that will not load leaves the plan as it was. Exported
 * for tests.
 */
export async function withElevations(plan: NormalizedPlan, read: (url: string) => Promise<string>): Promise<NormalizedPlan> {
  if (plan.quickMoveIn || !plan.sourceUrl) return plan;
  let pictures: string[];
  try {
    pictures = elevationPictures(await read(`${plan.sourceUrl.replace(/\/+$/, "")}/elevations`), plan.name);
  } catch {
    return plan;
  }
  if (!pictures.length) return plan;
  const galleryImages = largestOfEach([...plan.galleryImages, ...pictures]);
  return galleryImages.length === plan.galleryImages.length && galleryImages.every((u, i) => u === plan.galleryImages[i])
    ? plan
    : { ...plan, galleryImages };
}

async function readCardelPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return res.text();
}

export async function extractCardel(params: ClaudeExtractParams): Promise<NormalizedPlan[]> {
  const read = (await extractWithClaude(params)).map(cardelHomeType);
  // Each plan's elevations, a few pages at a time.
  const plans: NormalizedPlan[] = [];
  for (let i = 0; i < read.length; i += 4) plans.push(...(await Promise.all(read.slice(i, i + 4).map((p) => withElevations(p, readCardelPage)))));
  const where = params.url ? cardelCommunityOf(params.url) : null;
  if (!where) return plans;
  const res = await fetch(`https://www1.cardelhomes.com/${where.region}/quick-move-ins`, {
    headers: { "user-agent": UA, accept: "text/html" },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Cardel's quick move-ins page answered ${res.status}`);
  const homes = homesIn(await res.text(), where.community)
    .map((h) => normalizeCardelHome(h, where.region, where.community))
    .filter((h): h is NormalizedPlan => h !== null);
  // The plans' page offered no homes; any it did are left to this list.
  return [...plans.filter((p) => !p.quickMoveIn), ...homes];
}
