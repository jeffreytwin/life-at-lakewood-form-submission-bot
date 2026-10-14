"use client";

import { useEffect, useState } from "react";
import FloorPlanTabs from "../tabs";

interface Hit {
  id: string;
  name: string;
  quickMoveIn: boolean;
  site: string | null;
  community: string | null;
  builder: string | null;
  priceDisplay: string | null;
  homeType: string | null;
  beds: string | null;
  baths: string | null;
  sqft: number | null;
  waitingId: string | null;
}

/**
 * Adjust a Floor Plan (Jeff, 2026-10-14): a plan already on the site,
 * found by name and queued as it stands, to be put right in the same edit
 * overlay and approved like any change. The sync keeps what is set here
 * (userEditedFields), so the builder's pages do not undo it.
 */
export default function AdjustPage() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Search as the name is typed, a moment after the last keystroke.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      fetch(`/api/internal/floorplans/adjustments?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data) => setHits(Array.isArray(data?.plans) ? data.plans : []))
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  /** Queues the plan (or finds the adjustment already waiting) and opens it in the Changes overlay. */
  async function adjust(hit: Hit) {
    setBusy(hit.id);
    try {
      let id = hit.waitingId;
      if (!id) {
        const res = await fetch("/api/internal/floorplans/adjustments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ planId: hit.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || typeof data?.id !== "string") {
          alert(`Could not queue ${hit.name} for adjustment: ${data?.error ?? `HTTP ${res.status}`}`);
          return;
        }
        id = data.id as string;
      }
      window.location.href = `/dashboard/floor-plans?edit=${encodeURIComponent(id)}`;
    } finally {
      setBusy(null);
    }
  }

  const facts = (h: Hit) =>
    [
      h.homeType,
      h.beds ? `${h.beds} bd` : null,
      h.baths ? `${h.baths} ba` : null,
      h.sqft ? `${h.sqft.toLocaleString("en-US")} sq ft` : null,
      h.priceDisplay,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Adjust a Floor Plan</h2>
          <p className="text-muted">
            Put right a floor plan or quick move-in that is already on the site: a wrong home type, price, bedrooms, photos
            or anything else the edit overlay holds. Adjust puts the plan in the Changes queue as it stands and opens it
            there; change what is wrong, Save, and approve it like any change. What you set is kept: the nightly sync
            will not put the builder&apos;s version back.
          </p>
        </div>
      </div>
      <FloorPlanTabs />

      <div className="card" style={{ marginBottom: 16 }}>
        <label>
          <strong>Find the plan</strong>
          <span className="text-muted text-sm"> · a plan&apos;s name, or a home&apos;s street; builders share names, so pick the right community</span>
        </label>
        <input
          className="form-input"
          style={{ marginTop: 6 }}
          placeholder="Siesta, or Buckskin Drive"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {searching && <div className="text-muted text-sm" style={{ marginTop: 6 }}>Searching…</div>}
        {hits.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {hits.map((h) => (
              <div
                key={h.id}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--border, #2a2a30)", flexWrap: "wrap" }}
              >
                <span style={{ flex: 1, minWidth: 220 }}>
                  <strong>{h.name}</strong>
                  {h.quickMoveIn && <span className="badge badge-info" style={{ marginLeft: 6 }}>quick move-in</span>}
                  <span className="text-muted text-sm"> · {h.community} · {h.builder} · {h.site}</span>
                  <div className="text-sm">{facts(h)}</div>
                </span>
                <button className="btn btn-primary" style={{ padding: "2px 10px" }} disabled={busy !== null} onClick={() => adjust(h)}>
                  {busy === h.id ? "Opening…" : h.waitingId ? "Open adjustment" : "Adjust"}
                </button>
              </div>
            ))}
          </div>
        )}
        {query.trim().length >= 2 && !searching && hits.length === 0 && (
          <div className="text-muted text-sm" style={{ marginTop: 6 }}>
            Nothing on the site by that name. A plan the sync has found but not yet written is in the Changes queue already.
          </div>
        )}
      </div>
    </div>
  );
}
