"use client";

import { useEffect, useRef, useCallback } from "react";
import { emitLeadEvent } from "@/lib/lead-events";
import { LISTINGS_ALERT_SOUND, playSound } from "@/lib/notification-sounds";

interface AlertRow {
  id: string;
}

const POLL_MS = 30_000;

/**
 * Watches the email campaign's open alerts (fp_follow_up_tasks): a floor
 * plan in the drip campaign changed on a site (Jeff, 2026-09-21). One we
 * have not seen before plays the alert and has the character point at
 * Floor Plans → Email campaign. The first load seeds what is already open,
 * so old news makes no sound.
 */
export default function CampaignAlertMonitor() {
  const knownIds = useRef<Set<string> | null>(null);

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/internal/floorplans/tasks");
      if (!r.ok) return;
      const data = await r.json();
      const alerts: AlertRow[] = Array.isArray(data) ? data : [];
      if (knownIds.current === null) {
        knownIds.current = new Set(alerts.map((a) => a.id));
        return;
      }
      const fresh = alerts.some((a) => a.id && !knownIds.current!.has(a.id));
      knownIds.current = new Set(alerts.map((a) => a.id));
      if (fresh) {
        playSound(LISTINGS_ALERT_SOUND);
        emitLeadEvent({ type: "floorplan_campaign", leadName: "" });
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
