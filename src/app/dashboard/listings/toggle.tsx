"use client";

import type { CSSProperties } from "react";

// The on/off switch the Email Hub uses for Auto-Approve, in the Listings
// section's colours: green while updates flow, red while they are paused.
const ON = { color: "#34d399", rgb: "52, 211, 153" };
const OFF = { color: "#f87171", rgb: "248, 113, 113" };

interface ToggleProps {
  on: boolean;
  label: string;
  /** What a click does ("Pause Listing Updates"), for the tooltip and screen readers. */
  action?: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  size?: "md" | "sm";
  style?: CSSProperties;
}

export default function Toggle({ on, label, action, disabled, onChange, size = "md", style }: ToggleProps) {
  const palette = on ? ON : OFF;
  const small = size === "sm";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={action ?? label}
      title={action}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: small ? "4px 10px" : "6px 14px",
        fontSize: small ? 12 : 13,
        fontWeight: 600,
        color: palette.color,
        background: `rgba(${palette.rgb}, 0.1)`,
        border: `1px solid ${palette.color}`,
        borderRadius: 6,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "all 0.2s",
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 32,
          height: 18,
          borderRadius: 9,
          background: palette.color,
          position: "relative",
          flexShrink: 0,
          transition: "background 0.2s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: on ? 16 : 2,
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.2s",
          }}
        />
      </span>
      {label}
    </button>
  );
}
