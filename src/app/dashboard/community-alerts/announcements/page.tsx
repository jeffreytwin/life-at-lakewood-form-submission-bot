"use client";

import { useState } from "react";
import CommunityAlertTabs from "../tabs";
import { AlertCard, useOpenAlerts } from "../alert-card";
import type { AnnouncementScan } from "@/lib/community-alerts/announcements";

/** What a search found, in a sentence or two. Pure. */
function describeScan(data: AnnouncementScan): string {
  const places = data.places.map((p) => (p.error ? `${p.site}: could not search — ${p.error}` : `${p.site}: ${p.found} found`));
  return `${places.join(" · ")}. ${data.raised.length ? `New: ${data.raised.join(", ")}.` : "Nothing new to raise."}`;
}

/**
 * Neighborhoods announced in a place we cover, before they have homes for
 * sale (Jeff, 2026-10-17), from Claude's weekly web search. Watch one and
 * the daily scan raises it as a new neighborhood once homes are listed.
 */
export default function AnnouncementsPage() {
  const { alerts, loading, error, load } = useOpenAlerts("announcement");
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function searchNow() {
    setSearching(true);
    setNote("Searching the web for each place; this takes a few minutes…");
    try {
      const res = await fetch("/api/internal/community-alerts/announcements", { method: "POST" });
      const data = await res.json();
      setNote(res.ok ? describeScan(data) : (data?.error ?? `HTTP ${res.status}`));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
      load();
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Community Alerts</h2>
          <p className="text-muted">
            New neighborhoods announced in Lakewood Ranch, Wellen Park and Parrish that don&apos;t have homes for sale yet,
            found by a web search every Monday. Watch one to hear the day its homes are listed, Ignore it to never hear
            about it again, or Dismiss it for now.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={searchNow} disabled={searching} title="Run this week's web search now">
          {searching ? "Searching…" : "Search the web now"}
        </button>
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
        <div className="empty-state">No announcements waiting. Watched ones are under Watch List.</div>
      ) : (
        alerts.map((a) => <AlertCard key={a.id} alert={a} onChange={load} />)
      )}
    </div>
  );
}
