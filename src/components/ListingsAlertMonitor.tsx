"use client";

import { useEffect, useRef, useCallback } from "react";
import { emitLeadEvent } from "@/lib/lead-events";
import { LISTINGS_ALERT_SOUND, playSound } from "@/lib/notification-sounds";

interface ListingsErrorRow {
  id: string;
}

/** Enough rows to spot new ones between polls without pulling the whole panel. */
const PAGE = 20;
/** Listings problems are not as time-critical as a live lead, so this polls half as often. */
const POLL_MS = 30_000;

/**
 * Watches the listings engine's open errors. An error nobody has dismissed
 * yet that we have not seen before plays the alert and has the character
 * point at the Listings area.
 *
 * Only problems that need a person reach this list: anything the engine
 * retries by itself is recorded as a warning and stays in the Change Log.
 * So every sound from here is worth interrupting for.
 */
export default function ListingsAlertMonitor() {
  const knownIds = useRef<Set<string> | null>(null);

  const poll = useCallback(async () => {
    try {
      const r = await fetch(`/api/internal/listings/errors?limit=${PAGE}`);
      if (!r.ok) return;
      const data = await r.json();
      const errors: ListingsErrorRow[] = Array.isArray(data?.errors) ? data.errors : [];

      // First load seeds what is already open: no sound for old news.
      if (knownIds.current === null) {
        knownIds.current = new Set(errors.map((e) => e.id));
        return;
      }

      const fresh = errors.some((e) => e.id && !knownIds.current!.has(e.id));
      knownIds.current = new Set(errors.map((e) => e.id));
      if (fresh) {
        playSound(LISTINGS_ALERT_SOUND);
        emitLeadEvent({ type: "listings_alert", leadName: "" });
      }
    } catch {
      // Network error — skip this cycle.
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
