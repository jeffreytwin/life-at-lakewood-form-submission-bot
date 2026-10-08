// Model comparison: pages Sonnet 5 read, read again by the model that
// reads them now (READ_MODEL, claude-extract.ts), and the two answers set
// side by side, field by field. It is how the move from Sonnet 5 to
// Haiku 5.5 was judged before it went out (Jeff, 2026-10-08: the page
// reads were nine-tenths of a sync's spend).
//
// What Sonnet said is already kept, with the text of the page it read
// (fp_page_reads, migration 077), so no builder's site is fetched and
// Sonnet is not paid again: only the new model is asked, the same question
// the run asks, about the same text. The kept text is the page as it is
// compared from night to night (normalizedText): its whitespace closed up
// and, on a plan's page, its links left out, which the facts read off it
// do not use.
//
// Which way each page was asked — a home's page or a plan's, with or
// without its photos; a list for its plans, its homes or both — is not
// kept, only a digest of it (variantOf), so each kept read is matched
// against the ways it could have been asked; one that matches none (a
// list with a connection's hint, a read from before the variants) is
// passed over.
//
// Run from the Vercel build (floorplan-model-compare.mjs), where the keys
// are, on the working branch only. It writes nothing: no read is kept, no
// usage is recorded. Results are FP-COMPARE lines in the build log.

import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { supabase } from "@/lib/supabase/client";
import {
  EXTRACT_TOOL,
  LIST_ASKS,
  PLAN_PAGE_TOOL,
  PLAN_PAGE_TOOL_NO_PHOTOS,
  READ_MODEL,
  asList,
  listAsk,
  planPageAsk,
  withoutBlanks,
  type ExtractedPlan,
  type ExtractedPlanPage,
  type ListMode,
} from "@/lib/floorplans/extractors/claude-extract";
import { readVersion, variantOf } from "@/lib/floorplans/page-reads";
import { costCents, type TokenUsage } from "@/lib/floorplans/ai-usage";

const BASELINE = "claude-sonnet-5";
const PLANS = Number(process.env.FP_COMPARE_PLANS ?? 40);
const LISTS = Number(process.env.FP_COMPARE_LISTS ?? 10);
const PARALLEL = 4;
const EXAMPLES = 30;

const say = (line: string) => console.log(`FP-COMPARE: ${line}`);

const client = new Anthropic();

interface KeptRead {
  url: string;
  variant: string;
  facts: unknown;
}

/** A fixed order that is not the alphabet's, so the sample is spread over the builders. */
const shuffled = <T extends { url: string }>(rows: T[]) =>
  [...rows].sort((a, b) => createHash("sha1").update(a.url).digest("hex").localeCompare(createHash("sha1").update(b.url).digest("hex")));

/** The kept reads of the baseline asked one of these ways (variantOf), in the shuffled order. */
async function keptReads(kind: "plan" | "list", variants: string[]): Promise<KeptRead[]> {
  const { data, error } = await supabase
    .from("fp_page_reads")
    .select("url, variant, facts")
    .eq("kind", kind)
    .eq("model", BASELINE)
    .in("variant", variants)
    .not("text", "is", null)
    .limit(1000);
  if (error) throw new Error(`fp_page_reads could not be read: ${error.message}`);
  return shuffled((data ?? []) as KeptRead[]);
}

async function textOf(url: string, kind: "plan" | "list", variant: string): Promise<string | null> {
  const { data } = await supabase.from("fp_page_reads").select("text").eq("url", url).eq("kind", kind).eq("variant", variant).maybeSingle();
  return (data as { text?: string } | null)?.text ?? null;
}

async function planName(url: string): Promise<string> {
  const { data } = await supabase.from("fp_floor_plans").select("name").eq("source_url", url).limit(1);
  const name = (data as { name?: string }[] | null)?.[0]?.name;
  if (name) return name;
  const slug = url.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop() ?? "";
  return slug.replace(/[-_]+/g, " ");
}

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

// ---- Comparing ---------------------------------------------------------

const word = (v: unknown) => (v === undefined || v === null || v === "" ? "" : String(v).toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim());
const address = (v: unknown) => (typeof v === "string" ? v.replace(/[?#].*$/, "").replace(/\/+$/, "") : "");
const words = (v: unknown) => new Set(word(v).split(" ").filter(Boolean));
const overlap = (a: Set<string>, b: Set<string>) => {
  if (!a.size && !b.size) return 1;
  let both = 0;
  a.forEach((x) => b.has(x) && both++);
  return both / (a.size + b.size - both);
};

type Verdict = "same" | "differ" | "only-old" | "only-new" | "neither";

function verdict(a: string, b: string): Verdict {
  if (!a && !b) return "neither";
  if (a && !b) return "only-old";
  if (!a && b) return "only-new";
  return a === b ? "same" : "differ";
}

class Tally {
  fields = new Map<string, Record<Verdict, number>>();
  examples: string[] = [];
  add(field: string, v: Verdict, where: string, was: unknown, now: unknown) {
    const row = this.fields.get(field) ?? { same: 0, differ: 0, "only-old": 0, "only-new": 0, neither: 0 };
    row[v] += 1;
    this.fields.set(field, row);
    if (v !== "same" && v !== "neither" && this.examples.length < EXAMPLES) {
      const show = (x: unknown) => (x === undefined ? "—" : JSON.stringify(x).slice(0, 160));
      this.examples.push(`${field} ${v} @ ${where}\n      ${BASELINE}: ${show(was)}\n      ${READ_MODEL}: ${show(now)}`);
    }
  }
  print(title: string) {
    say(`${title} — field: same / differ / only ${BASELINE} / only ${READ_MODEL} (both blank left out)`);
    for (const [field, r] of this.fields) {
      const asked = r.same + r.differ + r["only-old"] + r["only-new"];
      const pct = asked ? Math.round((100 * r.same) / asked) : 100;
      say(`  ${field.padEnd(16)} ${pct}% same   ${r.same} / ${r.differ} / ${r["only-old"]} / ${r["only-new"]}`);
    }
    if (this.examples.length) {
      say(`${title} — where they part (first ${this.examples.length}):`);
      for (const e of this.examples) say(`  ${e}`);
    }
  }
}

function comparePlanPage(t: Tally, url: string, was: ExtractedPlanPage, now: ExtractedPlanPage, photos: boolean) {
  for (const field of ["price", "beds", "baths", "sqft", "garages", "planCode", "address"] as const) {
    t.add(field, verdict(word(was[field]), word(now[field])), url, was[field], now[field]);
  }
  t.add("sold", verdict(was.sold ? "sold" : "", now.sold ? "sold" : ""), url, was.sold, now.sold);
  t.add("virtualTourUrl", verdict(address(was.virtualTourUrl), address(now.virtualTourUrl)), url, was.virtualTourUrl, now.virtualTourUrl);
  // A description is the page's own words: the same where most of them are.
  const d = overlap(words(was.description), words(now.description));
  t.add("description", verdict(was.description ? "x" : "", now.description ? (d >= 0.6 || !was.description ? "x" : "y") : ""), url, was.description, now.description);
  const pictures = (v: string[] | undefined) => new Set((v ?? []).map(address));
  const sameSet = (a: Set<string>, b: Set<string>) => (overlap(a, b) >= 0.8 ? "x" : "y");
  if (photos) {
    const a = pictures(was.photoImages), b = pictures(now.photoImages);
    t.add("photos (80%+)", verdict(a.size ? "x" : "", b.size ? (a.size ? sameSet(a, b) : "x") : ""), url, was.photoImages?.length, now.photoImages?.length);
  }
  const a = pictures(was.blueprintImages), b = pictures(now.blueprintImages);
  t.add("drawings (80%+)", verdict(a.size ? "x" : "", b.size ? (a.size ? sameSet(a, b) : "x") : ""), url, was.blueprintImages, now.blueprintImages);
}

const nameKey = (name: unknown) => word(name).replace(/\b(the|plan|model|home)\b/g, "").replace(/\s+/g, "");

function compareList(t: Tally, url: string, was: ExtractedPlan[], now: ExtractedPlan[]) {
  const before = new Map(was.filter((p) => p?.name).map((p) => [nameKey(p.name), p]));
  const after = new Map(now.filter((p) => p?.name).map((p) => [nameKey(p.name), p]));
  for (const [key, p] of before) {
    const q = after.get(key);
    t.add("entry", q ? "same" : "only-old", url, p.name, q?.name);
    if (!q) continue;
    const where = `${url} :: ${p.name}`;
    for (const field of ["price", "beds", "baths", "sqft", "garages", "relatedPlanName"] as const) {
      t.add(field, verdict(word(p[field]), word(q[field])), where, p[field], q[field]);
    }
    t.add("quickMoveIn", verdict(p.quickMoveIn ? "yes" : "no", q.quickMoveIn ? "yes" : "no"), where, p.quickMoveIn, q.quickMoveIn);
    t.add("seriesOfPlans", verdict(p.seriesOfPlans ? "yes" : "", q.seriesOfPlans ? "yes" : ""), where, p.seriesOfPlans, q.seriesOfPlans);
    t.add("sourceUrl", verdict(address(p.sourceUrl), address(q.sourceUrl)), where, p.sourceUrl, q.sourceUrl);
  }
  for (const [key, q] of after) if (!before.has(key)) t.add("entry", "only-new", url, undefined, q.name);
}

// ---- Asking ------------------------------------------------------------

interface Spend {
  calls: number;
  failed: number;
  stops: Record<string, number>;
  cents: number;
  /** What the same tokens would have cost at the baseline's prices. */
  baselineCents: number;
  ms: number;
}
const spend: Spend = { calls: 0, failed: 0, stops: {}, cents: 0, baselineCents: 0, ms: 0 };

function count(response: Anthropic.Message, started: number) {
  spend.calls += 1;
  spend.stops[response.stop_reason ?? "none"] = (spend.stops[response.stop_reason ?? "none"] ?? 0) + 1;
  spend.cents += costCents(READ_MODEL, response.usage as TokenUsage);
  spend.baselineCents += costCents(BASELINE, response.usage as TokenUsage);
  spend.ms += Date.now() - started;
}

async function comparePlans(t: Tally) {
  const ways = [false, true].flatMap((home) => [true, false].map((photos) => ({ home, photos })));
  const variants = ways.map((w) => variantOf("plan", { model: BASELINE, version: readVersion(null), home: w.home, photos: w.photos }));
  const matched = (await keptReads("plan", variants))
    .map((row) => {
      const way = ways.find((w) => variantOf("plan", { model: BASELINE, version: readVersion(null), home: w.home, photos: w.photos }) === row.variant);
      return way ? { row, ...way } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, PLANS);
  say(`plan pages: ${matched.length} (homes ${matched.filter((m) => m.home).length}, asked for photos ${matched.filter((m) => m.photos).length})`);
  await mapLimit(matched, PARALLEL, async ({ row, home, photos }) => {
    const text = await textOf(row.url, "plan", row.variant);
    if (!text) return;
    const tool = photos ? PLAN_PAGE_TOOL : PLAN_PAGE_TOOL_NO_PHOTOS;
    const started = Date.now();
    try {
      const response = await client.messages.create(
        {
          model: READ_MODEL,
          max_tokens: 8_192,
          tools: [tool],
          tool_choice: { type: "tool", name: tool.name },
          messages: [{ role: "user", content: planPageAsk(home, await planName(row.url), row.url, text) }],
        },
        { timeout: 45_000, maxRetries: 1 }
      );
      count(response, started);
      const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (!toolUse) {
        spend.failed += 1;
        say(`  no answer (${response.stop_reason}) @ ${row.url}`);
        return;
      }
      comparePlanPage(t, row.url, row.facts as ExtractedPlanPage, withoutBlanks(toolUse.input as ExtractedPlanPage), photos);
    } catch (error) {
      spend.failed += 1;
      say(`  failed @ ${row.url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

async function compareLists(t: Tally) {
  const modes = Object.keys(LIST_ASKS) as ListMode[];
  const variants = modes.map((m) => variantOf("list", { model: BASELINE, version: readVersion(null), mode: m, hint: null }));
  const matched = (await keptReads("list", variants))
    .map((row) => {
      const mode = modes.find((m) => variantOf("list", { model: BASELINE, version: readVersion(null), mode: m, hint: null }) === row.variant);
      return mode ? { row, mode } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, LISTS);
  say(`list pages: ${matched.length} (${modes.map((m) => `${m} ${matched.filter((x) => x.mode === m).length}`).join(", ")})`);
  await mapLimit(matched, PARALLEL, async ({ row, mode }) => {
    const text = await textOf(row.url, "list", row.variant);
    if (!text) return;
    const started = Date.now();
    try {
      const response = await client.messages
        .stream({
          model: READ_MODEL,
          max_tokens: 24_576,
          tools: [EXTRACT_TOOL],
          tool_choice: { type: "tool", name: EXTRACT_TOOL.name },
          messages: [{ role: "user", content: listAsk(LIST_ASKS[mode], undefined, row.url, text) }],
        })
        .finalMessage();
      count(response, started);
      const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const list = asList<ExtractedPlan>((toolUse?.input as { plans?: unknown } | undefined)?.plans);
      if (!list) {
        spend.failed += 1;
        say(`  no list (${response.stop_reason}) @ ${row.url}`);
        return;
      }
      const was = (asList<ExtractedPlan>(row.facts) ?? []).map(withoutBlanks);
      say(`  ${row.url}: ${BASELINE} ${was.length} entries, ${READ_MODEL} ${list.length}`);
      compareList(t, row.url, was, list.map(withoutBlanks));
    } catch (error) {
      spend.failed += 1;
      say(`  failed @ ${row.url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

async function main() {
  say(`${READ_MODEL} against what ${BASELINE} read, ${PLANS} plan pages and ${LISTS} list pages`);
  const plans = new Tally();
  const lists = new Tally();
  await comparePlans(plans);
  await compareLists(lists);
  plans.print("PLAN PAGES");
  lists.print("LIST PAGES");
  say(
    `calls ${spend.calls}, failed ${spend.failed}, stops ${JSON.stringify(spend.stops)}, ` +
      `cost $${(spend.cents / 100).toFixed(4)} (the same tokens at ${BASELINE}'s prices: $${(spend.baselineCents / 100).toFixed(4)}), ` +
      `${spend.calls ? Math.round(spend.ms / spend.calls) : 0} ms a call`
  );
}

main()
  .catch((error) => say(`stopped: ${error instanceof Error ? error.stack ?? error.message : String(error)}`))
  .finally(() => process.exit(0));
