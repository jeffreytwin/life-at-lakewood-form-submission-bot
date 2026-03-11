import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { logAuditEvent } from "@/lib/supabase/queries/audit-log";

const payloadSchema = z.object({
  webhook_secret: z.string(),
  salesforce_lead_id: z.string(),
  status: z.enum(["bad_data"]),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = payloadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { webhook_secret, salesforce_lead_id, status } = parsed.data;

    const envSecret = String(
      process.env.ZAPIER_SALESFORCE_STATUS_SECRET || ""
    ).trim();
    if (!webhook_secret.trim() || webhook_secret.trim() !== envSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Look up the lead by its Salesforce record ID
    const { data: lead, error: lookupError } = await supabase
      .from("leads")
      .select("id, routing_status")
      .eq("salesforce_record_id", salesforce_lead_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (lookupError || !lead) {
      logger.error("Salesforce status webhook: lead not found", {
        salesforce_lead_id,
      });
      return NextResponse.json(
        { error: "Lead not found", salesforce_lead_id },
        { status: 404 }
      );
    }

    // Update the lead's routing status
    const { error: updateError } = await supabase
      .from("leads")
      .update({ routing_status: status })
      .eq("id", lead.id);

    if (updateError) {
      logger.error("Salesforce status webhook: failed to update lead", {
        leadId: lead.id,
        error: updateError.message,
      });
      return NextResponse.json(
        { error: "Database error", details: updateError.message },
        { status: 500 }
      );
    }

    await logAuditEvent("lead_marked_bad_data", {
      leadId: lead.id,
      details: {
        source: "salesforce_status_webhook",
        salesforce_lead_id,
        previous_status: lead.routing_status,
        new_status: status,
      },
    });

    logger.info("Salesforce status webhook: lead updated", {
      leadId: lead.id,
      salesforce_lead_id,
      previousStatus: lead.routing_status,
      newStatus: status,
    });

    return NextResponse.json({
      updated: true,
      lead_id: lead.id,
      previous_status: lead.routing_status,
      new_status: status,
    });
  } catch (error) {
    logger.error("Salesforce status webhook error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
