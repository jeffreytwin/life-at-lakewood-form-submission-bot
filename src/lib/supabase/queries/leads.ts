import { supabase } from "../client";
import { filterToActiveRoster } from "./agents";
import type { Lead, RoutingStatus } from "../types";

/**
 * How many prior assignments to inspect for a single Salesforce record when
 * deciding whether it still has an owner. One record accumulates a handful of
 * submissions at most, so this only bounds a pathological case.
 */
const ASSIGNMENT_LOOKBACK = 20;

export async function createLead(
  lead: Omit<Lead, "id" | "created_at" | "updated_at">
): Promise<Lead> {
  const { data, error } = await supabase
    .from("leads")
    .insert(lead)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateLeadStatus(
  id: string,
  status: RoutingStatus,
  finalAgentId?: string
) {
  const updates: Record<string, unknown> = { routing_status: status };
  if (finalAgentId) updates.final_agent_id = finalAgentId;

  const { data, error } = await supabase
    .from("leads")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getLeadById(id: string): Promise<Lead | null> {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function checkDuplicateLead(
  salesforceRecordId: string,
  recentMinutes: number = 5
): Promise<boolean> {
  const cutoff = new Date(Date.now() - recentMinutes * 60 * 1000).toISOString();

  // Only treat as duplicate if a recent lead with the same SF record ID is
  // still in an active (unresolved) state. Leads that have already reached a
  // terminal state (accepted, owned_by_other, failed, manual) should not block
  // new submissions — those are legitimate re-submissions, not Zapier double-fires.
  const { data, error } = await supabase
    .from("leads")
    .select("id")
    .eq("salesforce_record_id", salesforceRecordId)
    .gte("created_at", cutoff)
    .in("routing_status", ["pending", "routing"])
    .limit(1);

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * Find a prior lead for the same Salesforce record that this bot has already
 * assigned to an agent.
 *
 * Salesforce ownership is written back asynchronously (acceptance -> Zapier ->
 * Salesforce), so for a window after an agent accepts, a fresh submission for
 * the same record still arrives flagged as master-agent-owned with the old
 * owner ID. During that gap our own assignment is the only accurate record of
 * who holds the lead — without it a second submission gets auctioned off to a
 * different agent and two agents end up believing they own the same person.
 *
 * Keyed on final_agent_id rather than routing_status, because status alone
 * does not say whether anyone owns the lead. A lead Salesforce later marks
 * bad_data keeps the agent who accepted it, and that agent still owns the
 * person. Statuses that genuinely have no owner carry no final_agent_id:
 * manual and failed never had one, and a manual retry clears it before
 * re-routing, so those leads stay re-routable.
 *
 * Only an agent on the active roster counts as an owner. An assignment held
 * by a departed agent is not ownership anyone can act on — notifying them
 * would text a phone that no longer reaches the company — and frontlines
 * holding a lead (via the dashboard "Done" button) means it sits with the
 * pool rather than with a sales agent. Both are treated as unowned so the
 * lead can be auctioned again.
 */
export async function findAssignedLeadForRecord(
  salesforceRecordId: string
): Promise<Lead | null> {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("salesforce_record_id", salesforceRecordId)
    .not("final_agent_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(ASSIGNMENT_LOOKBACK);

  if (error) throw error;
  if (!data?.length) return null;

  // Narrow the assignments to those held by an agent still on the roster.
  const onRoster = await filterToActiveRoster(
    Array.from(new Set(data.map((lead) => lead.final_agent_id as string)))
  );

  // data is newest-first, so this is the most recent assignment that still
  // has a real owner behind it.
  return (
    data.find((lead) => onRoster.has(lead.final_agent_id as string)) ?? null
  );
}
