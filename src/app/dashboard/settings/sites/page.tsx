"use client";

import { useCallback, useEffect, useState } from "react";

interface FieldRow {
  key: string;
  type: string;
  displayName: string;
  systemField: boolean;
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
  diff: {
    missing: { key: string; type?: string; displayName?: string }[];
    extra: { key: string; type?: string; displayName?: string }[];
    mismatched: { key: string; reference: string; target: string }[];
    relabeled: { key: string; from: string; to: string }[];
    shared: number;
  } | null;
}

/**
 * Settings → Sites: every site's Floor Plans V2 collection as Wix has it,
 * compared with the reference site's (Wellen Park by default; Jeff,
 * 2026-09-19: Wellen Park and Parrish are the standard every site follows).
 * Align adds what a site lacks; removing a site's extra fields is a
 * separate, confirmed step because it deletes that data.
 */
export default function SitesSettingsPage() {
  const [sites, setSites] = useState<SiteSchema[]>([]);
  const [reference, setReference] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showFields, setShowFields] = useState<Set<string>>(new Set());

  const load = useCallback((ref?: string | null) => {
    setLoading(true);
    fetch(`/api/internal/floorplans/sites/schema${ref ? `?reference=${ref}` : ""}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) setError(data.error);
        else {
          setSites(data.sites ?? []);
          setReference(data.reference ?? null);
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

  async function align(site: SiteSchema, removeExtra: boolean) {
    if (!reference) return;
    const refSite = sites.find((s) => s.id === reference);
    const what = removeExtra
      ? `Remove ${site.diff?.extra.length ?? 0} field(s) from ${site.domain}'s ${site.collectionId}? Their data on every item is deleted with them.`
      : `Add ${site.diff?.missing.length ?? 0} field(s) from ${refSite?.domain ?? "the reference"} to ${site.domain}'s ${site.collectionId}?`;
    if (!confirm(what)) return;
    setBusy(site.id);
    try {
      const res = await fetch(`/api/internal/floorplans/sites/${site.id}/schema/align`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ referenceSiteId: reference, removeExtra }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        alert(`Align failed: ${data?.error ?? res.status}`);
      } else if (!data.changed) {
        alert("Nothing to change.");
      } else {
        alert(
          `Done. Added: ${data.added.join(", ") || "none"}. Removed: ${data.removed.join(", ") || "none"}. Relabeled: ${data.relabeled.join(", ") || "none"}.` +
            (data.mismatched?.length ? ` Left alone (type differs): ${data.mismatched.map((m: { key: string }) => m.key).join(", ")}.` : "")
        );
      }
    } finally {
      setBusy(null);
      load(reference);
    }
  }

  const toggleFields = (id: string) =>
    setShowFields((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <div className="page-header">
        <h2>Sites</h2>
        <p>
          The Floor Plans V2 collection on every site, read live from Wix, against the standard. Pick the reference site,
          then add what a site lacks. Fields shared by every site are not listed.
        </p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p className="text-muted">Reading the collections from Wix…</p>}

      {!loading && sites.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <label style={{ marginRight: 12 }}>Reference site (the standard):</label>
          <select
            className="form-input"
            style={{ width: "auto", display: "inline-block" }}
            value={reference ?? ""}
            onChange={(e) => load(e.target.value)}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.domain}
              </option>
            ))}
          </select>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {sites.map((site) => {
          const isRef = site.id === reference;
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
                {isRef && <span className="badge badge-success">reference</span>}
                {!isRef && inSync && <span className="badge badge-success">matches</span>}
                {!isRef && d && !inSync && <span className="badge badge-warning">differs</span>}
                {!site.found && <span className="badge badge-danger">{site.error ?? "not found"}</span>}
                <button className="btn btn-secondary" style={{ marginLeft: "auto" }} onClick={() => toggleFields(site.id)}>
                  {showFields.has(site.id) ? "Hide fields" : "Show fields"}
                </button>
              </div>

              {!isRef && d && !inSync && (
                <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                  {d.missing.length > 0 && (
                    <div>
                      <div className="text-sm">
                        <strong>Missing here</strong> ({d.missing.length}): {d.missing.map((f) => `${f.key} (${f.type ?? "?"})`).join(", ")}
                      </div>
                    </div>
                  )}
                  {d.relabeled.length > 0 && (
                    <div className="text-sm">
                      <strong>Labeled differently</strong> ({d.relabeled.length}): {d.relabeled.map((r) => `${r.key}: "${r.from}" → "${r.to}"`).join(", ")}
                    </div>
                  )}
                  {d.extra.length > 0 && (
                    <div className="text-sm">
                      <strong>Only on this site</strong> ({d.extra.length}): {d.extra.map((f) => `${f.key} (${f.type ?? "?"})`).join(", ")}
                    </div>
                  )}
                  {d.mismatched.length > 0 && (
                    <div className="text-sm">
                      <strong>Different type</strong> (left alone): {d.mismatched.map((m) => `${m.key}: ${m.target} here, ${m.reference} on the reference`).join(", ")}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {(d.missing.length > 0 || d.relabeled.length > 0) && (
                      <button className="btn btn-primary" disabled={busy === site.id} onClick={() => align(site, false)}>
                        {busy === site.id ? "…" : `Add the ${d.missing.length} missing field${d.missing.length === 1 ? "" : "s"}${d.relabeled.length ? " and relabel" : ""}`}
                      </button>
                    )}
                    {d.extra.length > 0 && (
                      <button className="btn btn-secondary" disabled={busy === site.id} onClick={() => align(site, true)}>
                        Remove the {d.extra.length} extra field{d.extra.length === 1 ? "" : "s"} (deletes their data)
                      </button>
                    )}
                  </div>
                </div>
              )}

              {showFields.has(site.id) && site.found && (
                <table className="table" style={{ marginTop: 12 }}>
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Type</th>
                      <th>Label</th>
                    </tr>
                  </thead>
                  <tbody>
                    {site.fields.map((f) => (
                      <tr key={f.key} style={f.systemField ? { opacity: 0.55 } : undefined}>
                        <td><code>{f.key}</code></td>
                        <td>{f.type}</td>
                        <td>{f.displayName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
