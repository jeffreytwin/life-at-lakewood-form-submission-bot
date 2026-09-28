// A stand-in plan's own page (stand-ins.ts). A plan built from its homes
// took a home's description, "Don't miss this rare opportunity to own the
// current Adams Homes model home…", though the builder keeps a page for
// the plan itself with the plan's own words (Adams' 2200, Jeff 2026-09-28).
// Where that page can be found, its description is the plan's; where it
// cannot, or the page has none, the home's stands.
//
// The page is found two ways, and a guess is only taken once it reads:
//   - the way the builder files the plans it does list: Adams keeps its
//     1512 at /plan/aviary-at-rutland-ranch/1512, so its 2200 is at
//     /plan/aviary-at-rutland-ranch/2200;
//   - the folder a home sits in, where that folder is named for the plan:
//     Dream Finders' …/seaire-60/arlington/7418-sea-manatee-street/ is a
//     home of …/seaire-60/arlington/.

import { logger } from "@/lib/shared/logger";
import { looksLikeSpecList } from "@/lib/floorplans/description";
import { bareKey } from "@/lib/floorplans/quick-move-ins";
import { distill, fetchPage, readPlanPageWithClaude, type PageReader } from "@/lib/floorplans/extractors/claude-extract";
import { pageLooksUnrendered } from "@/lib/floorplans/extractors/rendered";
import { normKey, type NormalizedPlan } from "@/lib/floorplans/types";

/** How many addresses are tried for one plan. */
const MOST_CANDIDATES = 3;

/** A name or an address's segment as letters and digits only: "Arlington w/Bonus" and "arlington-wbonus" alike. */
const compact = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The ways a plan's name is written in an address: "Plan 1512" as "plan-1512" or "1512". */
function slugsOf(name: string): string[] {
  return [...new Set([normKey(name), bareKey(name)].filter(Boolean))];
}

/** Whether an address's segment names the plan: as its slug, or with a number after it (Neal's "captiva-9"). */
function segmentNames(segment: string, name: string, numbered = false): boolean {
  const seg = compact(decodeURIComponent(segment));
  return slugsOf(name).some((slug) => {
    const s = compact(slug);
    return s !== "" && (seg === s || (numbered && new RegExp(`^${s}\\d+$`).test(seg) && /-\d+$/.test(segment)));
  });
}

interface Parts {
  base: string;
  segments: string[];
  slash: boolean;
}

function partsOf(url: string): Parts | null {
  try {
    const u = new URL(url);
    const slash = u.pathname.endsWith("/");
    return { base: u.origin, segments: u.pathname.split("/").filter(Boolean), slash };
  } catch {
    return null;
  }
}

const join = (p: Parts, segments: string[]): string => `${p.base}/${segments.join("/")}${p.slash ? "/" : ""}`;

/** How many leading characters two addresses share: the closer to the home, the likelier the plan's page. */
function shared(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

/**
 * Where a stand-in plan's own page may be, likeliest first: the address
 * of a plan the builder lists, with that plan's name swapped for this
 * one's, and the folder one of its homes sits in when the folder is named
 * for the plan. Pure; exported for tests.
 */
export function planPageCandidates(standIn: NormalizedPlan, listed: NormalizedPlan[], homes: NormalizedPlan[]): string[] {
  const found = new Set<string>();
  for (const plan of listed) {
    if (plan.quickMoveIn || !plan.sourceUrl || plan.standInFor?.length) continue;
    const p = partsOf(plan.sourceUrl);
    const last = p?.segments.at(-1);
    if (!p || !last || !segmentNames(last, plan.name)) continue;
    // Written the way the listed plan is: "1512" for "Plan 1512", "plan-1512" for its key.
    const bare = compact(last) === compact(bareKey(plan.name));
    const slug = bare ? bareKey(standIn.name) : normKey(standIn.name);
    if (slug) found.add(join(p, [...p.segments.slice(0, -1), slug]));
  }
  for (const home of homes) {
    const p = home.sourceUrl ? partsOf(home.sourceUrl) : null;
    if (!p || p.segments.length < 2) continue;
    const folder = p.segments.at(-2)!;
    if (segmentNames(folder, standIn.name, true)) found.add(join(p, p.segments.slice(0, -1)));
  }
  const near = homes.map((h) => h.sourceUrl ?? "").filter(Boolean);
  const closeness = (url: string) => Math.max(0, ...near.map((h) => shared(url, h)));
  return [...found].sort((a, b) => closeness(b) - closeness(a)).slice(0, MOST_CANDIDATES);
}

/**
 * A reader that takes the page only where it answered for the address
 * asked for: a builder that sends an unknown plan to its list of plans
 * must not have that list read as the plan.
 */
export function onlyThatPage(read: PageReader): PageReader {
  return async (url, opts) => {
    const page = await read(url, opts);
    const asked = partsOf(url)?.segments.at(-1) ?? "";
    const answered = partsOf(page.url)?.segments.at(-1) ?? "";
    if (compact(asked) !== compact(answered)) throw new Error(`${url} answered as ${page.url}`);
    return page;
  };
}

/**
 * A plan's page fetched, or drawn in a browser where the fetch shows
 * nothing (Adams renders its pages). A page that is not there is not
 * drawn: a guessed address is usually one.
 */
export function fetchOrRender(deadline: number): PageReader {
  return async (url, opts) => {
    try {
      const fetched = await fetchPage(url, opts);
      if (!pageLooksUnrendered(distill(fetched.html, fetched.url))) return fetched;
    } catch (error) {
      if (/: (?:404|410)$/.test(error instanceof Error ? error.message : "")) throw error;
    }
    const { withRenderer } = await import("@/lib/floorplans/extractors/render");
    return withRenderer(Math.max(0, deadline - Date.now()), (render) => render(url, opts));
  };
}

/** The builder's text for a plan from its own page: null where the page gives none, or only a spec line. */
type PageText = { url: string; description: string | null };

/**
 * A stand-in plan with its own page's description, where one of the
 * addresses reads as its page; the home's description otherwise. Where
 * there were addresses to try and none could be read — a timeout, a
 * browser that would not start — the plan is marked unread, so a run
 * proposes neither the home's text back nor the page's away (diff.ts,
 * PAGE_ONLY_FIELDS).
 */
export async function withPlanPageDescription(
  standIn: NormalizedPlan,
  candidates: string[],
  read: PageReader
): Promise<NormalizedPlan> {
  let text: PageText | null = null;
  let missing = 0;
  for (const url of candidates) {
    const asked: NormalizedPlan = { ...standIn, sourceUrl: url, description: null };
    try {
      const page = await readPlanPageWithClaude(asked, onlyThatPage(read));
      // A page too thin to read gives the plan back as it was asked.
      if (page === asked) continue;
      const said = page.description?.trim() || null;
      text = { url, description: said && !looksLikeSpecList(said) ? said : null };
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/: (?:404|410)$| answered as /.test(message)) missing += 1;
      else logger.warn("Stand-in plan's own page could not be read", { planKey: standIn.planKey, url, error: message });
    }
  }
  if (!text) {
    // Every address is not the plan's page: the builder keeps none, and the home's text is the plan's.
    if (missing === candidates.length) return standIn;
    return { ...standIn, pageUnread: true };
  }
  if (!text.description) return { ...standIn, raw: { ...(standIn.raw ?? {}), planPageUrl: text.url, descriptionFrom: "home" } };
  // The home's wording before it was reworded is the home's, not the plan's (diff.ts, builderText).
  const { descriptionOriginal: _original, descriptionGenerated: _generated, ...raw } = standIn.raw ?? {};
  void _original; void _generated;
  return { ...standIn, description: text.description, raw: { ...raw, planPageUrl: text.url, descriptionFrom: "plan-page" } };
}
