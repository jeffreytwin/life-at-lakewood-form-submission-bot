"use client";

import { useEffect, useRef, useCallback } from "react";
import { emitLeadEvent, incrementFailed } from "@/lib/lead-events";

interface LeadSnapshot {
  id: string;
  routing_status: string;
  first_name: string | null;
  last_name: string | null;
  final_agent?: { id: string; name: string; gender?: "male" | "female" | null } | null;
  routing_attempts: Array<{
    attempt_number: number;
    status: string;
    agent?: { id: string; name: string; gender?: "male" | "female" | null } | null;
  }>;
}

const STATUS_SOUNDS: Record<string, string> = {
  accepted: "/sounds/metal-gear-victory.mp3",
  routing: "/sounds/mgs-codec.mp3",
  failed: "/sounds/metal-gear-alert.mp3",
  manual: "/sounds/mgs - manual.mp3",
  owned_by_other: "/sounds/metal-gear-victory.mp3",
};

const NEW_LEAD_SOUND = "/sounds/mgs-new-form.mp3";

// Lead IDs whose next status-change sound should be suppressed
// (because the caller already played the sound inline).
const suppressedLeadIds = new Set<string>();

/** Call this before playing a sound inline to prevent the monitor from duplicating it. */
export function suppressNextSoundForLead(leadId: string) {
  suppressedLeadIds.add(leadId);
}

// Track whether audio playback has been unlocked by a user gesture
let audioUnlocked = false;
let pendingSound: string | null = null;

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  // Play any sound that was blocked before the user interacted
  if (pendingSound) {
    const src = pendingSound;
    pendingSound = null;
    playSound(src);
  }
  document.removeEventListener("click", unlockAudio, true);
  document.removeEventListener("keydown", unlockAudio, true);
}

// Listen for first user gesture to unlock audio
if (typeof document !== "undefined") {
  document.addEventListener("click", unlockAudio, true);
  document.addEventListener("keydown", unlockAudio, true);
}

function playSound(src: string) {
  const audio = new Audio(src);
  audio.volume = 0.6;
  audio.play().catch(() => {
    // Browser blocked autoplay — queue for after first user interaction
    if (!audioUnlocked) {
      pendingSound = src;
    }
  });
}

type EventType = "accepted" | "failed" | "manual" | "new" | "routing" | "owned_by_other" | "followup" | "reroute";

interface ScheduledEvent {
  sound: string;
  event: { type: EventType; leadName: string; agentName?: string; agentGender?: "male" | "female" | null };
}

/** Info we track per lead between poll cycles */
interface LeadState {
  status: string;
  attemptCount: number;
  /** The latest routing attempt status (e.g. sms_sent, followup_sent) */
  latestAttemptStatus: string | null;
}

function getLeadState(lead: LeadSnapshot): LeadState {
  const sorted = [...(lead.routing_attempts ?? [])].sort(
    (a, b) => b.attempt_number - a.attempt_number
  );
  return {
    status: lead.routing_status,
    attemptCount: lead.routing_attempts?.length ?? 0,
    latestAttemptStatus: sorted[0]?.status ?? null,
  };
}

function getLeadName(lead: LeadSnapshot): string {
  return [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unknown";
}

function getLatestAgentName(lead: LeadSnapshot): string | undefined {
  const sorted = [...(lead.routing_attempts ?? [])].sort(
    (a, b) => b.attempt_number - a.attempt_number
  );
  return sorted[0]?.agent?.name ?? undefined;
}

function getLatestAgentGender(lead: LeadSnapshot): "male" | "female" | null | undefined {
  const sorted = [...(lead.routing_attempts ?? [])].sort(
    (a, b) => b.attempt_number - a.attempt_number
  );
  return sorted[0]?.agent?.gender ?? undefined;
}

export default function StatusSoundMonitor() {
  const prevStates = useRef<Map<string, LeadState> | null>(null);

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/internal/leads?status=all&limit=50");
      const data = await r.json();
      if (data.error || !data.leads) return;

      const leads: LeadSnapshot[] = data.leads;

      // On first load, seed the map without playing sounds
      if (prevStates.current === null) {
        prevStates.current = new Map(leads.map((l) => [l.id, getLeadState(l)]));
        return;
      }

      // Collect events, potentially multiple per cycle (queued with delays)
      const immediateEvents: ScheduledEvent[] = [];
      const delayedEvents: ScheduledEvent[] = [];

      for (const lead of leads) {
        const curr = getLeadState(lead);
        const prev = prevStates.current.get(lead.id);
        const name = getLeadName(lead);

        if (!prev) {
          // New lead appeared
          immediateEvents.push({
            sound: NEW_LEAD_SOUND,
            event: { type: "new", leadName: name },
          });

          // If it already jumped to routing, queue a delayed routing event
          if (curr.status === "routing" && curr.attemptCount > 0) {
            delayedEvents.push({
              sound: STATUS_SOUNDS.routing,
              event: {
                type: "routing",
                leadName: name,
                agentName: getLatestAgentName(lead),
                agentGender: getLatestAgentGender(lead),
              },
            });
          }

          // If it already resolved (e.g. owned_by_other is instant), queue a
          // delayed celebration so the "new" bubble plays first.
          if (curr.status === "owned_by_other" || curr.status === "accepted") {
            delayedEvents.push({
              sound: STATUS_SOUNDS[curr.status],
              event: {
                type: curr.status as EventType,
                leadName: name,
                agentName: lead.final_agent?.name ?? undefined,
                agentGender: lead.final_agent?.gender ?? undefined,
              },
            });
          }
        } else if (prev.status !== curr.status) {
          // Status changed
          if (suppressedLeadIds.has(lead.id)) {
            suppressedLeadIds.delete(lead.id);
            continue;
          }

          const sound = STATUS_SOUNDS[curr.status];
          if (sound) {
            let agentName: string | undefined;
            let agentGender: "male" | "female" | null | undefined;
            if (curr.status === "owned_by_other") {
              agentName = lead.final_agent?.name ?? undefined;
              agentGender = lead.final_agent?.gender ?? undefined;
            } else if (curr.status === "routing") {
              agentName = getLatestAgentName(lead);
              agentGender = getLatestAgentGender(lead);
            } else {
              agentName = lead.final_agent?.name ?? undefined;
              agentGender = lead.final_agent?.gender ?? undefined;
            }

            immediateEvents.push({
              sound,
              event: { type: curr.status as EventType, leadName: name, agentName, agentGender },
            });
          }

          if (curr.status === "failed" || curr.status === "manual") {
            incrementFailed();
          }
        } else if (curr.status === "routing") {
          // Status is still "routing" — check for follow-up or re-route
          if (curr.attemptCount > prev.attemptCount) {
            // New routing attempt = re-routed to another agent
            immediateEvents.push({
              sound: STATUS_SOUNDS.routing,
              event: {
                type: "reroute",
                leadName: name,
                agentName: getLatestAgentName(lead),
                agentGender: getLatestAgentGender(lead),
              },
            });
          } else if (
            curr.latestAttemptStatus === "followup_sent" &&
            prev.latestAttemptStatus !== "followup_sent"
          ) {
            // Follow-up was just sent to the current agent
            immediateEvents.push({
              sound: STATUS_SOUNDS.routing,
              event: {
                type: "followup",
                leadName: name,
                agentName: getLatestAgentName(lead),
                agentGender: getLatestAgentGender(lead),
              },
            });
          }
        }
      }

      // Play the highest priority immediate event
      if (immediateEvents.length > 0) {
        // Priority: accepted > owned_by_other > failed > manual > routing > new
        const priorityOrder: EventType[] = ["accepted", "owned_by_other", "failed", "manual", "reroute", "followup", "routing", "new"];
        const best = immediateEvents.sort((a, b) => {
          const ai = priorityOrder.indexOf(a.event.type);
          const bi = priorityOrder.indexOf(b.event.type);
          return ai - bi;
        })[0];

        playSound(best.sound);
        emitLeadEvent(best.event);
      }

      // Play delayed events (e.g. routing after new lead) after a gap
      if (delayedEvents.length > 0) {
        setTimeout(() => {
          const best = delayedEvents[0];
          playSound(best.sound);
          emitLeadEvent(best.event);
        }, 8000); // Wait for new-lead bubble to finish
      }

      // Update tracked states
      prevStates.current = new Map(leads.map((l) => [l.id, getLeadState(l)]));
    } catch {
      // Network error — skip this cycle
    }
  }, []);

  useEffect(() => {
    // Initial seed
    poll();

    const interval = setInterval(poll, 15000);

    // Poll immediately when tab becomes visible again
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        poll();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [poll]);

  // This component renders nothing
  return null;
}
