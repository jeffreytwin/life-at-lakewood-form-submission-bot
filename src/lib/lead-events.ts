/**
 * Lightweight event bus for lead status changes.
 * StatusSoundMonitor emits; RoutingToggle (speech bubble) and Sidebar (badge) subscribe.
 */

export type LeadEventType = "accepted" | "failed" | "manual" | "new" | "routing" | "owned_by_other";

export interface LeadEvent {
  type: LeadEventType;
  leadName: string;
  agentName?: string;
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

// --- Failed-count badge ---
type BadgeListener = (count: number) => void;
const badgeListeners = new Set<BadgeListener>();
let failedCount = 0;

export function onFailedCount(fn: BadgeListener): () => void {
  badgeListeners.add(fn);
  fn(failedCount); // send current value immediately
  return () => badgeListeners.delete(fn);
}

export function incrementFailed() {
  failedCount++;
  badgeListeners.forEach((fn) => fn(failedCount));
}

export function clearFailed() {
  failedCount = 0;
  badgeListeners.forEach((fn) => fn(failedCount));
}
