"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ListingsTabs from "../tabs";
import { responseError, siteColors } from "../format";

interface SiteOption {
  id: string;
  name: string;
  domain: string;
  villages_collection_id: string;
}

interface Term {
  id: string;
  term: string;
  street_term: string | null;
}

interface Neighborhood {
  id: string;
  name: string;
  wix_slug: string | null;
  wix_item_id: string | null;
  page_url: string | null;
  active: boolean;
  active_listing_count: number;
  zero_since: string | null;
  terms: Term[];
  liveListings: number;
  stagedListings: number;
}

interface NeighborhoodForm {
  name: string;
  wix_slug: string;
  page_url: string;
  wix_item_id: string;
}

const emptyForm = (): NeighborhoodForm => ({ name: "", wix_slug: "", page_url: "", wix_item_id: "" });

export default function ListingsNeighborhoodsPage() {
  // useSearchParams needs a Suspense boundary on a statically rendered page.
  return (
    <Suspense fallback={<div className="empty-state">Loading…</div>}>
      <NeighborhoodsView />
    </Suspense>
  );
}

function NeighborhoodsView() {
  const searchParams = useSearchParams();
  const [sites, setSites] = useState<SiteOption[]>([]);
  // A site id in the URL (from the overview's per-site link) picks the site; else the first one.
  const [siteId, setSiteId] = useState(searchParams.get("siteId") ?? "");
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [termInputs, setTermInputs] = useState<Record<string, { term: string; street: string }>>({});
  const [newNeighborhood, setNewNeighborhood] = useState<NeighborhoodForm>(emptyForm());
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<{ id: string; form: NeighborhoodForm } | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/internal/listings/status")
      .then((r) => r.json())
      .then((data) => {
        const list: SiteOption[] = Array.isArray(data?.sites)
          ? data.sites.map((s: SiteOption) => ({ id: s.id, name: s.name, domain: s.domain, villages_collection_id: s.villages_collection_id }))
          : [];
        setSites(list);
        setSiteId((current) => (current && list.some((s) => s.id === current) ? current : (list[0]?.id ?? "")));
        if (!list.length) setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  const fetchNeighborhoods = useCallback(() => {
    if (!siteId) return;
    fetch(`/api/internal/listings/villages?siteId=${encodeURIComponent(siteId)}`)
      .then(async (r) => {
        const err = await responseError(r);
        if (err) throw new Error(err);
        return r.json();
      })
      .then((data) => {
        setNeighborhoods(Array.isArray(data) ? data : []);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [siteId]);

  useEffect(() => {
    setLoading(true);
    fetchNeighborhoods();
  }, [fetchNeighborhoods]);

  async function call(key: string, url: string, init: RequestInit): Promise<boolean> {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
      const err = await responseError(res);
      if (err) {
        setError(err);
        return false;
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(null);
      fetchNeighborhoods();
    }
  }

  async function addTerm(neighborhood: Neighborhood) {
    const input = termInputs[neighborhood.id] ?? { term: "", street: "" };
    if (!input.term.trim()) return;
    const ok = await call(`term:${neighborhood.id}`, `/api/internal/listings/villages/${neighborhood.id}/terms`, {
      method: "POST",
      body: JSON.stringify({ term: input.term, street_term: input.street || null }),
    });
    if (ok) setTermInputs((t) => ({ ...t, [neighborhood.id]: { term: "", street: "" } }));
  }

  function removeTerm(neighborhood: Neighborhood, term: Term) {
    const label = `"${term.term}"${term.street_term ? ` with street "${term.street_term}"` : ""}`;
    if (!confirm(`Remove ${label} from ${neighborhood.name}? Listings that only matched through it leave the neighborhood on the next run.`)) return;
    call(`term:${term.id}`, `/api/internal/listings/villages/${neighborhood.id}/terms/${term.id}`, { method: "DELETE" });
  }

  async function createNeighborhood() {
    const ok = await call("new", "/api/internal/listings/villages", { method: "POST", body: JSON.stringify({ siteId, ...newNeighborhood }) });
    if (ok) {
      setNewNeighborhood(emptyForm());
      setShowNew(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    const ok = await call(`edit:${editing.id}`, `/api/internal/listings/villages/${editing.id}`, { method: "PATCH", body: JSON.stringify(editing.form) });
    if (ok) setEditing(null);
  }

  function toggleActive(neighborhood: Neighborhood) {
    const listings = neighborhood.liveListings + neighborhood.stagedListings;
    const what = neighborhood.active
      ? `Deactivate ${neighborhood.name}? Its ${neighborhood.terms.length} term(s) stop matching, and its ${listings} listing(s) are removed from the site on the next run unless another neighborhood's term matches them.`
      : `Reactivate ${neighborhood.name}? Its terms match again from the next run.`;
    if (!confirm(what)) return;
    call(`active:${neighborhood.id}`, `/api/internal/listings/villages/${neighborhood.id}`, { method: "PATCH", body: JSON.stringify({ active: !neighborhood.active }) });
  }

  function deleteNeighborhood(neighborhood: Neighborhood) {
    if (!confirm(`Delete ${neighborhood.name} and its ${neighborhood.terms.length} term(s)? This cannot be undone.`)) return;
    call(`delete:${neighborhood.id}`, `/api/internal/listings/villages/${neighborhood.id}`, { method: "DELETE" });
  }

  function reimport() {
    const site = sites.find((s) => s.id === siteId);
    if (
      !confirm(
        `Re-import neighborhoods from the site's ${site?.villages_collection_id ?? "neighborhoods"} collection? Every neighborhood's term set is replaced by what Wix has; neighborhoods and terms added here that Wix does not know are dropped.`
      )
    ) {
      return;
    }
    call("import", "/api/internal/listings/villages/import", { method: "POST", body: JSON.stringify({ siteId }) });
  }

  const needle = search.trim().toLowerCase();
  const visible = needle
    ? neighborhoods.filter((v) => v.name.toLowerCase().includes(needle) || v.terms.some((t) => t.term.includes(needle) || (t.street_term ?? "").includes(needle)))
    : neighborhoods;
  const colors = siteColors(sites.find((s) => s.id === siteId)?.domain);

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Neighborhoods</h2>
          <p className="text-muted">
            A listing joins a neighborhood when its MLS subdivision contains one of the neighborhood&apos;s terms; the longest matching
            term wins, and a street qualifier makes a term match only on that street. Changes apply on the next run.
          </p>
        </div>
      </div>
      <ListingsTabs />

      {error && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--danger)" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <div
        className="card"
        style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", ...(colors ? { background: colors.tint, borderLeft: `3px solid ${colors.accent}` } : {}) }}
      >
        <label>
          Site{" "}
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="form-input" style={{ width: "auto", display: "inline-block" }}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <input className="form-input" style={{ width: 240, display: "inline-block" }} placeholder="Find a neighborhood or term" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary" disabled={busy !== null || !siteId} onClick={reimport}>
          {busy === "import" ? "Importing…" : "Re-import from Wix"}
        </button>
        <button className="btn btn-primary" disabled={!siteId} onClick={() => setShowNew((v) => !v)}>
          {showNew ? "Cancel" : "Add neighborhood"}
        </button>
      </div>

      {showNew && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12 }}>New neighborhood</h3>
          <p className="text-muted text-sm">
            The neighborhood page must already exist on the Wix site. The name is what listings show; the page URL is what they
            link to; the Wix item id is the neighborhood&apos;s row id in the site&apos;s dynamic-pages collection (the reference field).
          </p>
          <NeighborhoodFields form={newNeighborhood} onChange={setNewNeighborhood} />
          <div className="modal-actions">
            <button className="btn btn-primary" disabled={busy !== null || !newNeighborhood.name.trim()} onClick={createNeighborhood}>
              {busy === "new" ? "Saving…" : "Create"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">⌂</div>
          {neighborhoods.length === 0 ? "No neighborhoods yet. Re-import from Wix to start from the site's neighborhoods collection." : "No neighborhood matches."}
        </div>
      ) : (
        <div className="card">
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Neighborhood</th>
                  <th>Listings</th>
                  <th>Terms</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((v) => {
                  const input = termInputs[v.id] ?? { term: "", street: "" };
                  return (
                    <tr key={v.id} style={v.active ? undefined : { opacity: 0.6 }}>
                      <td style={{ minWidth: 200 }}>
                        <strong>{v.name}</strong>
                        {!v.active && <span className="badge badge-muted" style={{ marginLeft: 6 }}>inactive</span>}
                        <div className="text-muted text-sm">
                          {v.page_url ? (
                            <a href={v.page_url} target="_blank" rel="noreferrer">{v.wix_slug ?? "page"} ↗</a>
                          ) : (
                            v.wix_slug ?? "no page"
                          )}
                          {!v.wix_item_id && <span title="Listings written without the neighborhood reference"> · no Wix item id</span>}
                        </div>
                      </td>
                      <td className="text-sm">
                        {v.liveListings} live
                        {v.stagedListings ? <div className="text-muted">{v.stagedListings} staged</div> : null}
                      </td>
                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                          {v.terms.length === 0 && <span className="text-muted text-sm">no terms: nothing matches this neighborhood</span>}
                          {v.terms.map((t) => (
                            <span key={t.id} className="badge badge-info" style={{ textTransform: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
                              {t.term}
                              {t.street_term && <span className="text-muted">· street {t.street_term}</span>}
                              <button
                                onClick={() => removeTerm(v, t)}
                                disabled={busy !== null}
                                title="Remove term"
                                style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, lineHeight: 1 }}
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <input
                            className="form-input"
                            style={{ width: 170, display: "inline-block" }}
                            placeholder="subdivision contains…"
                            value={input.term}
                            onChange={(e) => setTermInputs((t) => ({ ...t, [v.id]: { ...input, term: e.target.value } }))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") addTerm(v);
                            }}
                          />
                          <input
                            className="form-input"
                            style={{ width: 130, display: "inline-block" }}
                            placeholder="street (optional)"
                            value={input.street}
                            onChange={(e) => setTermInputs((t) => ({ ...t, [v.id]: { ...input, street: e.target.value } }))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") addTerm(v);
                            }}
                          />
                          <button className="btn btn-secondary btn-sm" disabled={busy !== null || !input.term.trim()} onClick={() => addTerm(v)}>
                            {busy === `term:${v.id}` ? "…" : "Add term"}
                          </button>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            disabled={busy !== null}
                            onClick={() =>
                              setEditing({
                                id: v.id,
                                form: { name: v.name, wix_slug: v.wix_slug ?? "", page_url: v.page_url ?? "", wix_item_id: v.wix_item_id ?? "" },
                              })
                            }
                          >
                            Edit
                          </button>
                          <button className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => toggleActive(v)}>
                            {v.active ? "Deactivate" : "Activate"}
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            disabled={busy !== null || v.liveListings + v.stagedListings > 0}
                            title={v.liveListings + v.stagedListings > 0 ? "Deactivate first; a neighborhood with listings cannot be deleted" : "Delete this neighborhood"}
                            onClick={() => deleteNeighborhood(v)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Edit neighborhood</h3>
            <p className="text-muted text-sm">Renaming changes the neighborhood name every listing shows; the rows are rewritten on the next run.</p>
            <NeighborhoodFields form={editing.form} onChange={(form) => setEditing({ id: editing.id, form })} />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setEditing(null)} disabled={busy !== null}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveEdit} disabled={busy !== null || !editing.form.name.trim()}>
                {busy === `edit:${editing.id}` ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NeighborhoodFields({ form, onChange }: { form: NeighborhoodForm; onChange: (form: NeighborhoodForm) => void }) {
  return (
    <>
      {(
        [
          ["name", "Name (as shown on listings)"],
          ["wix_slug", "Wix page slug"],
          ["page_url", "Neighborhood page URL"],
          ["wix_item_id", "Wix item id (neighborhood row in the dynamic-pages collection)"],
        ] as const
      ).map(([field, label]) => (
        <div className="form-group" key={field}>
          <label>{label}</label>
          <input className="form-input" value={form[field]} onChange={(e) => onChange({ ...form, [field]: e.target.value })} />
        </div>
      ))}
    </>
  );
}
