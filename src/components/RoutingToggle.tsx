"use client";

import { useEffect, useState } from "react";

export default function RoutingToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/internal/settings")
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.routing_enabled === "boolean") {
          setEnabled(data.routing_enabled);
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
        "Are you sure you want to pause routing? Incoming leads will be saved but NOT routed to agents until you resume."
      )
    ) {
      return;
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
  );
}
