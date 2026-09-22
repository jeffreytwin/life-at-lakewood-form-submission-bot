"use client";

import { useEffect, useRef, useCallback } from "react";
import { emitLeadEvent } from "@/lib/lead-events";
import { LISTINGS_ALERT_SOUND, playSound } from "@/lib/notification-sounds";

interface TroubledRow {
  id: string;
  builder: string;
  community: string;
}

const POLL_MS = 30_000;

/**
 * Watches the builder connections whose last run failed (Jeff,
 * 2026-09-22). One we have not seen before plays the alert and has the
 * character point at Floor Plans → Builder Connections. The first load
 * seeds what is already failing, so old news makes no sound; a connection
 * that fails again after being dismissed comes back as new, because
 * dismissing it takes it out of the set.
 */
export default function BuilderAlertMonitor() {
  const knownIds = useRef<Set<string> | null>(null);

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/internal/floorplans/connections/troubled");
      if (!r.ok) return;
      const data = await r.json();
      const rows: TroubledRow[] = Array.isArray(data?.connections) ? data.connections : [];
      if (knownIds.current === null) {
        knownIds.current = new Set(rows.map((c) => c.id));
        return;
      }
      const fresh = rows.find((c) => c.id && !knownIds.current!.has(c.id));
      knownIds.current = new Set(rows.map((c) => c.id));
      if (fresh) {
        playSound(LISTINGS_ALERT_SOUND);
        emitLeadEvent({
          type: "builder_error",
          leadName: "",
          builderName: `${fresh.builder} · ${fresh.community}`,
        });
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
