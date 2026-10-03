// The rejections the Remove button leaves behind (remove-plan.ts): one for
// the plan and one for each home built from it, so the next run does not
// offer them back as they stand. A plan approved back onto the site brings
// its homes back with it: Lennar's Columbia at Prosperity Lakes was removed
// with 12449 Teal Topaz Trl on 9/30 and approved again on 10/2 at a new
// price, but the home's price had not moved, its rejection held, and no run
// offered it again though Lennar still sells it (Jeff, 2026-10-03).

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

/** The run id the Remove button gives its changes. */
export const REMOVE_RUN_PREFIX = "hub-remove-";

export interface RemovalGuard {
  id: string;
  run_id: string | null;
  proposed_record: { quickMoveIn?: boolean; relatedPlanKey?: string | null } | null;
}

/**
 * Of the rejected additions, those the Remove button left for the homes
 * built from a plan. A rejection a person made is not among them. Pure;
 * exported for tests.
 */
export function homeGuardsOf(guards: RemovalGuard[], planKey: string): RemovalGuard[] {
  return guards.filter(
    (g) =>
      (g.run_id ?? "").startsWith(REMOVE_RUN_PREFIX) &&
      g.proposed_record?.quickMoveIn === true &&
      g.proposed_record?.relatedPlanKey === planKey
  );
}

/** Lifts the Remove button's rejections of a plan's homes, now the plan is on the site again: the next run offers them. */
export async function liftHomeGuards(
  scope: { site_id: string; community_id: string; builder_id: string },
  planKey: string
): Promise<void> {
  const { data, error } = await supabase
    .from("fp_pending_changes")
    .select("id, run_id, proposed_record")
    .match(scope)
    .eq("change_type", "add")
    .eq("status", "rejected")
    .like("run_id", `${REMOVE_RUN_PREFIX}%`);
  if (error) {
    logger.warn("The removed homes' rejections could not be read", { planKey, error: error.message });
    return;
  }
  const lifted = homeGuardsOf((data ?? []) as RemovalGuard[], planKey);
  if (!lifted.length) return;
  const { error: deleteError } = await supabase.from("fp_pending_changes").delete().in("id", lifted.map((g) => g.id));
  if (deleteError) logger.warn("The removed homes' rejections could not be lifted", { planKey, error: deleteError.message });
}
