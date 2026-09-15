"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ListingsTabs from "../tabs";
import { ago, fmtDateTime, fmtPrice, responseError, siteColors, wixCollectionUrl } from "../format";

interface SiteOption {
  id: string;
  name: string;
  domain: string;
  wix_site_id: string | null;
  target_collection_id: string;
  write_mode: string;
}

type WaitingOn = "data" | "neighborhood" | "photos" | "write";

interface StagedListing {
  listing_id: string;
  address: string | null;
  city: string | null;
  subdivision: string | null;
  list_price: number | null;
  standard_status: string | null;
  neighborhood: string | null;
  photos: number;
  photos_imported: number;
  staged_at: string;
  waiting_on: WaitingOn;
}

const WAITING: Record<WaitingOn, { label: string; cls: string; help: string }> = {
  write: { label: "next run", cls: "badge badge-success", help: "Ready: the next run writes it to the target collection." },
  photos: { label: "photos", cls: "badge badge-info", help: "None of its photos is in the site's Media Manager yet; the photo job imports them." },
  neighborhood: { label: "neighborhood", cls: "badge badge-warning", help: "No active neighborhood term matches its subdivision; add one on the Neighborhoods tab." },
  data: { label: "MLS data", cls: "badge badge-muted", help: "Seeded from the site before the pull reached it; the next pull fills it in." },
};
const ORDER: WaitingOn[] = ["write", "photos", "neighborhood", "data"];

export default function ListingsStagingPage() {
  // useSearchParams needs a Suspense boundary on a statically rendered page.
  return (
    <Suspense fallback={<div className="empty-state">Loading…</div>}>
      <StagingView />
    </Suspense>
  );
}

function StagingView() {
  const searchParams = useSearchParams();
  const [sites, setSites] = useState<SiteOption[]>([]);
  // A site id in the URL (from the overview's Staged box) picks the site; else the first one.
  const [siteId, setSiteId] = useState(searchParams.get("siteId") ?? "");
  const [rows, setRows] = useState<StagedListing[]>([]);
  // The site whose rows are on screen; loading is derived from it so no effect sets state.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [waiting, setWaiting] = useState<WaitingOn | "">("");

  useEffect(() => {
    fetch("/api/internal/listings/status")
      .then((r) => r.json())
      .then((data) => {
        const list: SiteOption[] = Array.isArray(data?.sites)
          ? data.sites.map((s: SiteOption) => ({
              id: s.id,
              name: s.name,
              domain: s.domain,
              wix_site_id: s.wix_site_id,
              target_collection_id: s.target_collection_id,
              write_mode: s.write_mode,
            }))
          : [];
        setSites(list);
        setSiteId((current) => (current && list.some((s) => s.id === current) ? current : (list[0]?.id ?? "")));
      })
      .catch((e) => setError(e.message));
  }, []);

  const fetchRows = useCallback(() => {
    if (!siteId) return;
    fetch(`/api/internal/listings/staging?siteId=${encodeURIComponent(siteId)}`)
      .then(async (r) => {
        const err = await responseError(r);
        if (err) throw new Error(err);
        return r.json();
      })
      .then((data) => {
        setRows(Array.isArray(data) ? data : []);
        setLoadedFor(siteId);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [siteId]);

  useEffect(() => {
    fetchRows();
    const interval = setInterval(fetchRows, 60_000);
    return () => clearInterval(interval);
  }, [fetchRows]);

  const loading = !!siteId && loadedFor !== siteId && !error;
  const site = sites.find((s) => s.id === siteId);
  const colors = siteColors(site?.domain);
  const liveUrl = site ? wixCollectionUrl(site.wix_site_id, site.target_collection_id) : null;
  const counts = rows.reduce(
    (acc, r) => {
      acc[r.waiting_on] += 1;
      return acc;
    },
    { write: 0, photos: 0, neighborhood: 0, data: 0 } as Record<WaitingOn, number>
  );
  const needle = search.trim().toLowerCase();
  const visible = rows.filter(
    (r) =>
      (!waiting || r.waiting_on === waiting) &&
      (!needle ||
        r.listing_id.toLowerCase().includes(needle) ||
        (r.address ?? "").toLowerCase().includes(needle) ||
        (r.neighborhood ?? "").toLowerCase().includes(needle) ||
        (r.subdivision ?? "").toLowerCase().includes(needle))
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Staging</h2>
          <p className="text-muted">
            Listings that qualify for a site but are not in its target collection yet. Each one waits on its MLS record, a
            neighborhood match, its first imported photo, or just the next run&apos;s write.
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
        <label>
          Waiting on{" "}
          <select value={waiting} onChange={(e) => setWaiting(e.target.value as WaitingOn | "")} className="form-input" style={{ width: "auto", display: "inline-block" }}>
            <option value="">All</option>
            {ORDER.map((k) => (
              <option key={k} value={k}>{WAITING[k].label}</option>
            ))}
          </select>
        </label>
        <input
          className="form-input"
          style={{ width: 260, display: "inline-block" }}
          placeholder="Find a listing, address or neighborhood"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span style={{ flex: 1 }} />
        {site && liveUrl && (
          <a className="btn btn-secondary btn-sm" href={liveUrl} target="_blank" rel="noreferrer" title={`Open ${site.target_collection_id} in the Wix CMS`}>
            Open {site.target_collection_id} in Wix ↗
          </a>
        )}
      </div>

      {site?.write_mode === "paused" && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--danger)" }}>
          Listing updates are paused for <strong>{site.name}</strong>: nothing leaves the staging area until they are resumed on the{" "}
          <Link href="/dashboard/listings">Overview</Link>.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="stats-grid">
          {ORDER.map((k) => {
            const selected = waiting === k;
            return (
              <button
                key={k}
                type="button"
                className="stat-card"
                aria-pressed={selected}
                title={selected ? "Show every staged listing" : `Show only listings waiting on ${WAITING[k].label}`}
                onClick={() => setWaiting(selected ? "" : k)}
                style={{ padding: 14, ...(selected ? { borderColor: "var(--accent)" } : {}) }}
              >
                <div className="stat-label">Waiting on {WAITING[k].label}</div>
                <div className="stat-value" style={{ fontSize: 22 }}>{counts[k]}</div>
                <div className="stat-sub">{WAITING[k].help}</div>
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✓</div>
          {rows.length === 0
            ? `The staging area is empty${site ? `: everything eligible for ${site.name} is in ${site.target_collection_id}` : ""}.`
            : "No staged listing matches."}
        </div>
      ) : (
        <div className="card">
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Listing</th>
                  <th>Address</th>
                  <th>Neighborhood</th>
                  <th>Price</th>
                  <th>Photos</th>
                  <th>Staged</th>
                  <th>Waiting on</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.listing_id}>
                    <td className="text-sm" style={{ whiteSpace: "nowrap" }}>
                      <Link href={`/dashboard/listings/events?listingId=${encodeURIComponent(r.listing_id)}`} title="Show every event for this listing">
                        {r.listing_id}
                      </Link>
                    </td>
                    <td className="text-sm">
                      {r.address ?? "—"}
                      {(r.city || r.subdivision) && (
                        <div className="text-muted">{[r.city, r.subdivision].filter(Boolean).join(" · ")}</div>
                      )}
                    </td>
                    <td className="text-sm">{r.neighborhood ?? <span className="text-muted">none</span>}</td>
                    <td className="text-sm" style={{ whiteSpace: "nowrap" }}>
                      {fmtPrice(r.list_price)}
                      {r.standard_status && <div className="text-muted">{r.standard_status}</div>}
                    </td>
                    <td className="text-sm" style={{ whiteSpace: "nowrap" }}>
                      {r.photos_imported} of {r.photos} imported
                    </td>
                    <td className="text-sm" style={{ whiteSpace: "nowrap" }} title={fmtDateTime(r.staged_at)}>
                      {ago(r.staged_at)}
                    </td>
                    <td>
                      <span className={WAITING[r.waiting_on].cls} title={WAITING[r.waiting_on].help}>
                        {WAITING[r.waiting_on].label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visible.length !== rows.length && (
            <p className="text-muted text-sm" style={{ marginTop: 8, marginBottom: 0 }}>
              Showing {visible.length} of {rows.length} staged listing(s).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
