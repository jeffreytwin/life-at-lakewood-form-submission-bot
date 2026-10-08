// What each Claude call cost, written down as it is made (fp_ai_usage,
// migration 077). Nothing in the floor plan pipeline recorded its usage
// before this, so what a night's sync spent was a guess (Jeff, 2026-09-29:
// the cost per run is high, and where it goes was unknown). Every call
// site records its tokens here — the list and plan page reads
// (claude-extract.ts), the description reword, the photo labels and the
// duplicate check — and a page served from fp_page_reads is recorded too,
// as a read that cost nothing, so the share of pages read for nothing is
// plain.
//
// The cost is priced at the day's rates and kept with the row, so the
// tally stays true when prices move. Recording is best effort: a row that
// cannot be written is a warning, never a failed run.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { runContext } from "@/lib/floorplans/run-context";

export type UsagePurpose = "list-page" | "plan-page" | "description" | "photo-rooms" | "photo-duplicates";

/** Dollars per million tokens, from platform.claude.com/docs/en/about-claude/pricing on 2026-09-29 (Haiku 5.5 and Sonnet 5.5's cache reads on 2026-10-08). */
export interface ModelPrices {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  /** A model priced by the length of the prompt: past this many prompt tokens, a request pays `long`'s prices. */
  longOver?: number;
  long?: ModelPrices;
}

export const PRICES: Record<string, ModelPrices> = {
  "claude-sonnet-5": { input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 10 },
  "claude-sonnet-5-5": { input: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10 },
  "claude-opus-5": { input: 5, cacheRead: 0.5, cacheWrite: 6.25, output: 25 },
  "claude-opus-5-5": { input: 4, cacheRead: 0.2, cacheWrite: 5, output: 20 },
  "claude-haiku-4-5": { input: 1, cacheRead: 0.1, cacheWrite: 1.25, output: 5 },
  "claude-haiku-5-5": {
    input: 0.1,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    output: 0.5,
    longOver: 100_000,
    long: { input: 0.5, cacheRead: 0.05, cacheWrite: 0.625, output: 2.5 },
  },
};

/** The usage a response carries, as the SDK names it. */
export interface TokenUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** The prices of a model, by its id or the id less a date ("claude-haiku-4-5-20251001"). */
export function pricesOf(model: string): ModelPrices | null {
  return PRICES[model] ?? PRICES[model.replace(/-\d{8}$/, "")] ?? null;
}

const n = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** What a call cost, in cents, at the model's prices; 0 for a model the table does not know. Pure. */
export function costCents(model: string, usage: TokenUsage | null | undefined): number {
  const card = pricesOf(model);
  if (!card || !usage) return 0;
  // The prompt is everything sent, read from the cache or not.
  const prompt = n(usage.input_tokens) + n(usage.cache_read_input_tokens) + n(usage.cache_creation_input_tokens);
  const prices = card.long && card.longOver !== undefined && prompt > card.longOver ? card.long : card;
  const dollars =
    (n(usage.input_tokens) * prices.input +
      n(usage.cache_read_input_tokens) * prices.cacheRead +
      n(usage.cache_creation_input_tokens) * prices.cacheWrite +
      n(usage.output_tokens) * prices.output) /
    1_000_000;
  return Math.round(dollars * 100 * 10_000) / 10_000;
}

export interface UsageRecord {
  purpose: UsagePurpose;
  model: string;
  usage?: TokenUsage | null;
  /** Pictures sent with the request. */
  images?: number;
  /** A page read served from fp_page_reads: no call, no tokens. */
  cached?: boolean;
  ms?: number;
  ok?: boolean;
  error?: string | null;
  url?: string | null;
}

/** Writes one call down and returns what it cost, in cents. Never throws. */
export async function recordUsage(record: UsageRecord): Promise<number> {
  const cost = record.cached ? 0 : costCents(record.model, record.usage);
  const ctx = runContext();
  try {
    if (!record.cached && !pricesOf(record.model)) {
      logger.warn("Claude usage recorded at no price: model not in the price table", { model: record.model });
    }
    const { error } = await supabase.from("fp_ai_usage").insert({
      purpose: record.purpose,
      model: record.model,
      source: ctx?.source ?? null,
      connection_id: ctx?.connectionId ?? null,
      run_id: ctx?.runId ?? null,
      url: record.url ?? null,
      input_tokens: n(record.usage?.input_tokens),
      cache_read_tokens: n(record.usage?.cache_read_input_tokens),
      cache_write_tokens: n(record.usage?.cache_creation_input_tokens),
      output_tokens: n(record.usage?.output_tokens),
      images: record.images ?? 0,
      cached: record.cached === true,
      ms: record.ms ?? null,
      ok: record.ok !== false,
      error: record.error ? String(record.error).slice(0, 500) : null,
      cost_cents: cost,
    });
    if (error) logger.warn("Claude usage could not be recorded", { purpose: record.purpose, error: error.message });
  } catch (error) {
    logger.warn("Claude usage could not be recorded", {
      purpose: record.purpose,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return cost;
}

export interface UsageTotals {
  /** Calls made, cached reads aside. */
  calls: number;
  /** Page reads, made or served from memory. */
  reads: number;
  /** Page reads served from memory. */
  cached: number;
  costCents: number;
}

const PAGE_READS = new Set<string>(["list-page", "plan-page"]);

/** Sums rows into a tally. Pure; exported for tests. */
export function tally(rows: { purpose: string; cached: boolean; cost_cents: number | string }[]): UsageTotals {
  const totals: UsageTotals = { calls: 0, reads: 0, cached: 0, costCents: 0 };
  for (const row of rows) {
    if (PAGE_READS.has(row.purpose)) totals.reads += 1;
    if (row.cached) totals.cached += 1;
    else totals.calls += 1;
    totals.costCents += Number(row.cost_cents) || 0;
  }
  totals.costCents = Math.round(totals.costCents * 10_000) / 10_000;
  return totals;
}

/** What one run of a connection spent. Null when the table cannot be read. */
export async function runTotals(runId: string): Promise<UsageTotals | null> {
  const { data, error } = await supabase.from("fp_ai_usage").select("purpose, cached, cost_cents").eq("run_id", runId);
  if (error) {
    logger.warn("Claude usage of the run could not be read", { runId, error: error.message });
    return null;
  }
  return tally(data ?? []);
}

/** What every call since a moment spent: a sync cycle's tally. Null when the table cannot be read. */
export async function totalsSince(startedAt: string): Promise<UsageTotals | null> {
  const { data, error } = await supabase.from("fp_ai_usage").select("purpose, cached, cost_cents").gte("at", startedAt);
  if (error) {
    logger.warn("Claude usage since the cycle began could not be read", { startedAt, error: error.message });
    return null;
  }
  return tally(data ?? []);
}
