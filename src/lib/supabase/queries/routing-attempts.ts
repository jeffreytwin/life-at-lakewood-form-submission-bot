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

/**
 * Count today's accepted routing attempts per agent (bot-local source of truth).
 * Uses Eastern time to match the Salesforce daily boundary.
 */
export async function getTodayAcceptedCountsByAgent(): Promise<
  Map<string, number>
> {
  // Get today's date in Eastern time
  const now = new Date();
  const etDate = now.toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  }); // "2026-03-15"

  // Query a wide UTC window (last 30 hours) then filter by ET date in code.
  // This avoids fragile UTC↔ET offset calculations while staying correct.
  const windowStart = new Date(now.getTime() - 30 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from("routing_attempts")
    .select("agent_id, created_at")
    .eq("status", "accepted")
    .gte("created_at", windowStart.toISOString());

  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    // Filter to only rows whose created_at falls on today in Eastern time
    const rowETDate = new Date(row.created_at).toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });
    if (rowETDate === etDate) {
      counts.set(row.agent_id, (counts.get(row.agent_id) ?? 0) + 1);
    }
  }
  return counts;
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
