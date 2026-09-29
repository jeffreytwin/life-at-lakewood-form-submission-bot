// Who asked for the work going on, carried down to every Claude call made
// under it (ai-usage.ts) without threading it through every function: a
// nightly tick, a Sync now, a Run pressed on Builder Connections, the
// background photo sort, the Sort button, a stand-in built from the
// overlay, or the connection check on a preview build. A run of a
// connection adds the connection and the run id, so a call can be summed
// back to the run that made it.

import { AsyncLocalStorage } from "node:async_hooks";

export type RunSource = "nightly" | "sync-now" | "run" | "photo-sort" | "sort-button" | "stand-in" | "check";

export interface RunContext {
  source: RunSource;
  connectionId?: string | null;
  runId?: string | null;
  builder?: string | null;
  community?: string | null;
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
