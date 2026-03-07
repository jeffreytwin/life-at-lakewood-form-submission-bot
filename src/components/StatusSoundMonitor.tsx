"use client";

import { useEffect, useRef, useCallback } from "react";

interface LeadSnapshot {
  id: string;
  routing_status: string;
}

const STATUS_SOUNDS: Record<string, string> = {
  accepted: "/sounds/metal-gear-victory.mp3",
  routing: "/sounds/mgs-codec.mp3",
  failed: "/sounds/metal-gear-alert.mp3",
  manual: "/sounds/mgs - manual.mp3",
};

const NEW_LEAD_SOUND = "/sounds/mgs-new-form.mp3";

// Lead IDs whose next status-change sound should be suppressed
// (because the caller already played the sound inline).
const suppressedLeadIds = new Set<string>();

/** Call this before playing a sound inline to prevent the monitor from duplicating it. */
export function suppressNextSoundForLead(leadId: string) {
  suppressedLeadIds.add(leadId);
}

function playSound(src: string) {
  const audio = new Audio(src);
  audio.volume = 0.6;
  audio.play().catch(() => {
    // Browser may block autoplay until user interaction — ignore silently
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

      for (const [id, status] of currentMap) {
        const prev = prevMap.current.get(id);

        if (prev === undefined) {
          // New lead appeared
          soundsToPlay.add(NEW_LEAD_SOUND);
        } else if (prev !== status) {
          // If this lead was suppressed (sound already played inline), skip it
          if (suppressedLeadIds.has(id)) {
            suppressedLeadIds.delete(id);
            continue;
          }
          // Status changed — check if we have a sound for the new status
          const sound = STATUS_SOUNDS[status];
          if (sound) soundsToPlay.add(sound);
        }
      }

      // Play one sound at a time (most important first: accepted > failed > manual > routing > new)
      const priority = [
        STATUS_SOUNDS.accepted,
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
