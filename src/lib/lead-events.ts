/**
 * Lightweight event bus for lead status changes.
 * StatusSoundMonitor emits; RoutingToggle (speech bubble) and Sidebar (badge) subscribe.
 */

export type LeadEventType = "accepted" | "failed" | "manual" | "new" | "routing" | "owned_by_other" | "unavailable_owner" | "followup" | "reroute" | "done" | "text_me" | "bad_data" | "email_draft_new" | "email_draft_approved" | "email_sent";

export interface LeadEvent {
  type: LeadEventType;
  leadName: string;
  agentName?: string;
  agentGender?: "male" | "female" | null;
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
