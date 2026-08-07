import { NextRequest, NextResponse } from "next/server";
import {
  claimRoutingAttemptTransition,
  getExpiredAttempts,
} from "@/lib/supabase/queries/routing-attempts";
import { getLeadById } from "@/lib/supabase/queries/leads";
import { supabase } from "@/lib/supabase/client";
import { handleFirstTimeout, handleSecondTimeout } from "@/lib/routing/state-machine";
import { logger } from "@/lib/shared/logger";

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const expiredAttempts = await getExpiredAttempts();

    if (expiredAttempts.length === 0) {
      return NextResponse.json({ processed: 0 });
    }

    logger.info("Processing expired routing attempts", {
      count: expiredAttempts.length,
    });

    let processed = 0;
    let skipped = 0;

    for (const attempt of expiredAttempts) {
      try {
        const lead = await getLeadById(attempt.lead_id);
        if (!lead) {
          logger.warn("Lead not found for expired attempt", {
            attemptId: attempt.id,
            leadId: attempt.lead_id,
          });
          continue;
        }

        // If the lead was resolved after this attempt was fetched (e.g. an
        // acceptance landed moments ago), park the stale attempt instead of
        // sending follow-ups / escalating a settled lead.
        if (lead.routing_status === "accepted" || lead.routing_status === "manual") {
          await claimRoutingAttemptTransition(
            attempt.id,
            ["sms_sent", "followup_sent"],
            "timed_out",
            { expires_at: null }
          );
          logger.warn("Skipped expired attempt — lead already resolved", {
            attemptId: attempt.id,
            leadId: lead.id,
            leadStatus: lead.routing_status,
          });
          skipped++;
          continue;
        }

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

        if (attempt.status === "sms_sent") {
          // First timeout -> send follow-up
          await handleFirstTimeout(attempt);
        } else if (attempt.status === "followup_sent") {
          // Second timeout -> moved on, escalate
          await handleSecondTimeout(attempt, lead, locationName);
        }

        processed++;
      } catch (error) {
        logger.error("Error processing expired attempt", {
          attemptId: attempt.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json({ processed, skipped });
  } catch (error) {
    logger.error("Cron check-timeouts error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
