// The weekly tour review (Jeff, 2026-10-02): every floor plan's virtual
// tour looked at for what a run cannot judge on its own, and each one that
// looks wrong put to a person as a proposal to take it off the site.
// Approve and the tour comes off, and stays off: the runs and the writes
// leave a tour a person refused off its plan (refusedTours). Reject and it
// stays, and that tour is not put to anyone again for that plan.
//
// What it looks for, on the site's floor plans (homes carry no tour on the
// site):
//   - a link that is not a tour: a builder's web page, or an interactive
//     floor plan;
//   - a tour on another host than Matterport that no longer loads (a gone
//     Matterport model comes off in the nightly run, dead-tours.ts);
//   - a tour whose title names another plan ("Cay Model" on Belay), or one
//     home ("9005 Sunny Shores St") rather than the plan's model;
//   - one tour on plans of different names (Neal's Savannah 2 and Sea
//     Mist). Plans of the same name in two collections or communities may
//     share theirs (Jeff: "if two plans with the same name share the same
//     tour, I'm okay with it"); where a tour's title names one of the plans
//     it is on, that plan keeps it.
// The audit of 2026-10-02 (the "Virtual Tour Audit" page) found these by
// hand; this finds them every week.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { tourKey } from "@/lib/floorplans/community-tours";
import { matterportModel } from "@/lib/floorplans/dead-tours";
import { isInteractivePlan } from "@/lib/floorplans/standardize";
import { TOUR_REVIEW_LABEL } from "@/lib/floorplans/tour-review-label";
import type { NormalizedPlan } from "@/lib/floorplans/types";

export { TOUR_REVIEW_LABEL };

/** A queue row's statuses that mean a person said to take the tour off. */
const REFUSED = ["approved", "synced", "synced_draft"];

/** Hosts that serve walkthrough tours; a link anywhere else is a web page. */
const TOUR_HOST =
  /(?:^|\.)(?:matterport\.com|zillow\.com|modsy\.com|lennar\.com|vr-360-tour\.com|cloudpano\.com|wh360tours\.com|insidemaps\.com|youtube\.com|youtu\.be|vimeo\.com|ml3ds-icon\.com|novasyscad\.com|kuula\.co|eyespy360\.com|truplace\.com|youriguide\.com|iguide\.com|homejab\.com|tourbuilder\.com|envisionyourhome\.com|elevatedplans\.com|cupix\.com)$/i;

// ---------------------------------------------------------------- refusals

type Scope = { site_id: string; community_id: string; builder_id: string };

/** The tours a person said to take off, by plan: plan key → tour keys (tourKey). */
export async function refusedTours(scope: Scope, planKey?: string): Promise<Map<string, Set<string>>> {
  let query = supabase
    .from("fp_pending_changes")
    .select("plan_key, old_value")
    .match(scope)
    .eq("field_changed", TOUR_REVIEW_LABEL)
    .in("status", REFUSED);
  if (planKey) query = query.eq("plan_key", planKey);
  const { data, error } = await query;
  if (error) {
    logger.warn("Refused tours could not be read", { error: error.message });
    return new Map();
  }
  const out = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    const key = tourKey(row.old_value as string | null);
    if (!key) continue;
    const set = out.get(row.plan_key as string) ?? new Set<string>();
    set.add(key);
    out.set(row.plan_key as string, set);
  }
  return out;
}

/** Whether a plan's tour is one a person said to take off it. Pure. */
export function isRefused(planKey: string, tour: string | null | undefined, refused: Map<string, Set<string>>): boolean {
  const key = tourKey(tour);
  return Boolean(key && refused.get(planKey)?.has(key));
}

/**
 * The plans without a tour a person said to take off them, as gone
 * (tourStated), so a record that still shows it is proposed without it.
 * Pure; exported for tests.
 */
export function withoutRefusedTours(plans: NormalizedPlan[], refused: Map<string, Set<string>>): NormalizedPlan[] {
  if (!refused.size) return plans;
  return plans.map((p) =>
    isRefused(p.planKey, p.virtualTourUrl, refused) ? { ...p, virtualTourUrl: null, virtualTourImage: null, tourStated: true } : p
  );
}

// ---------------------------------------------------------------- judging

/** What the review learned of a tour: whether it loads, and the title its host gives it. */
export interface TourFacts {
  status: "ok" | "broken" | "gone" | "unknown";
  title?: string | null;
  detail?: string | null;
}

/** A floor plan on the site with a tour. */
export interface ReviewedPlan {
  id: string;
  site_id: string;
  community_id: string;
  builder_id: string;
  builder: string;
  plan_key: string;
  name: string;
  wix_record_id: string;
  tour: string;
  record: NormalizedPlan;
}

export interface TourFlag {
  plan: ReviewedPlan;
  reasons: string[];
}

/** Words that say nothing about which plan a title is of. */
const STOP = new Set(["the", "plan", "plans", "home", "homes", "model", "models", "series", "collection", "virtual", "tour", "tours", "copy", "new", "and", "final", "at", "by", "of"]);

/** A name's telling words: "Duval (Oakfield Trails Signature)" is {duval}; "Plan 1820" is {1820}. Pure; exported for tests. */
export function nameWords(name: string | null | undefined): Set<string> {
  const plain = (name ?? "").replace(/\s*\([^)]*\)\s*/g, " ").toLowerCase();
  return new Set(plain.split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !STOP.has(w)));
}

/** One edit apart at most: a title spells "Southhampton" for the Southampton. */
function nearlyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const [x, y] = [a.slice(i), b.slice(i)];
  return x.slice(1) === y.slice(1) || x.slice(1) === y || x === y.slice(1);
}

/** How many of a name's words a title has, spelled the same or one letter off. */
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((w) => [...b].some((t) => nearlyEqual(w, t))).length;

/** A plan's name as one plan, whatever collection it is filed under. */
const sameName = (name: string) => [...nameWords(name)].sort().join(" ");

/** Whether a title is of one home: a street address or a lot. Pure; exported for tests. */
export function namesAHome(title: string): boolean {
  return /^\s*\d{2,6}\s+[a-z]/i.test(title) || /\blot\s*#?\s*\d+/i.test(title) || /\b\d{2,6}\s+[a-z]+\s+(?:st|street|ave|avenue|dr|drive|ln|lane|ct|court|loop|lp|blvd|way|terrace|ter|trl|trail|pl|place|rd|road|cir|circle)\b/i.test(title);
}

/**
 * The plans whose tour looks wrong, each with why. Pure; exported for
 * tests. `allPlanNames` are the names of every plan the sites carry, of
 * every builder: Centex's Daniel showed Pulte's Daylen.
 */
export function tourSuspicions(plans: ReviewedPlan[], facts: Map<string, TourFacts>, allPlanNames: string[]): TourFlag[] {
  const reasons = new Map<string, string[]>();
  const add = (p: ReviewedPlan, why: string) => {
    const list = reasons.get(p.id) ?? [];
    if (!list.includes(why)) list.push(why);
    reasons.set(p.id, list);
  };
  const named = allPlanNames.map((n) => ({ n, words: nameWords(n) })).filter((x) => x.words.size);

  // A Matterport model that is gone comes off in the nightly run (dead-tours.ts).
  plans = plans.filter((p) => facts.get(tourKey(p.tour))?.status !== "gone");
  for (const p of plans) {
    const fact = facts.get(tourKey(p.tour));
    let host = "";
    try {
      host = new URL(p.tour).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      add(p, "the link is not a web address");
      continue;
    }
    if (isInteractivePlan(p.tour)) add(p, "an interactive floor plan, not a walkthrough tour");
    else if (!TOUR_HOST.test(host)) add(p, `not a tour: a web page on ${host}`);
    if (fact?.status === "broken") add(p, `the tour no longer loads${fact.detail ? ` (${fact.detail})` : ""}`);
    const title = fact?.title?.trim();
    if (!title) continue;
    const own = nameWords(p.name);
    const titleWords = nameWords(title);
    if (own.size && overlap(own, titleWords) === 0) {
      const other = named.find((x) => sameName(x.n) !== sameName(p.name) && overlap(x.words, titleWords) === x.words.size);
      if (other) add(p, `titled “${title}”, the name of another plan (${other.n.replace(/\s*\([^)]*\)\s*/g, "").trim()})`);
      else if (namesAHome(title)) add(p, `a tour of one home (“${title}”), not of this plan's model`);
    }
  }

  // One tour on plans of different names.
  const byTour = new Map<string, ReviewedPlan[]>();
  for (const p of plans) {
    const key = `${p.builder_id}|${tourKey(p.tour)}`;
    byTour.set(key, [...(byTour.get(key) ?? []), p]);
  }
  for (const group of byTour.values()) {
    const names = new Set(group.map((p) => sameName(p.name)));
    if (names.size < 2) continue;
    const title = facts.get(tourKey(group[0].tour))?.title?.trim();
    // The plans the title names best keep the tour; with no title, none can.
    const titleWords = title ? nameWords(title) : null;
    const best = titleWords ? Math.max(...group.map((p) => overlap(nameWords(p.name), titleWords))) : 0;
    const owners = new Set(best > 0 ? group.filter((p) => overlap(nameWords(p.name), titleWords!) === best).map((p) => sameName(p.name)) : []);
    for (const p of group) {
      if (owners.has(sameName(p.name))) continue;
      const others = [...new Set(group.filter((o) => sameName(o.name) !== sameName(p.name)).map((o) => o.name.replace(/\s*\([^)]*\)\s*/g, "").trim()))];
      add(p, `the same tour${title ? ` (“${title}”)` : ""} is on ${others.join(", ")}`);
    }
  }

  return plans.filter((p) => reasons.has(p.id)).map((p) => ({ plan: p, reasons: reasons.get(p.id)! }));
}

// ---------------------------------------------------------------- looking

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const get = (url: string, init: RequestInit = {}) =>
  fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000), ...init, headers: { "user-agent": UA, ...(init.headers ?? {}) } });

/**
 * What a tour's host says of it. Only an answer that plainly says the tour
 * is gone is "broken"; a host that will not say (Zillow, Mattamy's viewer)
 * or a request that fails is "unknown". Exported for tests.
 */
export async function lookAtTour(url: string): Promise<TourFacts> {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return { status: "unknown" };
  }
  const host = u.hostname.toLowerCase();
  try {
    if (host.endsWith("matterport.com")) {
      const id = matterportModel(url);
      if (!id) return { status: "unknown" };
      const res = await get("https://my.matterport.com/api/mp/models/graph", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: `{ model(id: ${JSON.stringify(id)}) { state name } }` }),
      });
      const body = (await res.json()) as { data?: { model?: { state?: string; name?: string } | null }; errors?: { extensions?: { code?: string } }[] };
      if (body.data?.model) return { status: "ok", title: body.data.model.name ?? null };
      return body.errors?.some((e) => e.extensions?.code === "not.found") ? { status: "gone" } : { status: "unknown" };
    }
    if (host.endsWith("youtube.com") || host === "youtu.be") {
      const id = u.searchParams.get("v") || u.pathname.split("/").filter(Boolean).pop();
      const res = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`);
      if (res.status === 400 || res.status === 404) return { status: "broken", detail: "the video is gone" };
      return res.ok ? { status: "ok", title: ((await res.json()) as { title?: string }).title ?? null } : { status: "unknown" };
    }
    if (host.endsWith("vimeo.com")) {
      const res = await get(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`);
      if (res.status === 404) return { status: "broken", detail: "the video is gone" };
      return res.ok ? { status: "ok", title: ((await res.json()) as { title?: string }).title ?? null } : { status: "unknown" };
    }
    if (host === "app.cloudpano.com" || host === "tours.wh360tours.com") {
      const id = u.pathname.split("/").filter(Boolean).pop();
      const res = await get(`https://${host}/api/tours/${id}?isViewer=true`);
      if (!res.ok) return { status: res.status === 404 ? "broken" : "unknown", detail: res.status === 404 ? "the tour is gone" : null };
      const body = (await res.json()) as { title?: string; images?: unknown };
      const images = typeof body.images === "string" ? (JSON.parse(body.images || "[]") as unknown[]) : ((body.images as unknown[]) ?? []);
      return images.length ? { status: "ok", title: body.title ?? null } : { status: "broken", detail: "the tour has no scenes" };
    }
    if (host.endsWith("insidemaps.com")) {
      const res = await get(`https://www.insidemaps.com/api/v1/walkthrough-v2/getProjectInfo?projectId=${u.searchParams.get("projectId")}&env=production`);
      if (res.status === 403 || res.status === 404) return { status: "broken", detail: "the tour is gone" };
      if (!res.ok) return { status: "unknown" };
      const body = (await res.json()) as { archivedProject?: unknown; projectName?: string };
      return body.archivedProject ? { status: "broken", detail: "the tour is archived" } : { status: "ok", title: body.projectName ?? null };
    }
    if (host === "hd.modsy.com") {
      const res = await get(`https://cache.modsy.com/public/vt/${u.searchParams.get("vtid")}/view.json`);
      if (res.status === 403 || res.status === 404) return { status: "broken", detail: "the tour is gone" };
      return { status: res.ok ? "ok" : "unknown" };
    }
    // Hosts that will not say from a server.
    if (host.endsWith("zillow.com") || host.endsWith("ml3ds-icon.com") || host === "www.modsy.com") return { status: "unknown" };
    const res = await get(url, { headers: { accept: "text/html" } });
    if (res.status === 404 || res.status === 410) return { status: "broken", detail: `the page answers ${res.status}` };
    if (!res.ok) return { status: "unknown" };
    const title = (await res.text()).match(/<title[^>]*>([^<]*)/i)?.[1]?.trim() || null;
    if (/\/errors?\//i.test(new URL(res.url).pathname) || (title && /not found|no longer available|expired/i.test(title))) {
      return { status: "broken", detail: "the page shows an error" };
    }
    return { status: "ok", title: /vr-360-tour\.com|novasyscad\.com/i.test(host) ? title : null };
  } catch (error) {
    logger.warn("Virtual tour could not be looked at", { url, error: error instanceof Error ? error.message : String(error) });
    return { status: "unknown" };
  }
}

/** Runs `fn` over the items a few at a time. */
async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

// ---------------------------------------------------------------- the review

export interface TourReviewResult {
  plans: number;
  tours: number;
  flagged: number;
  queued: number;
  alreadyReviewed: number;
}

/**
 * The week's review: every floor plan on the sites with a tour, judged,
 * and each one that looks wrong queued for a person, once per plan and
 * tour (a tour already put to a person, whatever they said, is not put
 * again).
 */
export async function runTourReview(now = new Date()): Promise<TourReviewResult> {
  const plans: ReviewedPlan[] = [];
  const allPlanNames = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("fp_floor_plans")
      .select("id, site_id, community_id, builder_id, plan_key, name, wix_record_id, quick_move_in, record, fp_builders:builder_id(name)")
      .is("removed_at", null)
      .range(from, from + 999);
    if (error) throw new Error(`floor plans: ${error.message}`);
    for (const row of data ?? []) {
      if (row.quick_move_in) continue;
      allPlanNames.add(row.name as string);
      const record = row.record as NormalizedPlan;
      const tour = record?.virtualTourUrl?.trim();
      if (!tour || !row.wix_record_id) continue;
      plans.push({
        id: row.id as string,
        site_id: row.site_id as string,
        community_id: row.community_id as string,
        builder_id: row.builder_id as string,
        builder: (row.fp_builders as unknown as { name: string } | null)?.name ?? "",
        plan_key: row.plan_key as string,
        name: row.name as string,
        wix_record_id: row.wix_record_id as string,
        tour,
        record,
      });
    }
    if (!data || data.length < 1000) break;
  }

  const byKey = new Map<string, string>();
  for (const p of plans) if (!byKey.has(tourKey(p.tour))) byKey.set(tourKey(p.tour), p.tour);
  const facts = new Map<string, TourFacts>();
  await eachLimit([...byKey.entries()], 8, async ([key, url]) => {
    facts.set(key, await lookAtTour(url));
  });

  const flags = tourSuspicions(plans, facts, [...allPlanNames]);

  // What has already been put to a person, whatever they said.
  const { data: reviewed } = await supabase
    .from("fp_pending_changes")
    .select("site_id, community_id, builder_id, plan_key, old_value")
    .eq("field_changed", TOUR_REVIEW_LABEL);
  const seen = new Set((reviewed ?? []).map((r) => `${r.site_id}|${r.community_id}|${r.builder_id}|${r.plan_key}|${tourKey(r.old_value as string | null)}`));

  const runId = `tour-review:${now.toISOString()}`;
  let queued = 0;
  let alreadyReviewed = 0;
  for (const { plan: p, reasons } of flags) {
    if (seen.has(`${p.site_id}|${p.community_id}|${p.builder_id}|${p.plan_key}|${tourKey(p.tour)}`)) {
      alreadyReviewed++;
      continue;
    }
    const reason = reasons.join("; ");
    const proposed: NormalizedPlan & { tourReview: { reason: string } } = {
      ...p.record,
      virtualTourUrl: null,
      virtualTourImage: null,
      tourStated: true,
      tourReview: { reason },
    };
    const { error } = await supabase.from("fp_pending_changes").insert({
      site_id: p.site_id,
      community_id: p.community_id,
      builder_id: p.builder_id,
      floor_plan_id: p.id,
      plan_key: p.plan_key,
      change_type: "update",
      field_changed: TOUR_REVIEW_LABEL,
      old_value: p.tour,
      new_value: null,
      proposed_record: proposed,
      wix_record_id: p.wix_record_id,
      run_id: runId,
      status: "pending",
    });
    if (error) logger.warn("Tour review could not queue a plan", { planKey: p.plan_key, error: error.message });
    else queued++;
  }
  logger.info("Tour review finished", { plans: plans.length, tours: byKey.size, flagged: flags.length, queued, alreadyReviewed });
  return { plans: plans.length, tours: byKey.size, flagged: flags.length, queued, alreadyReviewed };
}
