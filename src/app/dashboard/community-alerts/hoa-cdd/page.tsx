"use client";

import { useCallback, useEffect, useState } from "react";
import CommunityAlertTabs from "../tabs";
import { AlertCard, SiteTag, siteStyle, useOpenAlerts, when } from "../alert-card";
import type { FeeCheckResult, FeePageView, LastCheck } from "@/lib/community-alerts/hoa-cdd";
import { FEE_LABEL, type Fee } from "@/lib/community-alerts/checklists";

/** A YYYY-MM-DD day as the page shows dates, read as that day wherever the viewer is. */
const day = (date: string) => when(`${date}T12:00:00`);

const CHOICE_LABEL: Record<string, string> = { updated: "Updated", no_change: "No change" };

const CHECK_OPTIONS: { value: string; label: string; fees: Fee[] }[] = [
  { value: "both", label: "HOA & CDD", fees: ["hoa", "cdd"] },
  { value: "hoa", label: "HOA only", fees: ["hoa"] },
  { value: "cdd", label: "CDD only", fees: ["cdd"] },
];

const SITE_ORDER = ["lifeatlakewood.com", "lifeinwellenpark.com", "lifeatparrish.com"];
const bySite = (a: string, b: string) => {
  const ia = SITE_ORDER.indexOf(a);
  const ib = SITE_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
};

/** What a check started from the Hub did, in a sentence. Pure. */
function describeCheck(r: FeeCheckResult): string {
  const parts: string[] = [];
  if (r.raised.length) parts.push(`New alert for ${r.raised.join(", ")}.`);
  if (r.added.length) parts.push(`Added to the open alert for ${r.added.join(", ")}.`);
  if (!r.raised.length && !r.added.length) parts.push("No site has these fees to check.");
  return parts.join(" ");
}

function LastChecked({ check }: { check: LastCheck | undefined }) {
  if (!check) return <span className="text-muted">never</span>;
  return (
    <span>
      {when(check.at)}
      {check.choice && <span className="text-muted"> · {CHOICE_LABEL[check.choice] ?? check.choice}</span>}
      {check.note && <div className="text-muted text-sm">📝 {check.note}</div>}
    </span>
  );
}

function AddPage({ sites, onAdded }: { sites: string[]; onAdded: () => void }) {
  const [domain, setDomain] = useState("");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [hoa, setHoa] = useState(true);
  const [cdd, setCdd] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const site = domain || sites[0] || "";

  async function add() {
    setBusy(true);
    setProblem(null);
    const res = await fetch("/api/internal/community-alerts/hoa-cdd/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: site, label, url, hoa, cdd }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) setProblem(data?.error ?? `HTTP ${res.status}`);
    else {
      setLabel("");
      setUrl("");
      onAdded();
    }
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div className="text-sm">
        <strong>Add a page</strong> <span className="text-muted">— a blog article or village page that states HOA dues or CDD fees.</span>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
        <select className="form-input" style={{ width: "auto" }} value={site} onChange={(e) => setDomain(e.target.value)}>
          {sites.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          className="form-input"
          style={{ flex: 1, minWidth: 180 }}
          placeholder="Name, e.g. Greenbrook village page"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          className="form-input"
          style={{ flex: 2, minWidth: 220 }}
          placeholder="https://www.lifeatlakewood.com/post/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <label className="text-sm" style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" checked={hoa} onChange={(e) => setHoa(e.target.checked)} /> HOA
        </label>
        <label className="text-sm" style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" checked={cdd} onChange={(e) => setCdd(e.target.checked)} /> CDD
        </label>
        <button className="btn btn-sm btn-primary" disabled={busy || !site || !label.trim() || !url.trim() || (!hoa && !cdd)} onClick={add}>
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      {problem && (
        <div className="text-sm" style={{ color: "var(--danger)", marginTop: 4 }}>
          {problem}
        </div>
      )}
    </div>
  );
}

/**
 * HOA/CDD Info (Jeff, 2026-11-02): the pages that state HOA dues or CDD
 * fees, and twice a year an alert to check them, one per site: CDD fees in
 * mid-October, HOA dues in mid-January. The figures are looked up by hand,
 * by asking Claude; the Hub only keeps the list and the reminders.
 */
export default function HoaCddPage() {
  const { alerts, loading, error, load } = useOpenAlerts("hoa_cdd");
  const [pages, setPages] = useState<FeePageView[]>([]);
  const [sites, setSites] = useState<string[]>([]);
  const [next, setNext] = useState<{ fee: Fee; date: string }[]>([]);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [checkWhat, setCheckWhat] = useState("both");
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadPages = useCallback(() => {
    fetch("/api/internal/community-alerts/hoa-cdd")
      .then((r) => r.json())
      .then((data) => {
        if (!Array.isArray(data?.pages)) {
          setPagesError(data?.error ?? "Failed to load");
          return;
        }
        setPages(data.pages);
        setSites([...(data.sites ?? [])].sort(bySite));
        setNext(data.next ?? []);
        setPagesError(null);
      })
      .catch((e) => setPagesError(e.message));
  }, []);

  useEffect(() => {
    loadPages();
  }, [loadPages]);

  async function startCheck() {
    const option = CHECK_OPTIONS.find((o) => o.value === checkWhat) ?? CHECK_OPTIONS[0];
    setStarting(true);
    setNote(null);
    try {
      const res = await fetch("/api/internal/community-alerts/hoa-cdd", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fees: option.fees }),
      });
      const data = await res.json().catch(() => null);
      setNote(res.ok ? describeCheck(data as FeeCheckResult) : (data?.error ?? `HTTP ${res.status}`));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
      load();
    }
  }

  async function changePage(id: string, method: "PATCH" | "DELETE", body?: Record<string, unknown>) {
    setBusy(id);
    const res = await fetch(`/api/internal/community-alerts/hoa-cdd/pages?id=${id}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setNote(data?.error ?? `HTTP ${res.status}`);
    }
    setBusy(null);
    loadPages();
  }

  const grouped = [...new Set(pages.map((p) => p.site ?? ""))].sort(bySite).map((site) => ({ site, pages: pages.filter((p) => (p.site ?? "") === site) }));

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Community Alerts</h2>
          <p className="text-muted">
            Twice a year each site with pages that state HOA dues or CDD fees gets an alert here to check them: CDD fees in
            mid-October, once the districts&apos; new fiscal year (October 1) has set the year&apos;s assessments, and HOA dues in
            mid-January, once the associations&apos; new budgets have taken effect. Ask Claude for the current figures, edit any page
            they&apos;ve changed on, and pick Updated or No change for each.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select className="form-input" style={{ width: "auto" }} value={checkWhat} onChange={(e) => setCheckWhat(e.target.value)}>
            {CHECK_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary" onClick={startCheck} disabled={starting} title="Raise the check now instead of waiting for the schedule">
            {starting ? "Starting…" : "Start a check now"}
          </button>
        </div>
      </div>
      <CommunityAlertTabs />
      {note && (
        <div className="card text-sm" style={{ marginBottom: 12 }}>
          {note}
        </div>
      )}

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : error ? (
        <div className="empty-state">{error}</div>
      ) : alerts.length === 0 ? (
        <div className="empty-state" style={{ marginBottom: 16 }}>
          No fee check is open.
          {next.length > 0 && <> Next: {next.map((n) => `${FEE_LABEL[n.fee]} on ${day(n.date)}`).join(", ")}.</>} Finished checks are under
          History.
        </div>
      ) : (
        [...alerts]
          .sort((a, b) => bySite(String(a.detail?.site ?? ""), String(b.detail?.site ?? "")))
          .map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              onChange={() => {
                load();
                loadPages();
              }}
            />
          ))
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <strong>Pages to check</strong>
          {next.length > 0 && (
            <span className="text-muted text-sm">Next checks: {next.map((n) => `${FEE_LABEL[n.fee]} ${day(n.date)}`).join(" · ")}</span>
          )}
        </div>
        {pagesError ? (
          <div className="text-sm" style={{ color: "var(--danger)", marginTop: 8 }}>
            {pagesError}
          </div>
        ) : grouped.length === 0 ? (
          <div className="text-muted text-sm" style={{ marginTop: 8 }}>
            No pages yet. Life At Lakewood and Wellen Park still get their alert on schedule, with a to-do to update the fees
            across the site. Add each blog article and village page that states HOA dues or CDD fees, and each gets its own
            to-do instead.
          </div>
        ) : (
          grouped.map((g) => (
            <div key={g.site} style={{ marginTop: 12, ...siteStyle(g.site) }}>
              <div style={{ padding: "6px 10px" }}>
                <SiteTag domain={g.site} />
              </div>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Page</th>
                      <th style={{ width: 110 }}>States</th>
                      <th>HOA last checked</th>
                      <th>CDD last checked</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {g.pages.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <a href={p.url} target="_blank" rel="noreferrer">
                            {p.label} ↗
                          </a>
                        </td>
                        <td className="text-sm">
                          {(["hoa", "cdd"] as const).map((fee) => (
                            <label key={fee} style={{ display: "inline-flex", gap: 4, alignItems: "center", marginRight: 8 }}>
                              <input
                                type="checkbox"
                                checked={p[fee]}
                                disabled={busy === p.id}
                                onChange={(e) => changePage(p.id, "PATCH", { [fee]: e.target.checked })}
                              />
                              {fee.toUpperCase()}
                            </label>
                          ))}
                        </td>
                        <td className="text-sm">{p.hoa ? <LastChecked check={p.last.hoa} /> : <span className="text-muted">—</span>}</td>
                        <td className="text-sm">{p.cdd ? <LastChecked check={p.last.cdd} /> : <span className="text-muted">—</span>}</td>
                        <td>
                          <button
                            className="btn btn-sm btn-secondary"
                            disabled={busy === p.id}
                            onClick={() => confirm(`Take ${p.label} off the list?`) && changePage(p.id, "DELETE")}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
        {sites.length > 0 && <AddPage sites={sites} onAdded={loadPages} />}
      </div>
    </div>
  );
}
