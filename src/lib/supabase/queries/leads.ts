import { supabase } from "../client";
import type { Lead, RoutingStatus } from "../types";

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

  const { data, error } = await supabase
    .from("leads")
    .select("id")
    .eq("salesforce_record_id", salesforceRecordId)
    .gte("created_at", cutoff)
    .limit(1);

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
