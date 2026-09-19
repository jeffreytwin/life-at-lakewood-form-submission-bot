"use client";

import { useCallback, useEffect, useState } from "react";

interface FieldRow {
  key: string;
  type: string;
  displayName: string;
  systemField?: boolean;
}

interface Diff {
  missing: { key: string; type?: string; displayName?: string }[];
  extra: { key: string; type?: string; displayName?: string }[];
  mismatched: { key: string; reference: string; target: string }[];
  relabeled: { key: string; from: string; to: string }[];
  shared: number;
}

interface SiteSchema {
  id: string;
  name: string;
  domain: string;
  collectionId: string;
  found: boolean;
  error: string | null;
  displayName: string | null;
  revision: string | number | null;
  fields: FieldRow[];
  diff: Diff | null;
}

type AlignStep = "add" | "relabel" | "remove";

/**
 * Settings → Sites: every site's Floor Plans V2 collection as Wix has it,
 * against the one standard schema (standard-schema.ts; Jeff, 2026-09-19:
 * labels and field names identical on every site). Each step is its own
 * click: add what a site lacks, apply the standard labels, or remove a
 * site's extra fields (confirmed separately, since that deletes data).
 */
export default function SitesSettingsPage() {
  const [sites, setSites] = useState<SiteSchema[]>([]);
  const [standard, setStandard] = useState<FieldRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showFields, setShowFields] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/internal/floorplans/sites/schema")
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) setError(data.error);
        else {
          setSites(data.sites ?? []);
          setStandard(data.standard?.fields ?? []);
          setError(null);
        }
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

  async function align(site: SiteSchema, step: AlignStep) {
    const d = site.diff;
    const prompts: Record<AlignStep, string> = {
      add: `Add ${d?.missing.length ?? 0} standard field(s) to ${site.domain}'s ${site.collectionId}?`,
      relabel: `Apply the standard labels to ${d?.relabeled.length ?? 0} field(s) of ${site.domain}'s ${site.collectionId}?`,
      remove: `Remove ${d?.extra.length ?? 0} field(s) the standard does not have from ${site.domain}'s ${site.collectionId}? Their data on every item is deleted with them.`,
    };
    if (!confirm(prompts[step])) return;
    setBusy(site.id);
    try {
      const res = await fetch(`/api/internal/floorplans/sites/${site.id}/schema/align`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ add: step === "add", relabel: step === "relabel", removeExtra: step === "remove" }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        alert(`Align failed: ${data?.error ?? res.status}`);
      } else if (!data.changed) {
        alert("Nothing to change.");
      } else {
        alert(
          `Done. Added: ${data.added.join(", ") || "none"}. Relabeled: ${data.relabeled.join(", ") || "none"}. Removed: ${data.removed.join(", ") || "none"}.` +
            (data.mismatched?.length ? ` Left alone (type differs): ${data.mismatched.map((m: { key: string }) => m.key).join(", ")}.` : "")
        );
      }
    } finally {
      setBusy(null);
      load();
    }
  }

  const toggleFields = (id: string) =>
    setShowFields((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const fieldTable = (fields: FieldRow[]) => (
    <table className="table" style={{ marginTop: 12 }}>
      <thead>
        <tr>
          <th>Key</th>
          <th>Type</th>
          <th>Label</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((f) => (
          <tr key={f.key} style={f.systemField ? { opacity: 0.55 } : undefined}>
            <td><code>{f.key}</code></td>
            <td>{f.type}</td>
            <td>{f.displayName}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <div className="page-header">
        <h2>Sites</h2>
        <p>
          The Floor Plans V2 collection on every site, read live from Wix, against the one standard schema every site
          carries (the same field names and labels everywhere; &quot;Neighborhood&quot;, not &quot;Village&quot;). A site
          that matches shows nothing to do. Fields shared with the standard are not listed.
        </p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p className="text-muted">Reading the collections from Wix…</p>}

      {!loading && standard.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <strong>The standard</strong>
            <span className="text-muted text-sm">{standard.length} fields · src/lib/floorplans/standard-floor-plan-schema.json</span>
            <button className="btn btn-secondary" style={{ marginLeft: "auto" }} onClick={() => toggleFields("standard")}>
              {showFields.has("standard") ? "Hide fields" : "Show fields"}
            </button>
          </div>
          {showFields.has("standard") && fieldTable(standard)}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {sites.map((site) => {
          const d = site.diff;
          const inSync = d && !d.missing.length && !d.extra.length && !d.mismatched.length && !d.relabeled.length;
          return (
            <div className="card" key={site.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <strong>{site.domain}</strong>
                <span className="text-muted text-sm">
                  {site.collectionId}
                  {site.displayName ? ` · "${site.displayName}"` : ""}
                  {site.found ? ` · ${site.fields.filter((f) => !f.systemField).length} fields` : ""}
                  {site.revision != null ? ` · revision ${site.revision}` : ""}
                </span>
                {inSync && <span className="badge badge-success">matches the standard</span>}
                {d && !inSync && <span className="badge badge-warning">differs</span>}
                {!site.found && <span className="badge badge-danger">{site.error ?? "not found"}</span>}
                <button className="btn btn-secondary" style={{ marginLeft: "auto" }} onClick={() => toggleFields(site.id)}>
                  {showFields.has(site.id) ? "Hide fields" : "Show fields"}
                </button>
              </div>

              {d && !inSync && (
                <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                  {d.missing.length > 0 && (
                    <div className="text-sm">
                      <strong>Missing here</strong> ({d.missing.length}): {d.missing.map((f) => `${f.key} (${f.type ?? "?"})`).join(", ")}
                    </div>
                  )}
                  {d.relabeled.length > 0 && (
                    <div className="text-sm">
                      <strong>Labeled differently</strong> ({d.relabeled.length}): {d.relabeled.map((r) => `${r.key}: "${r.from}" → "${r.to}"`).join(", ")}
                    </div>
                  )}
                  {d.extra.length > 0 && (
                    <div className="text-sm">
                      <strong>Not in the standard</strong> ({d.extra.length}): {d.extra.map((f) => `${f.key} (${f.type ?? "?"})`).join(", ")}
                    </div>
                  )}
                  {d.mismatched.length > 0 && (
                    <div className="text-sm">
                      <strong>Different type</strong> (left alone): {d.mismatched.map((m) => `${m.key}: ${m.target} here, ${m.reference} in the standard`).join(", ")}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {d.missing.length > 0 && (
                      <button className="btn btn-primary" disabled={busy === site.id} onClick={() => align(site, "add")}>
                        {busy === site.id ? "…" : `Add the ${d.missing.length} missing field${d.missing.length === 1 ? "" : "s"}`}
                      </button>
                    )}
                    {d.relabeled.length > 0 && (
                      <button className="btn btn-primary" disabled={busy === site.id} onClick={() => align(site, "relabel")}>
                        Apply the standard labels ({d.relabeled.length})
                      </button>
                    )}
                    {d.extra.length > 0 && (
                      <button className="btn btn-secondary" disabled={busy === site.id} onClick={() => align(site, "remove")}>
                        Remove the {d.extra.length} extra field{d.extra.length === 1 ? "" : "s"} (deletes their data)
                      </button>
                    )}
                  </div>
                </div>
              )}

              {showFields.has(site.id) && site.found && fieldTable(site.fields)}
            </div>
          );
        })}
      </div>
    </>
  );
}
