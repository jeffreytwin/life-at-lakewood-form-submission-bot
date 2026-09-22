/**
 * Lightweight event bus for lead status changes.
 * StatusSoundMonitor emits; RoutingToggle (speech bubble) and Sidebar (badge) subscribe.
 */

export type LeadEventType = "accepted" | "failed" | "manual" | "new" | "routing" | "owned_by_other" | "unavailable_owner" | "followup" | "reroute" | "done" | "text_me" | "bad_data" | "email_draft_new" | "email_draft_approved" | "email_sent" | "listings_alert" | "floorplan_campaign" | "builder_error";

export interface LeadEvent {
  type: LeadEventType;
  leadName: string;
  /**
   * The agent the event is about. For "routing", "followup" and "reroute"
   * that is the agent who holds the lead now — on a re-route, the one the
   * lead is going TO. The agent who let it go is `previousAgentName`.
   */
  agentName?: string;
  agentGender?: "male" | "female" | null;
  /**
   * "reroute" only: the agent the lead just moved away from, because they
   * timed out or declined. Absent when the monitor cannot tell who that was.
   */
  previousAgentName?: string;
  /** "builder_error" only: which connection failed, as "Builder · Community". */
  builderName?: string;
}

type LeadEventListener = (event: LeadEvent) => void;

const listeners = new Set<LeadEventListener>();

export function onLeadEvent(fn: LeadEventListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitLeadEvent(event: LeadEvent) {
  listeners.forEach((fn) => fn(event));
}

// --- Attention-count badge (failed + manual) ---
type BadgeListener = (count: number) => void;
const badgeListeners = new Set<BadgeListener>();
let attentionCount = 0;

export function onFailedCount(fn: BadgeListener): () => void {
  badgeListeners.add(fn);
  fn(attentionCount); // send current value immediately
  return () => badgeListeners.delete(fn);
}

export function incrementFailed() {
  attentionCount++;
  badgeListeners.forEach((fn) => fn(attentionCount));
}

export function clearFailed() {
  attentionCount = 0;
  badgeListeners.forEach((fn) => fn(attentionCount));
}
