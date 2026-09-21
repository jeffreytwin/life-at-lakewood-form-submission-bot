// Rows locked as "approving" belong to a bulk approval running on the
// server (the changes/bulk route). One a dead request left behind (a
// timeout, a crash) would otherwise sit locked in the queue for good, so
// both the bulk route and the queue's own read release the stale ones.

import { supabase } from "@/lib/supabase/client";

/** A row still "approving" after this long is nobody's: back to pending. */
export const STALE_APPROVING_MS = 10 * 60_000;

/** Puts rows a dead request left locked back in the queue; best effort. */
export async function releaseStaleApproving(): Promise<void> {
  await supabase
    .from("fp_pending_changes")
    .update({ status: "pending", updated_at: new Date().toISOString() })
    .eq("status", "approving")
    .lt("updated_at", new Date(Date.now() - STALE_APPROVING_MS).toISOString());
}
