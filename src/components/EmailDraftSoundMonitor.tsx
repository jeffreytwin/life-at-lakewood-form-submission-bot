"use client";

import { useEffect, useRef, useCallback } from "react";
import { emitLeadEvent } from "@/lib/lead-events";

interface DraftSnapshot {
  id: string;
  status: string;
  subject: string | null;
  created_at: string;
  sent_at: string | null;
}

const NEW_DRAFT_SOUND = "/sounds/mgs-new-form.mp3";
const SENT_EMAIL_SOUND = "/sounds/metal-gear-victory.mp3";

function playSound(src: string) {
  const audio = new Audio(src);
  audio.volume = 0.6;
  audio.play().catch(() => {});
}

/**
 * Polls email drafts and detects:
 * 1. New drafts appearing (status = "drafted") → play new-form sound + Snake speaks
 * 2. Drafts transitioning to "sent" → play victory sound + fireworks + Snake speaks
 */
export default function EmailDraftSoundMonitor() {
  const knownDraftIds = useRef<Set<string> | null>(null);
  const knownSentIds = useRef<Set<string> | null>(null);

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/internal/email-hub/drafts?limit=50&is_simulation=false");
      const data = await r.json();
      if (data.error || !Array.isArray(data)) return;

      const drafts: DraftSnapshot[] = data;

      // Seed on first load — no sounds
      if (knownDraftIds.current === null || knownSentIds.current === null) {
        knownDraftIds.current = new Set(drafts.map((d) => d.id));
        knownSentIds.current = new Set(
          drafts.filter((d) => d.status === "sent").map((d) => d.id)
        );
        return;
      }

      // Detect new drafts (IDs we haven't seen before with status "drafted")
      let hasNewDraft = false;
      for (const draft of drafts) {
        if (!knownDraftIds.current.has(draft.id) && draft.status === "drafted") {
          hasNewDraft = true;
          break;
        }
      }

      // Detect newly sent emails (were tracked but not previously "sent")
      let hasNewSent = false;
      for (const draft of drafts) {
        if (draft.status === "sent" && !knownSentIds.current.has(draft.id)) {
          hasNewSent = true;
          break;
        }
      }

      // Play sounds and emit events (prioritize sent over new draft)
      if (hasNewSent) {
        playSound(SENT_EMAIL_SOUND);
        emitLeadEvent({ type: "email_sent", leadName: "" });
      } else if (hasNewDraft) {
        playSound(NEW_DRAFT_SOUND);
        emitLeadEvent({ type: "email_draft_new", leadName: "" });
      }

      // Update tracked sets
      knownDraftIds.current = new Set(drafts.map((d) => d.id));
      knownSentIds.current = new Set(
        drafts.filter((d) => d.status === "sent").map((d) => d.id)
      );
    } catch {
      // Network error — skip this cycle
    }
  }, []);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 15000);

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

  return null;
}
