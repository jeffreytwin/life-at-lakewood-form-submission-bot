"use client";

import { useEffect, useRef, useCallback } from "react";
import { emitLeadEvent, incrementFailed } from "@/lib/lead-events";

interface LeadSnapshot {
  id: string;
  routing_status: string;
  first_name: string | null;
  last_name: string | null;
  owner_name: string | null;
  final_agent?: { id: string; name: string } | null;
  routing_attempts: Array<{
    attempt_number: number;
    agent?: { id: string; name: string } | null;
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

export default function StatusSoundMonitor() {
  const prevMap = useRef<Map<string, string> | null>(null);

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/internal/leads?status=all&limit=50");
      const data = await r.json();
      if (data.error || !data.leads) return;

      const leads: LeadSnapshot[] = data.leads;
      const currentMap = new Map(leads.map((l) => [l.id, l.routing_status]));

      // On first load, seed the map without playing sounds
      if (prevMap.current === null) {
        prevMap.current = currentMap;
        return;
      }

      const soundsToPlay = new Set<string>();

      // Track the highest-priority event to emit (we only show one speech bubble)
      type EventType = "accepted" | "failed" | "manual" | "new" | "routing" | "owned_by_other";
      let bestEvent: { priority: number; type: EventType; lead: LeadSnapshot } | null = null;

      for (const [id, status] of currentMap) {
        const prev = prevMap.current.get(id);
        const lead = leads.find((l) => l.id === id)!;

        if (prev === undefined) {
          // New lead appeared
          soundsToPlay.add(NEW_LEAD_SOUND);
          if (!bestEvent || 4 < (bestEvent?.priority ?? 99)) {
            bestEvent = { priority: 4, type: "new", lead };
          }
        } else if (prev !== status) {
          // If this lead was suppressed (sound + bubble already played inline), skip entirely
          if (suppressedLeadIds.has(id)) {
            suppressedLeadIds.delete(id);
            continue;
          }
          // Status changed — check if we have a sound for the new status
          const sound = STATUS_SOUNDS[status];
          if (sound) soundsToPlay.add(sound);

          // Map status to event (lower number = higher priority)
          const priorityMap: Record<string, number> = { accepted: 0, failed: 1, manual: 2, owned_by_other: 3, routing: 5 };
          if (status in priorityMap) {
            const p = priorityMap[status];
            if (!bestEvent || p < bestEvent.priority) {
              bestEvent = { priority: p, type: status as EventType, lead };
            }
            if (status === "failed") {
              incrementFailed();
            }
          }
        }
      }

      // Play one sound at a time (most important first: accepted > owned > failed > manual > routing > new)
      const priority = [
        STATUS_SOUNDS.accepted,
        STATUS_SOUNDS.owned_by_other,
        STATUS_SOUNDS.failed,
        STATUS_SOUNDS.manual,
        STATUS_SOUNDS.routing,
        NEW_LEAD_SOUND,
      ];

      for (const sound of priority) {
        if (soundsToPlay.has(sound)) {
          playSound(sound);
          break;
        }
      }

      // Emit the lead event for the speech bubble
      if (bestEvent) {
        const name = [bestEvent.lead.first_name, bestEvent.lead.last_name]
          .filter(Boolean)
          .join(" ") || "Unknown";

        // Resolve the agent name based on event type
        let agentName: string | undefined;
        if (bestEvent.type === "owned_by_other") {
          agentName = bestEvent.lead.owner_name ?? undefined;
        } else if (bestEvent.type === "routing") {
          // Get the latest routing attempt's agent name
          const sorted = [...(bestEvent.lead.routing_attempts ?? [])].sort(
            (a, b) => b.attempt_number - a.attempt_number
          );
          agentName = sorted[0]?.agent?.name ?? undefined;
        } else {
          agentName = bestEvent.lead.final_agent?.name ?? undefined;
        }

        emitLeadEvent({ type: bestEvent.type, leadName: name, agentName });
      }

      prevMap.current = currentMap;
    } catch {
      // Network error — skip this cycle
    }
  }, []);

  useEffect(() => {
    // Initial seed
    poll();

    const interval = setInterval(poll, 15000);
    return () => clearInterval(interval);
  }, [poll]);

  // This component renders nothing
  return null;
}
