import { supabase } from "../client";
import type { AuditEventType } from "../types";

export async function logAuditEvent(
  eventType: AuditEventType,
  options?: {
    leadId?: string;
    routingAttemptId?: string;
    details?: Record<string, unknown>;
  }
) {
  const { error } = await supabase.from("audit_log").insert({
    event_type: eventType,
    lead_id: options?.leadId ?? null,
    routing_attempt_id: options?.routingAttemptId ?? null,
    details: options?.details ?? null,
  });

  if (error) {
    // Audit logging should never break the main flow
    console.error("Failed to write audit log:", error);
  }
}

export async function getAuditLogForLead(leadId: string) {
  const { data, error } = await supabase
    .from("audit_log")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data;
}
