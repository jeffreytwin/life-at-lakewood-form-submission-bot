// Who asked for the work going on, carried down to every Claude call made
// under it (ai-usage.ts) without threading it through every function: a
// nightly tick, a Sync now, a Run pressed on Builder Connections, the
// background photo sort, the Sort button, a stand-in built from the
// overlay, the connection check on a preview build, or the re-check of
// removals an earlier run held (removal-recheck.ts). A run of a
// connection adds the connection and the run id, so a call can be summed
// back to the run that made it.

import { AsyncLocalStorage } from "node:async_hooks";

export type RunSource = "nightly" | "sync-now" | "run" | "photo-sort" | "sort-button" | "stand-in" | "check" | "recheck";

export interface RunContext {
  source: RunSource;
  connectionId?: string | null;
  runId?: string | null;
  builder?: string | null;
  community?: string | null;
  /**
   * A run made to read again what an earlier run of the same night held
   * for a second reading (confirm-reads.ts): the pages of the plans held
   * are read afresh rather than from what was remembered of them
   * (page-reads.ts), and only those plans are compared (sync.ts).
   */
  secondReading?: { freshPages: ReadonlySet<string>; freshPlans: ReadonlySet<string> };
}

const storage = new AsyncLocalStorage<RunContext>();

/** Runs `fn` with this as the context every call under it sees. */
export function withRunContext<T>(ctx: RunContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/** The context of the work going on, or undefined outside any. */
export function runContext(): RunContext | undefined {
  return storage.getStore();
}

/**
 * Whether a page is to be read afresh this run, what was remembered of it
 * set aside: on a second reading, every list page, and the page of each
 * plan held, known by the address its record keeps or by the plan's key
 * (a record can keep an older address than the page is read at). A list
 * is read afresh since a plan's photos and price come off it, and a
 * builder has few.
 */
export function readsAfresh(url: string, kind: "plan" | "list", planKey?: string | null): boolean {
  const again = runContext()?.secondReading;
  if (!again) return false;
  return kind === "list" || again.freshPages.has(url) || (typeof planKey === "string" && again.freshPlans.has(planKey));
}
