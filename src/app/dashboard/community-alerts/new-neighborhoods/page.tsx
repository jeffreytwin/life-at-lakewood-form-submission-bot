"use client";

import CommunityAlertTabs from "../tabs";
import { AlertCard, AlertsHeader, useOpenAlerts } from "../alert-card";

/**
 * Neighborhoods with homes for sale in a place we cover that neither the
 * new-build engine nor the listings engine has (Jeff, 2026-10-17). The
 * to-do list is the work of adding one; the engine items tick themselves
 * once the Hub sees the neighborhood there.
 */
export default function NewNeighborhoodsPage() {
  const { alerts, loading, error, load } = useOpenAlerts("new_neighborhood");
  return (
    <div>
      <AlertsHeader
        onChecked={load}
        intro={
          <>
            Neighborhoods selling homes that don&apos;t have a village page on the site yet (they aren&apos;t in the
            listings engine): ones the new-build engine has floor plans for, and ones turned up once a day by the
            Lakewood Ranch and Wellen Park home finders and Parrish&apos;s new-construction MLS listings. Work the list to
            add one, Ignore it to never hear about it again (say, one that lives on a parent neighborhood&apos;s page), or
            Dismiss it for now.
          </>
        }
      />
      <CommunityAlertTabs />
      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : error ? (
        <div className="empty-state">{error}</div>
      ) : alerts.length === 0 ? (
        <div className="empty-state">No new neighborhoods. Ignored ones are under Ignored.</div>
      ) : (
        alerts.map((a) => <AlertCard key={a.id} alert={a} onChange={load} />)
      )}
    </div>
  );
}
