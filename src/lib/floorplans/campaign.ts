// The email drip campaign's floor plans (fp_floor_plans.starred) and the
// alerts raised when one of them changes on a site (Jeff, 2026-09-21): a
// follow-up task the Hub shows (the Floor Plans badge, the campaign page,
// the character), and a text to the frontlines agent so the marketing can
// be changed to match the collection. The words live in campaign-text.ts.

import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { getFrontlinesAgent } from "@/lib/supabase/queries/agents";
import { sendCampaignAlert } from "@/lib/twilio/send-sms";
import { campaignAlertText } from "@/lib/floorplans/campaign-text";

export type CampaignTaskType = "price_changed" | "plan_removed" | "other_change";

export interface PlanRow {
  id: string;
  name: string;
  starred: boolean;
  quick_move_in: boolean;
  record: { relatedPlanKey?: string | null; relatedPlanName?: string | null } | null;
  fp_sites: { domain: string } | null;
  fp_communities: { name: string } | null;
  fp_builders: { name: string } | null;
}

const PLAN_COLUMNS =
  "id, name, starred, quick_move_in, record, fp_sites:site_id(domain), fp_communities:community_id(name), fp_builders:builder_id(name)";

/** A canonical plan by id, with the names an alert needs; null when there is none. */
export async function planRow(floorPlanId: string): Promise<PlanRow | null> {
  const { data } = await supabase.from("fp_floor_plans").select(PLAN_COLUMNS).eq("id", floorPlanId).maybeSingle();
  return (data as unknown as PlanRow | null) ?? null;
}

/** The live base plan a quick move-in files under, by key in the same scope; null when there is none. */
export async function basePlanOf(
  scope: { site_id: string; community_id: string; builder_id: string },
  relatedPlanKey: string | null | undefined
): Promise<PlanRow | null> {
  if (!relatedPlanKey) return null;
  const { data } = await supabase
    .from("fp_floor_plans")
    .select(PLAN_COLUMNS)
    .match(scope)
    .eq("plan_key", relatedPlanKey)
    .eq("quick_move_in", false)
    .is("removed_at", null)
    .maybeSingle();
  return (data as unknown as PlanRow | null) ?? null;
}

/** Where the Hub lives, for the link in a text; nothing when the deployment does not say. */
function hubUrl(): string | null {
  const explicit = process.env.HUB_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? `https://${vercel}` : null;
}

/**
 * Records that a tracked plan changed and tells the frontlines agent. A
 * plan that is not tracked raises nothing. The task is what the Hub shows
 * until someone marks it done; the text is best effort: a missing number
 * or a Twilio error is logged, never thrown, so an approval never fails
 * over it.
 */
export async function alertIfTracked(
  plan: PlanRow | null,
  taskType: CampaignTaskType,
  detail: string,
  pendingChangeId: string | null
): Promise<boolean> {
  if (!plan?.starred) return false;
  const { error } = await supabase.from("fp_follow_up_tasks").insert({
    floor_plan_id: plan.id,
    pending_change_id: pendingChangeId,
    task_type: taskType,
    detail,
  });
  if (error) {
    logger.error("Email campaign alert could not be recorded", { planId: plan.id, error: error.message });
    return false;
  }
  try {
    const agent = await getFrontlinesAgent();
    const phone = agent?.phone ?? process.env.FRONTLINES_AGENT_PHONE;
    if (!phone) {
      logger.warn("No frontlines phone for the email campaign alert", { planId: plan.id });
      return true;
    }
    await sendCampaignAlert(
      phone,
      campaignAlertText(
        { name: plan.name, domain: plan.fp_sites?.domain, community: plan.fp_communities?.name, builder: plan.fp_builders?.name },
        detail,
        hubUrl()
      )
    );
  } catch (err) {
    logger.warn("Email campaign alert text failed", { planId: plan.id, error: err instanceof Error ? err.message : String(err) });
  }
  return true;
}
