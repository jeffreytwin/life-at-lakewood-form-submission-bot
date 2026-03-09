import { supabase } from "@/lib/supabase/client";
import { createLead, checkDuplicateLead, updateLeadStatus } from "@/lib/supabase/queries/leads";
import { getFrontlinesAgent } from "@/lib/supabase/queries/agents";
import { logAuditEvent } from "@/lib/supabase/queries/audit-log";
import { sendOwnedByNotification } from "@/lib/twilio/send-sms";
import { startRouting } from "./state-machine";
import { logger } from "@/lib/shared/logger";
import type { ZapierPayload } from "@/lib/shared/validation/zapier-payload";
import type { Lead } from "@/lib/supabase/types";

/**
 * Main entry point: route a lead from a Zapier webhook payload.
 */
export async function routeLead(payload: ZapierPayload): Promise<{
  status: string;
  leadId: string;
}> {
  // De-duplication check
  if (payload.salesforce_record_id) {
    const isDuplicate = await checkDuplicateLead(payload.salesforce_record_id);
    if (isDuplicate) {
      logger.info("Duplicate webhook received, skipping", {
        salesforce_record_id: payload.salesforce_record_id,
      });
      return { status: "duplicate", leadId: "" };
    }
  }

  // Resolve location
  const { data: location } = await supabase
    .from("locations")
    .select("*")
    .eq("name", payload.location)
    .single();

  // Create lead record
  const lead = await createLead({
    salesforce_record_id: payload.salesforce_record_id ?? null,
    location_id: location?.id ?? null,
    form_name: payload.form_name,
    first_name: payload.first_name,
    last_name: payload.last_name,
    email: payload.email ?? null,
    phone: payload.phone ?? null,
    floor_plan: payload.floor_plan ?? null,
    village: payload.village ?? null,
    price: payload.price ?? null,
    home_type: payload.home_type ?? null,
    property_address: payload.property_address ?? null,
    url: payload.url ?? null,
    builder: payload.builder ?? null,
    timeline: payload.timeline ?? null,
    message: payload.message ?? null,
    salesforce_owner_id: payload.salesforce_owner_id ?? null,
    is_master_agent_owned: payload.is_master_agent_owned ?? false,
    raw_payload: payload as unknown as Record<string, unknown>,
    routing_status: "pending",
    final_agent_id: null,
  });

  await logAuditEvent("lead_received", {
    leadId: lead.id,
    details: {
      location: payload.location,
      form_name: payload.form_name,
      contact_name: `${payload.first_name} ${payload.last_name}`,
    },
  });

  const locationName = location?.name ?? payload.location;

  // If the checkbox is unchecked, the lead is owned by a non-frontlines agent
  if (!payload.is_master_agent_owned) {
    return await handleOwnedByOther(lead, locationName);
  }

  // Check if routing is paused system-wide
  const { data: settings } = await supabase
    .from("system_settings")
    .select("routing_enabled")
    .eq("id", 1)
    .single();

  if (settings && !settings.routing_enabled) {
    logger.info("Routing is paused — lead queued as pending", {
      leadId: lead.id,
    });
    await logAuditEvent("lead_received", {
      leadId: lead.id,
      details: { routing_decision: "paused", note: "System routing is paused" },
    });
    return { status: "paused", leadId: lead.id };
  }

  // Route to best available agent
  await startRouting(lead, locationName);

  return { status: "routing", leadId: lead.id };
}

async function handleOwnedByOther(
  lead: Lead,
  locationName: string
): Promise<{ status: string; leadId: string }> {
  // Send notification to frontlines
  const frontlinesAgent = await getFrontlinesAgent();
  const frontlinesPhone = frontlinesAgent?.phone ?? process.env.FRONTLINES_AGENT_PHONE;

  if (frontlinesPhone) {
    await sendOwnedByNotification(frontlinesPhone, lead, locationName);
  }

  await updateLeadStatus(lead.id, "owned_by_other");

  await logAuditEvent("lead_received", {
    leadId: lead.id,
    details: {
      routing_decision: "owned_by_other",
      salesforce_owner_id: lead.salesforce_owner_id,
    },
  });

  logger.info("Lead owned by non-frontlines agent", {
    leadId: lead.id,
    salesforce_owner_id: lead.salesforce_owner_id,
  });

  return { status: "owned_by_other", leadId: lead.id };
}
