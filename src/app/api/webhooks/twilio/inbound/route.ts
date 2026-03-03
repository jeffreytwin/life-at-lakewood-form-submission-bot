import { NextRequest, NextResponse } from "next/server";
import { getAgentByPhone } from "@/lib/supabase/queries/agents";
import { getActiveAttemptByAgentPhone } from "@/lib/supabase/queries/routing-attempts";
import { getLeadById } from "@/lib/supabase/queries/leads";
import { supabase } from "@/lib/supabase/client";
import { classifyResponse } from "@/lib/twilio/parse-response";
import { validateTwilioRequest } from "@/lib/twilio/validate-request";
import {
  handleAcceptance,
  handleDecline,
  handleUnclearResponse,
} from "@/lib/routing/state-machine";
import { logAuditEvent } from "@/lib/supabase/queries/audit-log";
import { logger } from "@/lib/shared/logger";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const body: Record<string, string> = {};
    formData.forEach((value, key) => {
      body[key] = value.toString();
    });

    // Validate Twilio signature (skip in development)
    if (process.env.NODE_ENV === "production") {
      if (!validateTwilioRequest(request, body)) {
        logger.warn("Invalid Twilio signature on inbound SMS");
        return new NextResponse("<Response/>", {
          status: 403,
          headers: { "Content-Type": "text/xml" },
        });
      }
    }

    const from = body.From;
    const messageBody = body.Body?.trim() ?? "";
    const messageSid = body.MessageSid;

    logger.info("Inbound SMS received", { from, body: messageBody, messageSid });

    // Find the agent by phone number
    const agent = await getAgentByPhone(from);
    if (!agent) {
      logger.info("SMS from unknown number, ignoring", { from });
      return new NextResponse("<Response/>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }

    // Find their active routing attempt
    const attempt = await getActiveAttemptByAgentPhone(agent.id);
    if (!attempt) {
      logger.info("No active routing attempt for agent", {
        agentName: agent.name,
        from,
      });
      return new NextResponse("<Response/>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }

    // Get the lead
    const lead = await getLeadById(attempt.lead_id);
    if (!lead) {
      logger.error("Lead not found for routing attempt", {
        attemptId: attempt.id,
        leadId: attempt.lead_id,
      });
      return new NextResponse("<Response/>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }

    // Classify the response
    const classification = classifyResponse(messageBody);

    await logAuditEvent("sms_received", {
      leadId: lead.id,
      routingAttemptId: attempt.id,
      details: {
        agent_name: agent.name,
        response: messageBody,
        classification,
        message_sid: messageSid,
      },
    });

    // Resolve location name
    let locationName = "Life At Lakewood";
    if (lead.location_id) {
      const { data: location } = await supabase
        .from("locations")
        .select("name")
        .eq("id", lead.location_id)
        .single();
      if (location) locationName = location.name;
    }

    switch (classification) {
      case "affirmative":
        await handleAcceptance(attempt, lead, messageBody);
        break;
      case "negative":
        await handleDecline(attempt, lead, locationName, messageBody);
        break;
      case "unclear":
        await handleUnclearResponse(attempt, lead, messageBody);
        break;
    }

    // Return empty TwiML response (we send SMS via API, not TwiML)
    return new NextResponse("<Response/>", {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  } catch (error) {
    logger.error("Twilio inbound webhook error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new NextResponse("<Response/>", {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }
}
