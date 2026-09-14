import { NextRequest, NextResponse } from "next/server";
import {
  claimRoutingAttemptTransition,
  getExpiredAttempts,
} from "@/lib/supabase/queries/routing-attempts";
import { getLeadById } from "@/lib/supabase/queries/leads";
import { getLocationName } from "@/lib/supabase/queries/locations";
import { handleFirstTimeout, handleSecondTimeout } from "@/lib/routing/state-machine";
import { recoverStrandedLeads } from "@/lib/routing/recover-stranded";
import { errorMessage } from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const expiredAttempts = await getExpiredAttempts();

    let processed = 0;
    let skipped = 0;

    if (expiredAttempts.length > 0) {
      logger.info("Processing expired routing attempts", {
        count: expiredAttempts.length,
      });
    }

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

        const locationName =
          (await getLocationName(lead.location_id)) ?? "Life At Lakewood";

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
          leadId: attempt.lead_id,
          error: errorMessage(error),
        });
      }
    }

    // A hand-off that fails after the old attempt is resolved but before the
    // next agent is texted leaves nothing above for this cron to find. Sweep
    // for those leads and put them back in the auction.
    let recovered = 0;
    try {
      recovered = await recoverStrandedLeads();
    } catch (error) {
      logger.error("Stranded lead sweep failed", { error: errorMessage(error) });
    }

    return NextResponse.json({ processed, skipped, recovered });
  } catch (error) {
    logger.error("Cron check-timeouts error", { error: errorMessage(error) });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
