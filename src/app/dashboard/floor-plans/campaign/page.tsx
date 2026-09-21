"use client";

import { useCallback, useEffect, useState } from "react";

interface Alert {
  id: string;
  task_type: string;
  detail: string | null;
  created_at: string;
}

interface TrackedPlan {
  id: string;
  name: string;
  quickMoveIn: boolean;
  site: string | null;
  community: string | null;
  builder: string | null;
  priceDisplay: string | null;
  beds: string;
  baths: string;
  sqft: number | null;
  garages: string | null;
  homeType: string | null;
  score: number | null;
  image: string | null;
  urlSlug: string | null;
  sourceUrl: string | null;
  virtualTourUrl: string | null;
  relatedPlanName: string | null;
  hasQuickMoveIns: boolean | null;
  homes: { id: string; name: string; priceDisplay: string | null }[];
  alerts: Alert[];
  updatedAt: string;
}

interface SearchHit {
  id: string;
  name: string;
  quickMoveIn: boolean;
  tracked: boolean;
  priceDisplay: string | null;
  site: string | null;
  community: string | null;
  builder: string | null;
}

/**
 * The email drip campaign's floor plans (Jeff, 2026-09-21): the frontlines
 * person tracks the plans the campaign talks about, sees what the site
 * shows for each, and gets an alert here (and by text, and from the
 * character) when one of them changes, so the marketing can be changed to
 * match the collection.
 */
export default function CampaignPage() {
  const [plans, setPlans] = useState<TrackedPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    fetch("/api/internal/floorplans/campaign")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.plans)) setPlans(data.plans);
        else setError(data?.error ?? "Failed to load");
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Search as the name is typed, a moment after the last keystroke.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      fetch(`/api/internal/floorplans/campaign/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data) => setHits(Array.isArray(data?.plans) ? data.plans : []))
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  async function setTracked(id: string, tracked: boolean) {
    setBusy((b) => new Set(b).add(id));
    try {
      const res = await fetch(`/api/internal/floorplans/plans/${id}/star`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ starred: tracked }),
      });
      if (!res.ok) alert(`Could not ${tracked ? "track" : "remove"} the plan (HTTP ${res.status})`);
    } finally {
      setBusy((b) => {
        const next = new Set(b);
        next.delete(id);
        return next;
      });
      load();
      if (tracked) {
        setQuery("");
        setHits([]);
      }
    }
  }

  async function markDone(alertId: string) {
    await fetch(`/api/internal/floorplans/tasks/${alertId}/done`, { method: "POST" });
    load();
  }

  const openAlerts = plans.reduce((n, p) => n + p.alerts.length, 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Email Campaign Floor Plans</h2>
          <p className="text-muted">
            The floor plans the email drip campaign talks about. When one of them changes on a site (its name, price,
            neighborhood, availability or quick move-ins), an alert appears here and next to Floor Plans, the character
            says so, and the frontlines agent gets a text, so the marketing can be changed to match.
            {" "}<a href="/dashboard/floor-plans">Floor plan changes →</a>
          </p>
        </div>
        {openAlerts > 0 && <span className="badge badge-warning">⚑ {openAlerts} open alert{openAlerts === 1 ? "" : "s"}</span>}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <label>
          <strong>Add a floor plan</strong>
          <span className="text-muted text-sm"> · type its name; builders share names, so pick the right community</span>
        </label>
        <input
          className="form-input"
          style={{ marginTop: 6 }}
          placeholder="Lori"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searching && <div className="text-muted text-sm" style={{ marginTop: 6 }}>Searching…</div>}
        {hits.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {hits.map((h) => (
              <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--border, #2a2a30)" }}>
                <span style={{ flex: 1 }}>
                  <strong>{h.name}</strong>
                  {h.quickMoveIn && <span className="badge badge-info" style={{ marginLeft: 6 }}>quick move-in</span>}
                  <span className="text-muted text-sm"> · {h.community} · {h.builder} · {h.site}{h.priceDisplay ? ` · ${h.priceDisplay}` : ""}</span>
                </span>
                {h.tracked ? (
                  <span className="text-muted text-sm">tracked</span>
                ) : (
                  <button className="btn btn-primary" style={{ padding: "2px 10px" }} disabled={busy.has(h.id)} onClick={() => setTracked(h.id, true)}>
                    Track
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {query.trim().length >= 2 && !searching && hits.length === 0 && (
          <div className="text-muted text-sm" style={{ marginTop: 6 }}>No live floor plan by that name. A plan has to be approved to the site first.</div>
        )}
      </div>

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : error ? (
        <div className="empty-state">{error}</div>
      ) : plans.length === 0 ? (
        <div className="empty-state">No floor plans are tracked yet. Add the ones the email campaign talks about above.</div>
      ) : (
        plans.map((p) => (
          <div key={p.id} className="card" style={{ marginBottom: 12, borderLeft: p.alerts.length ? "3px solid var(--warning, #b45309)" : undefined }}>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
              {p.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image} alt={p.name} style={{ width: 140, height: 94, objectFit: "cover", borderRadius: 6 }} />
              ) : (
                <div className="text-muted text-sm" style={{ width: 140 }}>no image</div>
              )}
              <div style={{ flex: 1, minWidth: 240 }}>
                <div>
                  <strong style={{ fontSize: 16 }}>{p.name}</strong>
                  {p.quickMoveIn && <span className="badge badge-info" style={{ marginLeft: 8 }}>quick move-in{p.relatedPlanName ? ` of ${p.relatedPlanName}` : ""}</span>}
                </div>
                <div className="text-muted text-sm">
                  {p.community} · {p.builder} · {p.site}
                </div>
                <div className="text-sm" style={{ marginTop: 6 }}>
                  {p.priceDisplay ?? "no price"}
                  {p.beds ? ` · ${p.beds} bd` : ""}
                  {p.baths ? ` · ${p.baths} ba` : ""}
                  {p.sqft ? ` · ${p.sqft.toLocaleString("en-US")} sqft` : ""}
                  {p.garages ? ` · ${p.garages}` : ""}
                  {p.homeType ? ` · ${p.homeType}` : ""}
                  {typeof p.score === "number" ? ` · score ${p.score}` : ""}
                </div>
                {!p.quickMoveIn && (
                  <div className="text-sm" style={{ marginTop: 6 }}>
                    <strong>Availability:</strong>{" "}
                    {p.homes.length
                      ? `${p.homes.length} quick move-in${p.homes.length === 1 ? "" : "s"}: ${p.homes.map((h) => `${h.name}${h.priceDisplay ? ` (${h.priceDisplay})` : ""}`).join(", ")}`
                      : p.hasQuickMoveIns
                        ? "quick move-ins available"
                        : "new construction only"}
                  </div>
                )}
                <div className="text-muted text-sm" style={{ marginTop: 6 }}>
                  {p.urlSlug ? <span>Page: /{p.urlSlug}</span> : <span>Page address not set yet (given on the next write)</span>}
                  {p.sourceUrl && (
                    <>
                      {" · "}<a href={p.sourceUrl} target="_blank" rel="noreferrer">builder page ↗</a>
                    </>
                  )}
                  {p.virtualTourUrl && (
                    <>
                      {" · "}<a href={p.virtualTourUrl} target="_blank" rel="noreferrer">3D tour ↗</a>
                    </>
                  )}
                  {" · "}last written {new Date(p.updatedAt).toLocaleDateString()}
                </div>
                {p.alerts.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    {p.alerts.map((a) => (
                      <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                        <span className="text-sm" style={{ flex: 1, color: "var(--warning, #b45309)" }}>
                          ⚑ {a.detail ?? a.task_type}
                          <span className="text-muted"> · {new Date(a.created_at).toLocaleString()}</span>
                        </span>
                        <button className="btn btn-secondary" style={{ padding: "2px 10px" }} onClick={() => markDone(a.id)}>
                          Marketing updated
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button
                className="btn btn-secondary"
                disabled={busy.has(p.id)}
                onClick={() => {
                  if (confirm(`Stop tracking ${p.name} in the email campaign? Its open alerts stay until marked done.`)) setTracked(p.id, false);
                }}
              >
                Remove
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
