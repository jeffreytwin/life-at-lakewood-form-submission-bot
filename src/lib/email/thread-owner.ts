/**
 * Whether the lead behind an email thread already belongs to someone.
 *
 * Two independent signals say it does, and neither implies the other:
 *
 * - Salesforce naming a non-frontlines owner.
 * - The offboarding marker, which outlives ownership: when an agent leaves,
 *   their leads are moved onto the frontlines account, so the owner field
 *   alone reads as unowned from that day forward.
 *
 * Either one means the relationship is spoken for, and the lead is not ours
 * to hand to a new agent — an automatic handoff rewrites the Salesforce
 * owner, which is how one lead ends up with two agents believing it is
 * theirs. Frontlines can still hand it off deliberately by CCing an agent
 * on the reply.
 */
export interface ThreadOwnership {
  salesforce_owner_name?: string | null;
  is_master_agent_owned?: boolean | null;
  previous_agent_offboarded?: string | null;
}

/** The owner's name, or null when the lead is genuinely unowned. */
export function threadOwnerName(source: ThreadOwnership): string | null {
  if (source.previous_agent_offboarded) return source.previous_agent_offboarded;
  if (source.salesforce_owner_name && source.is_master_agent_owned === false) {
    return source.salesforce_owner_name;
  }
  return null;
}
