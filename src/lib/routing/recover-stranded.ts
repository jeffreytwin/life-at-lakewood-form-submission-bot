import { getLeadsInAuction } from "@/lib/supabase/queries/leads";
import { getAttemptsForLeads } from "@/lib/supabase/queries/routing-attempts";
import { getLocationName } from "@/lib/supabase/queries/locations";
import { logAuditEvent } from "@/lib/supabase/queries/audit-log";
import { attemptsNewestFirst } from "@/lib/shared/attempt-order";
import { STRANDED_LEAD_GRACE_MS } from "@/lib/shared/constants";
import { errorMessage } from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";
import { startRouting } from "./state-machine";
import type { Lead, RoutingAttempt } from "@/lib/supabase/types";

const DEFAULT_LOCATION_NAME = "Life At Lakewood";

export interface StrandedLead {
  lead: Lead;
  /** The attempt whose hand-off never completed. */
  lastAttempt: RoutingAttempt;
  /** How long the lead has been sitting with no live attempt. */
  strandedForMs: number;
}

/**
 * Leads the auction has lost track of.
 *
 * Every hand-off resolves the current attempt (declined or timed_out) first,
 * and only then picks the next agent and texts them. Between those two steps
 * the lead has no live attempt, and the timeout cron only ever looks at live
 * attempts. So when the second step fails — a Supabase gateway timeout did
 * exactly this — the lead stays "routing" indefinitely with nobody on the
 * hook, nobody notified, and nothing left for the cron to find.
 *
 * A lead counts as stranded when it is still in the auction, has no live
 * attempt, and its most recent attempt was resolved long enough ago that a
 * merely slow hand-off cannot still be in flight.
 */
export async function findStrandedLeads(
  now: Date = new Date()
): Promise<StrandedLead[]> {
  const leads = await getLeadsInAuction();
  if (leads.length === 0) return [];

  const attempts = await getAttemptsForLeads(leads.map((lead) => lead.id));
  const attemptsByLead = new Map<string, RoutingAttempt[]>();
  for (const attempt of attempts) {
    const list = attemptsByLead.get(attempt.lead_id) ?? [];
    list.push(attempt);
    attemptsByLead.set(attempt.lead_id, list);
  }

  const stranded: StrandedLead[] = [];

  for (const lead of leads) {
    const own = attemptsByLead.get(lead.id) ?? [];

    // A live attempt means the normal timeout flow owns this lead.
    if (own.some((a) => a.status === "sms_sent" || a.status === "followup_sent")) {
      continue;
    }

    // Never offered to anyone: routing was paused at intake, or the webhook
    // died before the first offer. The ownership checks that gate a first
    // offer have not necessarily run for these, so auctioning them from here
    // is not safe. They stay visible in the dashboard as pending.
    if (own.length === 0) continue;

    const [last] = attemptsNewestFirst(own);

    // An accepted attempt on a lead still in the auction is an acceptance
    // whose status write failed. That lead has an owner — never re-auction it.
    if (last.status === "accepted") {
      logger.warn("Lead has an accepted attempt but never left the auction", {
        leadId: lead.id,
        attemptId: last.id,
        agentId: last.agent_id,
        leadStatus: lead.routing_status,
      });
      continue;
    }

    const resolvedAt = Date.parse(last.updated_at);
    if (Number.isNaN(resolvedAt)) continue;

    const strandedForMs = now.getTime() - resolvedAt;
    if (strandedForMs < STRANDED_LEAD_GRACE_MS) continue;

    stranded.push({ lead, lastAttempt: last, strandedForMs });
  }

  return stranded;
}

/**
 * Put every stranded lead back in the auction. Returns how many were resumed.
 *
 * One lead failing does not stop the others. A lead that fails here is still
 * stranded, so the next cron tick simply tries it again.
 */
export async function recoverStrandedLeads(
  now: Date = new Date()
): Promise<number> {
  const stranded = await findStrandedLeads(now);
  let recovered = 0;

  for (const { lead, lastAttempt, strandedForMs } of stranded) {
    try {
      const locationName =
        (await getLocationName(lead.location_id)) ?? DEFAULT_LOCATION_NAME;

      logger.warn("Resuming a stranded lead", {
        leadId: lead.id,
        leadStatus: lead.routing_status,
        lastAttemptId: lastAttempt.id,
        lastAttemptStatus: lastAttempt.status,
        strandedForSeconds: Math.round(strandedForMs / 1000),
      });

      await logAuditEvent("error", {
        leadId: lead.id,
        routingAttemptId: lastAttempt.id,
        details: {
          reason: "routing_resumed",
          note: "The hand-off after this attempt never completed; the timeout cron resumed the auction",
          last_attempt_status: lastAttempt.status,
          stranded_for_seconds: Math.round(strandedForMs / 1000),
        },
      });

      await startRouting(lead, locationName);
      recovered++;
    } catch (error) {
      logger.error("Failed to resume stranded lead", {
        leadId: lead.id,
        error: errorMessage(error),
      });
    }
  }

  return recovered;
}
