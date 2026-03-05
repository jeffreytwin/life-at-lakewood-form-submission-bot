"use client";

import { useEffect, useRef, useState } from "react";

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

// Duration (ms) for the transition gifs before settling to steady state
const TRANSITION_DURATION = 2000;

export default function RoutingToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [character, setCharacter] = useState<CharacterState>("standing-there");
  const initialLoad = useRef(true);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/internal/settings")
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.routing_enabled === "boolean") {
          setEnabled(data.routing_enabled);
          // Set initial character state without transition
          setCharacter(data.routing_enabled ? "standing-there" : "in-box");
          initialLoad.current = false;
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (transitionTimer.current) clearTimeout(transitionTimer.current);
    };
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

    // Clear any existing transition timer
    if (transitionTimer.current) clearTimeout(transitionTimer.current);

    // Start transition animation
    if (newValue) {
      // Turning ON: play "getting out of box", then settle to "standing there"
      setCharacter("getting-out-of-box");
      transitionTimer.current = setTimeout(() => {
        setCharacter("standing-there");
      }, TRANSITION_DURATION);
    } else {
      // Turning OFF: play "get in box", then settle to "in box"
      setCharacter("get-in-box");
      transitionTimer.current = setTimeout(() => {
        setCharacter("in-box");
      }, TRANSITION_DURATION);
    }

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
    } catch {
      alert("Failed to update routing status");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
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
      {/* Character gif */}
      <img
        key={character}
        src={GIF_SRC[character]}
        alt="Character"
        style={{
          width: 109,
          height: 109,
          imageRendering: "pixelated",
          objectFit: "contain",
          marginBottom: -2,
        }}
      />
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
        <span style={{ color: "var(--text-heading)", whiteSpace: "nowrap" }}>
          {enabled ? "Routing Active" : "Routing Paused"}
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
