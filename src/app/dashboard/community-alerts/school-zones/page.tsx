"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CommunityAlertTabs from "../tabs";
import { AlertCard, SiteTag, siteStyle, useOpenAlerts, when } from "../alert-card";
import type { ScanRecord, SchoolScan, SchoolZonesDetail, SiteScan } from "@/lib/school-zones/scan";
import type { PlaceView } from "@/lib/school-zones/places";
import { applyQueued, canApplySchools } from "@/lib/school-zones/apply";
import { emitLeadEvent } from "@/lib/lead-events";
import { COMMUNITY_ALERT_DONE_SOUND, playSound } from "@/lib/notification-sounds";

const yearLabel = (year: number) => `${year}-${String((year + 1) % 100).padStart(2, "0")}`;

const at = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

/** Which school year each district's zones were read for, in a phrase. */
function describeSources(scan: SchoolScan): string {
  return scan.sources
    .map((s) => {
      const years = [...new Set(Object.values(s.latest))].sort().map(yearLabel);
      return `${s.district === "manatee" ? "Manatee" : "Sarasota"} ${years.join(" / ")}`;
    })
    .join(" · ");
}

function UnplacedRow({ domain, name, onSaved }: { domain: string; name: string; onSaved: () => void }) {
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setProblem(null);
    const res = await fetch("/api/internal/community-alerts/school-zones/places", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain, name, address }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) setProblem(data?.error ?? `HTTP ${res.status}`);
    else onSaved();
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
      <span className="text-sm" style={{ minWidth: 160 }}>
        {name}
      </span>
      <input
        className="form-input"
        style={{ flex: 1, minWidth: 220 }}
        placeholder="An address in it, e.g. 12345 Main St, Parrish, FL 34219"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
      />
      <button className="btn btn-sm btn-secondary" disabled={busy || !address.trim()} onClick={save}>
        {busy ? "Finding…" : "Save"}
      </button>
      {problem && (
        <span className="text-sm" style={{ color: "var(--danger)" }}>
          {problem}
        </span>
      )}
    </div>
  );
}

function SiteSummary({ site, onSaved }: { site: SiteScan; onSaved: () => void }) {
  const [showQuiet, setShowQuiet] = useState(false);
  return (
    <div style={{ padding: "10px 12px", marginTop: 8, ...siteStyle(site.domain) }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <SiteTag domain={site.domain} />
        {site.error && !site.checked ? (
          <span className="text-sm" style={{ color: "var(--danger)" }}>
            Could not be scanned: {site.error}
          </span>
        ) : (
          <span className="text-sm">
            {site.checked} villages checked · {site.matching} match · <strong>{site.raised.length} new alerts</strong>
            {site.updated.length > 0 && <> · {site.updated.length} open alerts refreshed</>}

            {site.handled.length > 0 && <> · {site.handled.length} already dealt with</>}
          </span>
        )}
        {(site.noSchools.length > 0 || site.handled.length > 0) && (
          <button className="btn btn-sm btn-secondary" onClick={() => setShowQuiet(!showQuiet)}>
            {showQuiet ? "Hide" : "Details"}
          </button>
        )}
      </div>
      {site.error && site.checked > 0 && (
        <div className="text-sm" style={{ color: "var(--warning)", marginTop: 4 }}>
          {site.error}
        </div>
      )}
      {showQuiet && (
        <div className="text-muted text-sm" style={{ marginTop: 6 }}>
          {site.noSchools.length > 0 && <div>No schools on the page, left alone: {site.noSchools.join(", ")}</div>}
          {site.handled.length > 0 && <div>Raised before for the same change and closed: {site.handled.join(", ")}</div>}

        </div>
      )}
      {site.unplaced.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="text-sm">
            <strong>Couldn&apos;t be placed</strong>{" "}
            <span className="text-muted">— no listings found in these. Give an address in each and the next scan checks it.</span>
          </div>
          {site.unplaced.map((name) => (
            <UnplacedRow key={name} domain={site.domain} name={name} onSaved={onSaved} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * School zones (Jeff, 2026-10-28): every October each village's schools
 * are checked against the districts' zones for homes in it, and a village
 * whose page names other schools raises an alert here. The scan can be
 * run any time.
 */
export default function SchoolZonesPage() {
  const { alerts, loading, error, load } = useOpenAlerts("school_zones");
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [places, setPlaces] = useState<PlaceView[]>([]);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  /** The alerts Apply all was writing when this page last saw it, to say how it ended. */
  const watching = useRef<Set<string>>(new Set());

  const loadScans = useCallback(() => {
    fetch("/api/internal/community-alerts/school-zones")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.scans)) setScans(data.scans);
        if (Array.isArray(data?.places)) setPlaces(data.places);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadScans();
  }, [loadScans]);

  async function runNow() {
    setRunning(true);
    setNote("Checking every village against the districts' zones; this takes a few minutes…");
    try {
      const res = await fetch("/api/internal/community-alerts/school-zones", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) setNote(data?.error ?? `HTTP ${res.status}`);
      else {
        const raised = (data as SchoolScan).sites.reduce((n, s) => n + s.raised.length, 0);
        setNote(raised ? `Done: ${raised} new alert${raised === 1 ? "" : "s"}.` : "Done: nothing new to change.");
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      loadScans();
      load();
    }
  }

  /** Apply all: the server writes them in the background; the page follows the cards. */
  async function applyAll() {
    if (!confirm(`Write the new schools to ${applicable.length} village page${applicable.length === 1 ? "" : "s"}? It carries on if you leave this page.`)) return;
    setApplying(true);
    setNote(null);
    try {
      const res = await fetch("/api/internal/community-alerts/school-zones/apply-all", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) setNote(data?.error ?? `HTTP ${res.status}`);
      else if (!data?.queued) setNote("Nothing to apply.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
      load();
    }
  }

  async function forget(id: string) {
    await fetch(`/api/internal/community-alerts/school-zones/places?id=${id}`, { method: "DELETE" });
    loadScans();
  }

  const last = scans[0];
  const unfinished = last && !last.finishedAt;
  const sorted = [...alerts].sort(
    (a, b) => String(a.detail?.site ?? "").localeCompare(String(b.detail?.site ?? "")) || a.name.localeCompare(b.name)
  );
  const schoolsOf = (a: (typeof alerts)[number]) => a.detail as unknown as SchoolZonesDetail;
  const queued = alerts.filter((a) => applyQueued(schoolsOf(a)));
  const applicable = alerts.filter((a) => canApplySchools(schoolsOf(a)) && !applyQueued(schoolsOf(a)));
  const queuedKey = queued.map((a) => a.id).join(",");

  // While Apply all is writing, the cards are read again every few seconds; when it ends, how it went.
  useEffect(() => {
    const ids = queuedKey ? queuedKey.split(",") : [];
    if (ids.length) {
      ids.forEach((id) => watching.current.add(id));
      const timer = setInterval(load, 4000);
      return () => clearInterval(timer);
    }
    if (!watching.current.size) return;
    const open = new Map(alerts.map((a) => [a.id, a]));
    const was = [...watching.current];
    watching.current = new Set();
    const failed = was.filter((id) => open.get(id) && schoolsOf(open.get(id)!).applyError).length;
    const applied = was.filter((id) => !open.has(id)).length;
    setNote(`Apply all is done: ${applied} village${applied === 1 ? "" : "s"} updated${failed ? `; ${failed} could not be, each card says why` : ""}.`);
    if (applied) {
      playSound(COMMUNITY_ALERT_DONE_SOUND);
      if (!failed) emitLeadEvent({ type: "community_schools_done", leadName: "", communityName: "Every village" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on the queue changing, not on every reload
  }, [queuedKey]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Community Alerts</h2>
          <p className="text-muted">
            Every October the Hub checks each village&apos;s grade, middle and high school against the districts&apos; own zones
            (Manatee&apos;s School Locator, Sarasota&apos;s zone maps) at homes in the village, by the latest school year the
            district has published. A village whose page names other schools, or names them another way, gets an alert here.
            Apply writes it to the site&apos;s village pages collection. On Life At Lakewood, a village with a row in Dynamic
            Village Pages is written the same way; one still on a page built by hand gets a to-do to edit it; one with
            neither gets its row made as a draft by Apply.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(applicable.length > 0 || queued.length > 0) && (
            <button
              className="btn btn-primary"
              onClick={applyAll}
              disabled={applying || queued.length > 0 || running || Boolean(unfinished)}
              title="Apply on every Wellen Park and Parrish alert, in the background"
            >
              {queued.length > 0 ? `Applying… ${queued.length} left` : `Apply all (${applicable.length})`}
            </button>
          )}
          <button className="btn btn-secondary" onClick={runNow} disabled={running || Boolean(unfinished)} title="October's scan, now">
            {running || unfinished ? "Scanning…" : "Run the scan now"}
          </button>
        </div>
      </div>
      <CommunityAlertTabs />
      {queued.length > 0 && (
        <div className="card text-sm" style={{ marginBottom: 12 }}>
          ⏳ Apply all is writing {queued.length} village{queued.length === 1 ? "" : "s"}&apos; schools to the website, about fifty a
          minute. It carries on if you leave this page; each card closes as it lands.
        </div>
      )}
      {note && (
        <div className="card text-sm" style={{ marginBottom: 12 }}>
          {note}
        </div>
      )}

      {last?.summary && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <strong>Last scan</strong>
            <span className="text-muted text-sm">
              {at(last.startedAt)} · {last.trigger === "cron" ? "October's scan" : "run from the Hub"} · zones for {describeSources(last.summary)}
            </span>
          </div>
          {last.summary.problems.map((p) => (
            <div key={p} className="text-sm" style={{ color: "var(--danger)", marginTop: 4 }}>
              {p}
            </div>
          ))}
          {last.summary.sites.map((s) => (
            <SiteSummary key={s.domain} site={s} onSaved={loadScans} />
          ))}
          {places.length > 0 && (
            <div className="text-sm" style={{ marginTop: 12 }}>
              <strong>Addresses given by hand</strong>
              {places.map((p) => (
                <div key={p.id} style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <SiteTag domain={p.site} /> {p.name} <span className="text-muted">· {p.address} · {when(p.createdAt)}</span>
                  <button className="btn btn-sm btn-secondary" onClick={() => forget(p.id)}>
                    Forget
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : error ? (
        <div className="empty-state">{error}</div>
      ) : sorted.length === 0 ? (
        <div className="empty-state">
          {last ? "Every village checked names the right schools. Finished alerts are under History." : "No scan yet: run one, or wait for October's."}
        </div>
      ) : (
        sorted.map((a) => <AlertCard key={a.id} alert={a} onChange={load} />)
      )}
    </div>
  );
}
