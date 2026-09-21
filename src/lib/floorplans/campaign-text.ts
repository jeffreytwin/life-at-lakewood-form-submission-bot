// The words of an email campaign alert (Jeff, 2026-09-21): what changed on a
// tracked floor plan, as the Hub lists it and as the frontlines agent reads
// it in a text. No IO here.

export interface CampaignPlanLabel {
  name: string;
  domain?: string | null;
  community?: string | null;
  builder?: string | null;
}

/** "Lori (The Isles, Toll Brothers) on lifeatlakewood.com" */
export function describePlan(plan: CampaignPlanLabel): string {
  const where = [plan.community, plan.builder].filter(Boolean).join(", ");
  return `${plan.name}${where ? ` (${where})` : ""}${plan.domain ? ` on ${plan.domain}` : ""}`;
}

/** The alert line for one changed field of a tracked plan, as the queue showed it. */
export function fieldChangeDetail(planName: string, field: string | null, oldValue: string | null, newValue: string | null): string {
  return `${planName}: ${field ?? "updated"} ${oldValue ?? "—"} → ${newValue ?? "—"}`;
}

/** The alert line for a quick move-in of a tracked plan, whichever way it changed. */
export function homeChangeDetail(homeName: string, basePlanName: string | null | undefined, what: string): string {
  return `Quick move-in ${homeName}${basePlanName ? ` under ${basePlanName}` : ""}: ${what}`;
}

/**
 * The text the frontlines agent gets: which plan, what changed, and where
 * to go. The Hub's address comes from the deployment when one is known.
 */
export function campaignAlertText(plan: CampaignPlanLabel, detail: string, hubUrl?: string | null): string {
  const where = hubUrl ? `${hubUrl.replace(/\/+$/, "")}/dashboard/floor-plans/campaign` : "the Hub, Floor Plans → Email campaign";
  return [`Email campaign alert: ${describePlan(plan)} changed.`, detail, `Update the campaign to match. See ${where}.`].join("\n\n");
}
