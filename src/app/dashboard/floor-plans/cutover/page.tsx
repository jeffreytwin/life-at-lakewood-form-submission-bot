"use client";

import { useCallback, useEffect, useState } from "react";

interface Report {
  generatedAt: string;
  legacyCount: number;
  pipelineCount: number;
  matched: number;
  mismatches: { plan: string; builder: string; legacyPrice: string | null; pipelinePrice: string | null }[];
  pipelineOnly: { plan: string; builder: string; community: string }[];
  legacyOnly: { plan: string; builder: string; village: string; isQmi: boolean }[];
}

interface SiteReport {
  id: string;
  domain: string;
  name: string;
  latest: { report: Report; created_at: string } | null;
}

export default function CutoverPage() {
  const [sites, setSites] = useState<SiteReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);

  const fetchReports = useCallback(() => {
    fetch("/api/internal/floorplans/cutover")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setSites(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  async function generate(siteId: string) {
    setGenerating(siteId);
    try {
      await fetch("/api/internal/floorplans/cutover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId }),
      });
    } finally {
      setGenerating(null);
      fetchReports();
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Cutover Report</h2>
          <p className="text-muted">
            Pipeline data vs the legacy (freelancer-maintained) Floor Plans collection,
            per site. A site is swap-ready when disagreements are consistently legacy
            errors and “legacy only” is down to un-onboarded builders.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : (
        sites.map((s) => {
          const r = s.latest?.report;
          return (
            <div className="card" key={s.id} style={{ marginBottom: 16 }}>
              <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>{s.domain}</strong>
                  {s.latest && (
                    <span className="text-muted text-sm">
                      {" "}· generated {new Date(s.latest.created_at).toLocaleString()}
                    </span>
                  )}
                </div>
                <button className="btn btn-primary" disabled={generating === s.id} onClick={() => generate(s.id)}>
                  {generating === s.id ? "Comparing…" : "Generate now"}
                </button>
              </div>
              {!r ? (
                <p className="text-muted">No report yet.</p>
              ) : (
                <>
                  <p className="text-sm">
                    Legacy: <strong>{r.legacyCount}</strong> · Pipeline: <strong>{r.pipelineCount}</strong> ·
                    Matched: <strong>{r.matched}</strong> · Price mismatches: <strong>{r.mismatches.length}</strong> ·
                    Pipeline-only: <strong>{r.pipelineOnly.length}</strong> · Legacy-only: <strong>{r.legacyOnly.length}</strong>
                    {" "}({r.legacyOnly.filter((l) => l.isQmi).length} QMI)
                  </p>
                  {r.mismatches.length > 0 && (
                    <details open>
                      <summary><strong>Price disagreements</strong></summary>
                      <div className="table-wrapper">
                        <table>
                          <thead><tr><th>Plan</th><th>Builder</th><th>Legacy says</th><th>Builder site says</th></tr></thead>
                          <tbody>
                            {r.mismatches.map((m, i) => (
                              <tr key={i}>
                                <td>{m.plan}</td>
                                <td>{m.builder}</td>
                                <td><s className="text-muted">{m.legacyPrice ?? "—"}</s></td>
                                <td><strong>{m.pipelinePrice ?? "—"}</strong></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}
                  {r.pipelineOnly.length > 0 && (
                    <details>
                      <summary><strong>Missing from your site</strong> ({r.pipelineOnly.length})</summary>
                      <ul className="text-sm">
                        {r.pipelineOnly.map((p, i) => (
                          <li key={i}>{p.plan} — {p.builder} · {p.community}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {r.legacyOnly.length > 0 && (
                    <details>
                      <summary><strong>Legacy only</strong> ({r.legacyOnly.length} — mostly un-onboarded builders / QMIs)</summary>
                      <ul className="text-sm">
                        {r.legacyOnly.slice(0, 60).map((l, i) => (
                          <li key={i}>{l.plan} — {l.builder} · {l.village}{l.isQmi ? " · QMI" : ""}</li>
                        ))}
                        {r.legacyOnly.length > 60 && <li className="text-muted">…and {r.legacyOnly.length - 60} more</li>}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
