// Scores remembered apart from the plans that carry them (fp_plan_scores,
// migration 068). A person sets a score once in the Hub; a Reset removes
// the plans and the queue, and the next Run brings the score back. No IO
// here; sync.ts loads the map and the PATCH route writes the table.

import type { NormalizedPlan } from "@/lib/floorplans/types";

/** The plan with its remembered score, when it has none of its own; a quick move-in carries no score. */
export function withRememberedScore(plan: NormalizedPlan, scores: ReadonlyMap<string, number>): NormalizedPlan {
  if (plan.quickMoveIn || typeof plan.score === "number") return plan;
  const score = scores.get(plan.planKey);
  return typeof score === "number" && Number.isFinite(score) ? { ...plan, score } : plan;
}
