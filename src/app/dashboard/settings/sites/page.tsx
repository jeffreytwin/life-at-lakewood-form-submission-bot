"use client";

import { useCallback, useEffect, useState } from "react";

interface FieldRow {
  key: string;
  type: string;
  displayName: string;
  systemField: boolean;
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
  legacyCollectionId: string | null;
  found: boolean;
  error: string | null;
  displayName: string | null;
  revision: string | number | null;
  fields: FieldRow[];
  diff: Diff | null;
  legacyLabels: { relabeled: Diff["relabeled"]; missing: string[] } | null;
}

interface Reference {
  siteId: string;
  collectionId: string;
}

type AlignStep = "add" | "relabel" | "remove" | "labels-from-legacy";

/**
 * Settings → Sites: every site's Floor Plans V2 collection as Wix has it,
 * compared with a reference collection (Wellen Park's V2 by default; Jeff,
 * 2026-09-19: Wellen Park and Parrish are the standard every site follows).
 * Each step is its own click: add what a site lacks, take the reference's
 * labels, take the labels from the site's own legacy Floor Plans, or remove
 * a site's extra fields (confirmed separately, since that deletes data).
 */
export default function SitesSettingsPage() {
  const [sites, setSites] = useState<SiteSchema[]>([]);
  const [reference, setReference] = useState<Reference | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showFields, setShowFields] = useState<Set<string>>(new Set());

  const load = useCallback((ref?: Reference | null) => {
    setLoading(true);
    const query = ref ? `?reference=${ref.siteId}&referenceCollection=${encodeURIComponent(ref.collectionId)}` : "";
    fetch(`/api/internal/floorplans/sites/schema${query}`)
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

  async function align(site: SiteSchema, step: AlignStep) {
    if (!reference) return;
    const d = site.diff;
    const refSite = sites.find((s) => s.id === reference.siteId);
    const refLabel = `${refSite?.domain ?? "the reference"} / ${reference.collectionId}`;
    const prompts: Record<AlignStep, string> = {
      add: `Add ${d?.missing.length ?? 0} field(s) from ${refLabel} to ${site.domain}'s ${site.collectionId}?`,
      relabel: `Relabel ${d?.relabeled.length ?? 0} field(s) of ${site.domain}'s ${site.collectionId} with the labels from ${refLabel}?`,
      remove: `Remove ${d?.extra.length ?? 0} field(s) from ${site.domain}'s ${site.collectionId}? Their data on every item is deleted with them.`,
      "labels-from-legacy": `Relabel ${site.legacyLabels?.relabeled.length ?? 0} field(s) of ${site.domain}'s ${site.collectionId} with the labels from its own ${site.legacyCollectionId}?`,
    };
    if (!confirm(prompts[step])) return;
    const body =
      step === "labels-from-legacy"
        ? { referenceSiteId: site.id, referenceCollectionId: site.legacyCollectionId, add: false, relabel: true }
        : {
            referenceSiteId: reference.siteId,
            referenceCollectionId: reference.collectionId,
            add: step === "add",
            relabel: step === "relabel",
            removeExtra: step === "remove",
          };
    setBusy(site.id);
    try {
      const res = await fetch(`/api/internal/floorplans/sites/${site.id}/schema/align`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
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

  const referenceValue = reference ? `${reference.siteId}|${reference.collectionId}` : "";

  return (
    <>
      <div className="page-header">
        <h2>Sites</h2>
        <p>
          The Floor Plans V2 collection on every site, read live from Wix, against a reference collection. Pick the
          reference (a site&apos;s V2, or a site&apos;s legacy Floor Plans for the labels a person knows from the CMS),
          then apply each step. Fields shared with the reference are not listed.
        </p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p className="text-muted">Reading the collections from Wix…</p>}

      {!loading && sites.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <label style={{ marginRight: 12 }}>Reference collection (the standard):</label>
          <select
            className="form-input"
            style={{ width: "auto", display: "inline-block" }}
            value={referenceValue}
            onChange={(e) => {
              const [siteId, collectionId] = e.target.value.split("|");
              load({ siteId, collectionId });
            }}
          >
            {sites.flatMap((s) => [
              <option key={`${s.id}|${s.collectionId}`} value={`${s.id}|${s.collectionId}`}>
                {s.domain} / {s.collectionId}
              </option>,
              ...(s.legacyCollectionId
                ? [
                    <option key={`${s.id}|${s.legacyCollectionId}`} value={`${s.id}|${s.legacyCollectionId}`}>
                      {s.domain} / {s.legacyCollectionId} (legacy)
                    </option>,
                  ]
                : []),
            ])}
          </select>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {sites.map((site) => {
          const isRef = reference?.siteId === site.id && reference?.collectionId === site.collectionId;
          const d = site.diff;
          const inSync = d && !d.missing.length && !d.extra.length && !d.mismatched.length && !d.relabeled.length;
          const legacyRelabels = site.legacyLabels?.relabeled.length ?? 0;
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
                      <strong>Only on this site</strong> ({d.extra.length}): {d.extra.map((f) => `${f.key} (${f.type ?? "?"})`).join(", ")}
                    </div>
                  )}
                  {d.mismatched.length > 0 && (
                    <div className="text-sm">
                      <strong>Different type</strong> (left alone): {d.mismatched.map((m) => `${m.key}: ${m.target} here, ${m.reference} on the reference`).join(", ")}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {d.missing.length > 0 && (
                      <button className="btn btn-primary" disabled={busy === site.id} onClick={() => align(site, "add")}>
                        {busy === site.id ? "…" : `Add the ${d.missing.length} missing field${d.missing.length === 1 ? "" : "s"}`}
                      </button>
                    )}
                    {d.relabeled.length > 0 && (
                      <button className="btn btn-secondary" disabled={busy === site.id} onClick={() => align(site, "relabel")}>
                        Relabel {d.relabeled.length} field{d.relabeled.length === 1 ? "" : "s"} like the reference
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

              {site.found && legacyRelabels > 0 && (
                <div style={{ marginTop: 12 }} className="text-sm">
                  <span className="text-muted">
                    {legacyRelabels} field{legacyRelabels === 1 ? "" : "s"} labeled differently from this site&apos;s own {site.legacyCollectionId}
                    {site.legacyLabels?.missing.length ? ` (and ${site.legacyLabels.missing.length} legacy field${site.legacyLabels.missing.length === 1 ? "" : "s"} V2 does not carry: ${site.legacyLabels.missing.join(", ")})` : ""}.
                  </span>{" "}
                  <button className="btn btn-secondary" disabled={busy === site.id} onClick={() => align(site, "labels-from-legacy")}>
                    Take the labels from {site.legacyCollectionId}
                  </button>
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
