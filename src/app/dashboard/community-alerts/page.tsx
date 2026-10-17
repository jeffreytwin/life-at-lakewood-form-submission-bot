"use client";

import CommunityAlertTabs from "./tabs";
import { AlertCard, AlertsHeader, useOpenAlerts } from "./alert-card";

/**
 * Community Alerts (Jeff, 2026-10-17): a neighborhood whose new-build
 * inventory reached zero, and the website work that calls for, as a
 * to-do list. An alert closes when its list is finished or when it is
 * dismissed with a reason; nothing clears it on its own.
 */
export default function SoldOutPage() {
  const { alerts, loading, error, load } = useOpenAlerts("sold_out");
  return (
    <div>
      <AlertsHeader
        onChecked={load}
        intro={
          <>
            When a neighborhood&apos;s new-build inventory reaches zero, an alert appears here with the website work a
            sell-out calls for. Check items off as they&apos;re done; the alert closes when every item is done or marked
            N/A, or when you dismiss it with a reason. Checked twice an hour.
          </>
        }
      />
      <CommunityAlertTabs />
      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : error ? (
        <div className="empty-state">{error}</div>
      ) : alerts.length === 0 ? (
        <div className="empty-state">No neighborhood has sold out. Finished and dismissed alerts are under History.</div>
      ) : (
        alerts.map((a) => <AlertCard key={a.id} alert={a} onChange={load} />)
      )}
    </div>
  );
}
