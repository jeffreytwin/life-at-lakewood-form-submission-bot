import { supabase } from "../client";
import type { RoutingAttempt, RoutingAttemptStatus } from "../types";

export async function createRoutingAttempt(
  attempt: Omit<RoutingAttempt, "id" | "created_at" | "updated_at">
): Promise<RoutingAttempt> {
  const { data, error } = await supabase
    .from("routing_attempts")
    .insert(attempt)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateRoutingAttemptStatus(
  id: string,
  status: RoutingAttemptStatus,
  updates?: {
    expires_at?: string | null;
    agent_response?: string;
    twilio_message_sid?: string;
  }
) {
  const { data, error } = await supabase
    .from("routing_attempts")
    .update({ status, ...updates })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getExpiredAttempts(): Promise<RoutingAttempt[]> {
  const { data, error } = await supabase
    .from("routing_attempts")
    .select("*")
    .in("status", ["sms_sent", "followup_sent"])
    .lt("expires_at", new Date().toISOString());

  if (error) throw error;
  return data;
}

export async function getActiveAttemptForLead(
  leadId: string
): Promise<RoutingAttempt | null> {
  const { data, error } = await supabase
    .from("routing_attempts")
    .select("*")
    .eq("lead_id", leadId)
    .in("status", ["sms_sent", "followup_sent"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getAttemptsByLeadId(
  leadId: string
): Promise<RoutingAttempt[]> {
  const { data, error } = await supabase
    .from("routing_attempts")
    .select("*")
    .eq("lead_id", leadId)
    .order("attempt_number", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getActiveAttemptByAgentPhone(
  agentId: string
): Promise<(RoutingAttempt & { lead_id: string }) | null> {
  const { data, error } = await supabase
    .from("routing_attempts")
    .select("*")
    .eq("agent_id", agentId)
    .in("status", ["sms_sent", "followup_sent"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getDeclinedAgentIdsForLead(
  leadId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("routing_attempts")
    .select("agent_id")
    .eq("lead_id", leadId)
    .in("status", ["declined", "timed_out", "error"]);

  if (error) throw error;
  return data.map((row) => row.agent_id);
}

export async function getMaxAttemptNumber(leadId: string): Promise<number> {
  const { data, error } = await supabase
    .from("routing_attempts")
    .select("attempt_number")
    .eq("lead_id", leadId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.attempt_number ?? 0;
}
