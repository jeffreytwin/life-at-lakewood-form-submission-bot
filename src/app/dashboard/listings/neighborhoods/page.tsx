"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ListingsTabs from "../tabs";
import { responseError, siteColors } from "../format";

interface SiteOption {
  id: string;
  name: string;
  domain: string;
  villages: number;
  activeVillages: number;
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

interface UnmatchedGroup {
  subdivision: string;
  count: number;
  minPrice: number | null;
  maxPrice: number | null;
  sample: Array<{ listing_id: string; street: string | null; price: number | null; property_type: string | null; property_sub_type: string | null }>;
}

interface UnmatchedView {
  generatedAt: string;
  candidates: number;
  unmatched: number;
  groups: UnmatchedGroup[];
}

const titleCase = (s: string | null): string => (s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : "");
const money = (n: number | null): string => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);

interface NeighborhoodForm {
  name: string;
  page_url: string;
  wix_item_id: string;
}

const emptyForm = (): NeighborhoodForm => ({ name: "", page_url: "", wix_item_id: "" });

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
  // Every location starts collapsed; a site id in the URL (the overview's per-location link) opens that one.
  const initialSite = searchParams.get("siteId") ?? "";
  const [sites, setSites] = useState<SiteOption[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialSite ? [initialSite] : []));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/internal/listings/status")
      .then(async (r) => {
        const err = await responseError(r);
        if (err) throw new Error(err);
        return r.json();
      })
      .then((data) => {
        const list: SiteOption[] = Array.isArray(data?.sites)
          ? data.sites.map((s: SiteOption) => ({ id: s.id, name: s.name, domain: s.domain, villages: s.villages, activeVillages: s.activeVillages }))
          : [];
        setSites(list);
      })
      .catch((e) => {
        setError(e.message);
        setSites([]);
      });
  }, []);

  function toggle(siteId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(siteId)) next.delete(siteId);
      else next.add(siteId);
      return next;
    });
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Neighborhoods</h2>
          <p className="text-muted">
            One section per location. A listing joins a neighborhood when its MLS subdivision contains one of the neighborhood&apos;s
            terms; the longest matching term wins, and a street qualifier makes a term match only on that street. Changes apply on
            the next run.
          </p>
        </div>
      </div>
      <ListingsTabs />

      {error && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--danger)" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {sites === null ? (
        <div className="empty-state">Loading…</div>
      ) : sites.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">⌂</div>
          No locations yet.
        </div>
      ) : (
        sites.map((site) => <LocationSection key={site.id} site={site} open={expanded.has(site.id)} onToggle={() => toggle(site.id)} />)
      )}
    </div>
  );
}

function LocationSection({ site, open, onToggle }: { site: SiteOption; open: boolean; onToggle: () => void }) {
  const colors = siteColors(site.domain);
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [termInputs, setTermInputs] = useState<Record<string, { term: string; street: string }>>({});
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<NeighborhoodForm>(emptyForm());
  const [editing, setEditing] = useState<{ id: string; form: NeighborhoodForm } | null>(null);
  const [unmatched, setUnmatched] = useState<UnmatchedView | null>(null);
  const [unmatchedError, setUnmatchedError] = useState<string | null>(null);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [attach, setAttach] = useState<Record<string, { villageId: string; term: string }>>({});

  const loadUnmatched = useCallback(() => {
    return fetch(`/api/internal/listings/villages/unmatched?siteId=${encodeURIComponent(site.id)}`)
      .then(async (r) => {
        const err = await responseError(r);
        if (err) throw new Error(err);
        return r.json();
      })
      .then((data: UnmatchedView) => {
        setUnmatched(data);
        setUnmatchedError(null);
      })
      .catch((e) => setUnmatchedError(e.message));
  }, [site.id]);

  const load = useCallback(() => {
    return fetch(`/api/internal/listings/villages?siteId=${encodeURIComponent(site.id)}`)
      .then(async (r) => {
        const err = await responseError(r);
        if (err) throw new Error(err);
        return r.json();
      })
      .then((data) => {
        setNeighborhoods(Array.isArray(data) ? data : []);
        setError(null);
      })
      .catch((e) => {
        setError(e.message);
        setNeighborhoods((current) => current ?? []);
      });
  }, [site.id]);

  // A location's neighborhoods load the first time its section opens.
  useEffect(() => {
    if (open && neighborhoods === null) load();
  }, [open, neighborhoods, load]);

  function openUnmatched() {
    setShowUnmatched(true);
    if (unmatched === null) loadUnmatched();
  }

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
      load();
      if (unmatched !== null) loadUnmatched();
    }
  }

  /** Adds the term typed next to an unmatched subdivision to the chosen neighborhood. */
  async function attachTerm(group: UnmatchedGroup) {
    const input = attach[group.subdivision];
    const term = input?.term.trim() ?? "";
    if (!input?.villageId || !term) return;
    const target = (neighborhoods ?? []).find((v) => v.id === input.villageId);
    if (!target) return;
    if (!group.subdivision.toLowerCase().includes(term.toLowerCase())) {
      if (!confirm(`"${term}" is not contained in "${group.subdivision}", so it will not match these listings. Add it to ${target.name} anyway?`)) return;
    } else if (!confirm(`Add "${term.toLowerCase()}" as a term of ${target.name}? Listings whose subdivision contains it join the neighborhood on the next run.`)) {
      return;
    }
    const ok = await call(`attach:${group.subdivision}`, `/api/internal/listings/villages/${input.villageId}/terms`, {
      method: "POST",
      body: JSON.stringify({ term, street_term: null }),
    });
    if (ok) setAttach((m) => ({ ...m, [group.subdivision]: { ...input, term: "" } }));
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
    const ok = await call("new", "/api/internal/listings/villages", { method: "POST", body: JSON.stringify({ siteId: site.id, ...form }) });
    if (ok) {
      setForm(emptyForm());
      setShowNew(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    const ok = await call(`edit:${editing.id}`, `/api/internal/listings/villages/${editing.id}`, { method: "PATCH", body: JSON.stringify(editing.form) });
    if (ok) setEditing(null);
  }

  function deleteNeighborhood(neighborhood: Neighborhood) {
    if (!confirm(`Delete ${neighborhood.name} and its ${neighborhood.terms.length} term(s)? This cannot be undone.`)) return;
    call(`delete:${neighborhood.id}`, `/api/internal/listings/villages/${neighborhood.id}`, { method: "DELETE" });
  }

  const list = neighborhoods ?? [];
  const needle = search.trim().toLowerCase();
  const visible = needle
    ? list.filter((v) => v.name.toLowerCase().includes(needle) || v.terms.some((t) => t.term.includes(needle) || (t.street_term ?? "").includes(needle)))
    : list;
  const total = neighborhoods ? list.length : site.villages;
  const active = neighborhoods ? list.filter((v) => v.active).length : site.activeVillages;

  return (
    <div className="card" style={{ marginBottom: 12, padding: 0, ...(colors ? { background: colors.tint, borderLeft: `3px solid ${colors.accent}` } : {}) }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          color: "inherit",
          font: "inherit",
          textAlign: "left",
          cursor: "pointer",
          padding: "14px 16px",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
        }}
      >
        <span style={{ width: 12, color: "var(--text-muted)" }}>{open ? "▾" : "▸"}</span>
        <strong style={{ fontSize: 15, ...(colors ? { color: colors.solid } : {}) }}>{site.name}</strong>
        <span className="text-muted text-sm">
          {active} of {total} neighborhoods active
        </span>
      </button>

      {open && (
        <div style={{ padding: "0 16px 16px" }}>
          {error && (
            <div className="card" style={{ marginBottom: 12, borderLeft: "3px solid var(--danger)" }}>
              <strong>Error:</strong> {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <input
              className="form-input"
              style={{ width: 260, display: "inline-block" }}
              placeholder="Find a neighborhood or term"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="text-sm text-muted">
              See non-neighborhood matches{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  openUnmatched();
                }}
                style={{ textDecoration: "underline" }}
                title="Active, for-sale listings in this location's market whose subdivision matches no neighborhood term"
              >
                here
              </a>
            </span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-primary btn-sm" onClick={() => setShowNew((v) => !v)}>
              {showNew ? "Cancel" : "Add neighborhood"}
            </button>
          </div>

          {showNew && (
            <div className="card" style={{ marginBottom: 12 }}>
              <h3 style={{ marginBottom: 12 }}>New neighborhood</h3>
              <p className="text-muted text-sm">
                The neighborhood page must already exist on the Wix site. The name is what listings show; the page URL is what they
                link to (its last part is the page slug); the Wix item id is the neighborhood&apos;s row id in the site&apos;s
                dynamic-pages collection (the reference field).
              </p>
              <NeighborhoodFields form={form} onChange={setForm} />
              <div className="modal-actions">
                <button className="btn btn-primary" disabled={busy !== null || !form.name.trim()} onClick={createNeighborhood}>
                  {busy === "new" ? "Saving…" : "Create"}
                </button>
              </div>
            </div>
          )}

          {neighborhoods === null ? (
            <p className="text-muted text-sm" style={{ margin: 0 }}>Loading…</p>
          ) : visible.length === 0 ? (
            <p className="text-muted text-sm" style={{ margin: 0 }}>{list.length === 0 ? "No neighborhoods yet." : "No neighborhood matches."}</p>
          ) : (
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
                    const hasListings = v.liveListings + v.stagedListings > 0;
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
                          {v.stagedListings ? <div className="text-muted">{v.stagedListings} in progress</div> : null}
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
                                  form: { name: v.name, page_url: v.page_url ?? "", wix_item_id: v.wix_item_id ?? "" },
                                })
                              }
                            >
                              Edit
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              disabled={busy !== null || hasListings}
                              title={hasListings ? "A neighborhood with listings cannot be deleted; remove its terms and let the next run move them first" : "Delete this neighborhood"}
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
          )}

          {showUnmatched && (
            <div className="modal-overlay" onClick={() => setShowUnmatched(false)}>
              <div className="modal" style={{ maxWidth: 960, width: "95vw" }} onClick={(e) => e.stopPropagation()}>
                <h3 style={{ marginBottom: 4 }}>
                  Non-neighborhood matches
                  {unmatched && (
                    <span className="badge badge-muted" style={{ marginLeft: 8 }}>
                      {unmatched.unmatched} of {unmatched.candidates} Active listings
                    </span>
                  )}
                </h3>
                <p className="text-muted text-sm">
                  Active, for-sale listings in this location&apos;s market whose MLS subdivision matches none of the neighborhood terms. They stay off the site
                  until a term matches. To add one, type the term you want (a subdivision contains it, case does not matter: &quot;morgans glen&quot; for
                  &quot;MORGANS GLEN TWNHMS PH IIIA &amp; IIIB&quot;) and pick the neighborhood.
                </p>
                {unmatchedError && (
                  <div className="text-sm" style={{ color: "var(--danger)", marginBottom: 8 }}>
                    {unmatchedError}
                  </div>
                )}
                {unmatched === null && !unmatchedError ? (
                  <p className="text-muted text-sm" style={{ margin: 0 }}>Loading…</p>
                ) : unmatched && unmatched.groups.length === 0 ? (
                  <p className="text-muted text-sm" style={{ margin: 0 }}>Every Active, for-sale listing in the market matches a neighborhood.</p>
                ) : unmatched ? (
                  <div className="table-wrapper" style={{ maxHeight: "60vh", overflowY: "auto" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>MLS subdivision</th>
                          <th>Listings</th>
                          <th>Prices</th>
                          <th>Add a term</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unmatched.groups.map((g) => {
                          const input = attach[g.subdivision] ?? { villageId: "", term: "" };
                          return (
                            <tr key={g.subdivision || "(none)"}>
                              <td style={{ minWidth: 220 }}>
                                <strong>{g.subdivision || <span className="text-muted">(no subdivision on the MLS record)</span>}</strong>
                                <div className="text-muted text-sm">
                                  {g.sample.map((sm) => (
                                    <div key={sm.listing_id}>
                                      {titleCase(sm.street) || sm.listing_id} · {money(sm.price)}
                                      {sm.property_type && sm.property_type !== "Residential" ? ` · ${sm.property_type}` : ""}
                                      {sm.property_sub_type ? ` · ${sm.property_sub_type}` : ""}
                                    </div>
                                  ))}
                                  {g.count > g.sample.length && <div>…and {g.count - g.sample.length} more</div>}
                                </div>
                              </td>
                              <td>{g.count}</td>
                              <td className="text-sm">{g.minPrice === g.maxPrice ? money(g.minPrice) : `${money(g.minPrice)} – ${money(g.maxPrice)}`}</td>
                              <td>
                                {g.subdivision ? (
                                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                    <input
                                      className="form-input"
                                      style={{ width: 170, display: "inline-block" }}
                                      placeholder="subdivision contains…"
                                      value={input.term}
                                      onChange={(e) => setAttach((m) => ({ ...m, [g.subdivision]: { ...input, term: e.target.value } }))}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") attachTerm(g);
                                      }}
                                    />
                                    <select
                                      className="form-input"
                                      style={{ width: 200, display: "inline-block" }}
                                      value={input.villageId}
                                      onChange={(e) => setAttach((m) => ({ ...m, [g.subdivision]: { ...input, villageId: e.target.value } }))}
                                    >
                                      <option value="">Neighborhood…</option>
                                      {(neighborhoods ?? []).filter((v) => v.active).map((v) => (
                                        <option key={v.id} value={v.id}>{v.name}</option>
                                      ))}
                                    </select>
                                    <button
                                      className="btn btn-secondary btn-sm"
                                      disabled={busy !== null || !input.villageId || !input.term.trim()}
                                      onClick={() => attachTerm(g)}
                                    >
                                      {busy === `attach:${g.subdivision}` ? "…" : "Add term"}
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-muted text-sm">nothing to match on</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                <div className="modal-actions">
                  <button className="btn btn-secondary" onClick={() => setShowUnmatched(false)}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {editing && (
            <div className="modal-overlay" onClick={() => setEditing(null)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3>Edit neighborhood</h3>
                <p className="text-muted text-sm">Renaming changes the neighborhood name every listing shows; the rows are rewritten on the next run.</p>
                <NeighborhoodFields form={editing.form} onChange={(next) => setEditing({ id: editing.id, form: next })} />
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
