"use client";

import { useEffect, useState } from "react";

type CharacterState =
  | "standing-there"
  | "get-in-box"
  | "in-box"
  | "getting-out-of-box";

const GIF_SRC: Record<CharacterState, string> = {
  "standing-there": "/standing-there.gif",
  "get-in-box": "/get-in-box.gif",
  "in-box": "/in-box.gif",
  "getting-out-of-box": "/getting-out-of-box.gif",
};

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

export default function RoutingToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [character, setCharacter] = useState<CharacterState>("standing-there");
  const [nightActive, setNightActive] = useState(false);

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
          data.quiet_hours_start &&
          data.quiet_hours_end
        ) {
          setNightActive(
            isCurrentlyInQuietHours(data.quiet_hours_start, data.quiet_hours_end)
          );
        }
      })
      .catch(() => {});
  }, []);

  if (enabled === null) return null;

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
        alignItems: "center",
        gap: 0,
      }}
    >
      {/* Character gif — show sneaking only when night mode active and in resting "standing" state */}
      {(() => {
        const showSneaking = nightActive && character === "standing-there";
        const src = showSneaking ? "/sneaking.gif" : GIF_SRC[character];
        const size = showSneaking ? 87 : 109;
        return (
          <img
            key={showSneaking ? "sneaking" : character}
            src={src}
            alt="Character"
            style={{
              width: size,
              height: size,
              imageRendering: "pixelated",
              objectFit: "contain",
              marginBottom: -2,
            }}
          />
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
