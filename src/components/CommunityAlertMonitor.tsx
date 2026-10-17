"use client";

import { useEffect, useRef, useCallback } from "react";
import { emitLeadEvent } from "@/lib/lead-events";
import { LISTINGS_ALERT_SOUND, playSound } from "@/lib/notification-sounds";

interface OpenAlert {
  id: string;
  kind: string;
  name: string;
}

const POLL_MS = 30_000;

/**
 * Watches the open Community Alerts (Jeff, 2026-10-17). One we have not
 * seen before plays the alert and has the character name the neighborhood.
 * The first load seeds what is already open, so old news makes no sound.
 */
export default function CommunityAlertMonitor() {
  const knownIds = useRef<Set<string> | null>(null);

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/internal/community-alerts?scope=open");
      if (!r.ok) return;
      const data = await r.json();
      const rows: OpenAlert[] = Array.isArray(data?.alerts) ? data.alerts : [];
      if (knownIds.current === null) {
        knownIds.current = new Set(rows.map((a) => a.id));
        return;
      }
      const fresh = rows.find((a) => a.id && !knownIds.current!.has(a.id));
      knownIds.current = new Set(rows.map((a) => a.id));
      if (fresh?.kind === "sold_out") {
        playSound(LISTINGS_ALERT_SOUND);
        emitLeadEvent({ type: "community_sold_out", leadName: "", communityName: fresh.name });
      }
    } catch {
      // Network error: skip this cycle.
    }
  }, []);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, POLL_MS);
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") poll();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [poll]);

  return null;
}
