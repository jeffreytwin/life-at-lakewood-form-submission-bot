"use client";

import { useEffect, useState, useRef } from "react";
import SpeechBubble from "./SpeechBubble";
import { onLeadEvent, triggerWelcome } from "@/lib/lead-events";
import { type BotCharacterGifs } from "@/lib/bot-characters";
import { useActiveCharacter } from "@/lib/bot-characters/use-active-character";

type CharacterState =
  | "standing-there"
  | "get-in-box"
  | "in-box"
  | "getting-out-of-box"
  | "celebrating";

function gifFor(state: CharacterState, gifs: BotCharacterGifs): string {
  switch (state) {
    case "standing-there": return gifs.standing;
    case "get-in-box": return gifs.getInBox;
    case "in-box": return gifs.inBox;
    case "getting-out-of-box": return gifs.gettingOutOfBox;
    case "celebrating": return gifs.celebrating;
  }
}

const DEFAULT_CELEBRATION_DURATION_MS = 3000;

/**
 * Check if the current Eastern time falls within a start→end range.
 * Handles overnight spans (e.g. 21:00 → 08:30).
 */
function isCurrentlyInQuietHours(start: string, end: string): boolean {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  return startMin <= endMin
    ? nowMin >= startMin && nowMin < endMin
    : nowMin >= startMin || nowMin < endMin;
}

/**
 * Pick the correct end time based on whether the quiet-hours "morning"
 * falls on a weekday or weekend.
 */
function getEffectiveEnd(start: string, endWeekday: string, endWeekend: string): string {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const [ewh, ewm] = endWeekday.split(":").map(Number);
  const endWeekdayMin = ewh * 60 + ewm;

  const day = now.getDay(); // 0=Sun, 6=Sat
  let endDay: number;
  if (startMin > endWeekdayMin) {
    // Overnight range
    endDay = nowMin >= startMin ? (day + 1) % 7 : day;
  } else {
    endDay = day;
  }
  const isWeekend = endDay === 0 || endDay === 6;
  return isWeekend ? endWeekend : endWeekday;
}

export default function RoutingToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [character, setCharacter] = useState<CharacterState>("standing-there");
  const [nightActive, setNightActive] = useState(false);
  const [hidden, setHidden] = useState(false);
  const celebrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preCharacter = useRef<CharacterState>("standing-there");
  // Active character resolves from the schedule (cached + subscribed); the
  // component re-renders when the schedule loads or when the user saves a
  // new schedule via the editor on the Agents page.
  const activeCharacter = useActiveCharacter();
  // Mirror activeCharacter into a ref so the celebration listener (whose
  // useEffect has empty deps) always reads the current character's
  // celebrationDurationMs, not the one captured at mount before the
  // schedule loaded.
  const activeCharacterRef = useRef(activeCharacter);
  useEffect(() => {
    activeCharacterRef.current = activeCharacter;
  }, [activeCharacter]);

  // Preload every GIF so the first transition between states (especially
  // standing → celebrating) doesn't flash blank while the new image loads.
  useEffect(() => {
    Object.values(activeCharacter.gifs).forEach((src) => {
      const img = new Image();
      img.src = src;
    });
  }, [activeCharacter]);

  useEffect(() => {
    fetch("/api/internal/settings")
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.routing_enabled === "boolean") {
          setEnabled(data.routing_enabled);
          // Set initial character state without transition
          setCharacter(data.routing_enabled ? "standing-there" : "in-box");
        }
        // Check if night mode is currently active
        if (
          data.quiet_hours_enabled &&
          data.quiet_hours_start
        ) {
          const effectiveEnd = getEffectiveEnd(
            data.quiet_hours_start,
            data.quiet_hours_end_weekday ?? data.quiet_hours_end ?? "06:30",
            data.quiet_hours_end_weekend ?? data.quiet_hours_end ?? "08:30"
          );
          setNightActive(
            isCurrentlyInQuietHours(data.quiet_hours_start, effectiveEnd)
          );
        }
      })
      .catch(() => {});
  }, []);

  // Play celebration animation when a lead is accepted, marked done, or an email is sent
  const playCelebration = useRef<() => void>(() => {});
  useEffect(() => {
    playCelebration.current = () => {
      // Clear any existing celebration timer
      if (celebrationTimer.current) clearTimeout(celebrationTimer.current);

      // Remember the current state so we can return to it
      setCharacter((prev) => {
        if (prev !== "celebrating") preCharacter.current = prev;
        return "celebrating";
      });

      // Return to previous state after the animation plays
      const duration = activeCharacterRef.current.celebrationDurationMs ?? DEFAULT_CELEBRATION_DURATION_MS;
      celebrationTimer.current = setTimeout(() => {
        setCharacter(preCharacter.current);
        celebrationTimer.current = null;
      }, duration);
    };
  }, []);

  useEffect(() => {
    const unsub = onLeadEvent((event) => {
      if (
        event.type !== "accepted" &&
        event.type !== "done" &&
        event.type !== "email_sent"
      ) {
        return;
      }
      playCelebration.current();
    });

    return () => {
      unsub();
      if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
    };
  }, []);

  if (enabled === null) return null;

  if (hidden) {
    return (
      <button
        className="routing-toggle-wrapper"
        onClick={() => setHidden(false)}
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: 1000,
          background: "var(--bg-card)",
          border: `1px solid ${enabled ? "var(--success)" : "var(--danger)"}`,
          borderRadius: "var(--radius)",
          padding: "6px 12px",
          boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
          fontSize: 12,
          color: "var(--text-muted)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: enabled ? "var(--success)" : "var(--danger)",
          }}
        />
        {enabled ? "Routing Active" : "Routing Paused"}
      </button>
    );
  }

  async function toggle() {
    if (enabled === null) return;
    const newValue = !enabled;

    if (
      !newValue &&
      !confirm(
        "Are you sure you want to pause routing? Incoming form submissions will be saved but NOT routed to agents until you resume."
      )
    ) {
      return;
    }

    // Play transition animation (V2 GIFs don't loop — they stop on last frame)
    setCharacter(newValue ? "getting-out-of-box" : "get-in-box");

    setBusy(true);
    try {
      const res = await fetch("/api/internal/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routing_enabled: newValue }),
      });
      const data = await res.json();
      if (typeof data.routing_enabled === "boolean") {
        setEnabled(data.routing_enabled);
      }

      // After the transition GIF finishes (~1.2s), settle into the resting state
      setTimeout(() => {
        setCharacter(newValue ? "standing-there" : "in-box");
      }, 1200);
    } catch {
      alert("Failed to update routing status");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="routing-toggle-wrapper"
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 0,
      }}
    >
      {/* Character gif — show sneaking only when night mode active and in resting "standing" state */}
      {(() => {
        const showSneaking = nightActive && character === "standing-there";
        const src = showSneaking
          ? activeCharacter.gifs.sneaking
          : gifFor(character, activeCharacter.gifs);
        const baseSize = showSneaking ? 87 : 109;
        const scale = showSneaking
          ? (activeCharacter.sneakingSizeScale ?? activeCharacter.gifSizeScale ?? 1)
          : (activeCharacter.gifSizeScale ?? 1);
        const size = Math.round(baseSize * scale);
        return (
          <div className="routing-character" style={{ position: "relative", marginBottom: -2, display: "flex", alignItems: "flex-start" }}>
            <SpeechBubble />
            <img
              src={src}
              alt="Character"
              onClick={() => {
                triggerWelcome();
                playCelebration.current();
              }}
              style={{
                width: size,
                height: size,
                imageRendering: "pixelated",
                objectFit: "contain",
                transform: activeCharacter.avatarTransform ?? "none",
                cursor: "pointer",
              }}
            />
            <button
              className="routing-hide-btn"
              onClick={() => setHidden(true)}
              title="Hide animation"
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                width: 20,
                height: 20,
                borderRadius: "50%",
                border: "1px solid var(--border)",
                background: "var(--bg-card)",
                color: "var(--text-muted)",
                fontSize: 12,
                lineHeight: 1,
                cursor: "pointer",
                display: "none",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              &times;
            </button>
          </div>
        );
      })()}
      {/* Toggle bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--bg-card)",
          border: `1px solid ${enabled ? "var(--success)" : "var(--danger)"}`,
          borderRadius: "var(--radius)",
          padding: "8px 14px",
          boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: enabled ? "var(--success)" : "var(--danger)",
            flexShrink: 0,
          }}
        />
        <span style={{ color: "var(--text-heading)", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}>
          {enabled
            ? nightActive
              ? <>Routing Active (Quiet Hours){" "}
                  <span
                    title="During quiet hours, form submissions are still assigned and the agent receives an SMS, but the follow-up sequence is deferred until the morning. Agents can still reply YES/NO at any time."
                    style={{ cursor: "help", display: "inline-flex", alignItems: "center" }}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                      <circle cx="8" cy="8" r="6.5" />
                      <line x1="8" y1="7" x2="8" y2="11" />
                      <line x1="8" y1="5" x2="8" y2="5.01" strokeWidth="2" />
                    </svg>
                  </span>
                </>
              : "Routing Active"
            : "Routing Paused"}
        </span>
        <button
          onClick={toggle}
          disabled={busy}
          className={`btn btn-sm ${enabled ? "btn-danger" : "btn-primary"}`}
          style={{ padding: "4px 10px", fontSize: 12 }}
        >
          {busy ? "..." : enabled ? "Pause" : "Resume"}
        </button>
      </div>
    </div>
  );
}
