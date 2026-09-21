"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { onFailedCount, clearFailed } from "@/lib/lead-events";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: "\u2302" },
  { href: "/dashboard/leads", label: "Form Submissions", icon: "\u2630" },
  { href: "/dashboard/email-hub/drafts", label: "Email", icon: "\u2709" },
  { href: "/dashboard/floor-plans", label: "Floor Plans", icon: "\u25A6" },
  { href: "/dashboard/listings", label: "Listings", icon: "\u2616" },
  { href: "/dashboard/agents", label: "Agents", icon: "\u263A" },
];

export default function Sidebar({
  mobileOpen,
  onClose,
}: {
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [failedBadge, setFailedBadge] = useState(0);
  const [draftCount, setDraftCount] = useState(0);
  const [floorPlanCount, setFloorPlanCount] = useState(0);
  const [listingErrorCount, setListingErrorCount] = useState(0);
  const [campaignAlertCount, setCampaignAlertCount] = useState(0);

  useEffect(() => {
    return onFailedCount(setFailedBadge);
  }, []);

  // Clear failed count when user is on the leads page
  useEffect(() => {
    if (pathname === "/dashboard/leads") {
      clearFailed();
    }
  }, [pathname]);

  // Poll for pending draft count
  useEffect(() => {
    function fetchDraftCount() {
      fetch("/api/internal/email-hub/drafts?status=drafted&is_simulation=false&limit=50")
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) setDraftCount(data.length);
        })
        .catch(() => {});
    }
    fetchDraftCount();
    const interval = setInterval(fetchDraftCount, 15_000);
    return () => clearInterval(interval);
  }, []);

  // Poll for pending floor plan change count
  useEffect(() => {
    function fetchFloorPlanCount() {
      fetch("/api/internal/floorplans/changes?status=pending&limit=200")
        .then((r) => r.json())
        .then((data) => {
          // One row per changed field comes back; the badge counts plans.
          if (Array.isArray(data)) {
            setFloorPlanCount(new Set(data.map((c) => `${c.site_id}|${c.community_id}|${c.builder_id}|${c.plan_key}`)).size);
          }
        })
        .catch(() => {});
    }
    fetchFloorPlanCount();
    const interval = setInterval(fetchFloorPlanCount, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Poll for open email campaign alerts: a tracked floor plan changed on a site
  useEffect(() => {
    function fetchCampaignAlerts() {
      fetch("/api/internal/floorplans/tasks")
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) setCampaignAlertCount(data.length);
        })
        .catch(() => {});
    }
    fetchCampaignAlerts();
    const interval = setInterval(fetchCampaignAlerts, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Poll for listing errors nobody has dismissed yet
  useEffect(() => {
    function fetchListingErrorCount() {
      fetch("/api/internal/listings/errors?limit=0")
        .then((r) => r.json())
        .then((data) => {
          setListingErrorCount(typeof data?.count === "number" ? data.count : 0);
        })
        .catch(() => {});
    }
    fetchListingErrorCount();
    const interval = setInterval(fetchListingErrorCount, 30_000);
    return () => clearInterval(interval);
  }, []);

  async function handleLogout() {
    await fetch("/api/internal/logout", { method: "POST" });
    router.push("/login");
  }

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === href;
    return pathname?.startsWith(href) ?? false;
  }

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="sidebar-overlay" onClick={onClose} />
      )}
      <aside className={`sidebar${mobileOpen ? " sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <img
            src="/logo.png"
            alt="Life at Lakewood"
            style={{ width: 48, height: 48, marginBottom: 8 }}
          />
          <h1>Life At Lakewood</h1>
        </div>
        <ul className="sidebar-nav">
          {navItems.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={isActive(item.href) ? "active" : ""}
                onClick={onClose}
                style={{ position: "relative" }}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
                {item.href === "/dashboard/leads" && failedBadge > 0 && (
                  <span className="nav-badge">{failedBadge}</span>
                )}
                {item.href === "/dashboard/email-hub/drafts" && draftCount > 0 && (
                  <span className="nav-badge">{draftCount}</span>
                )}
                {item.href === "/dashboard/floor-plans" && floorPlanCount > 0 && (
                  <span className="nav-badge">{floorPlanCount}</span>
                )}
                {item.href === "/dashboard/floor-plans" && campaignAlertCount > 0 && (
                  <span
                    className="nav-badge"
                    style={{ right: floorPlanCount > 0 ? 40 : 10, background: "var(--warning, #b45309)" }}
                    title="Email campaign alerts: a tracked floor plan changed"
                  >
                    ⚑{campaignAlertCount}
                  </span>
                )}
                {item.href === "/dashboard/listings" && listingErrorCount > 0 && (
                  <span className="nav-badge">{listingErrorCount}</span>
                )}
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/dashboard/simulation"
              className={isActive("/dashboard/simulation") || pathname === "/dashboard/simulate" || pathname === "/dashboard/email-hub/simulate" ? "active" : ""}
              onClick={onClose}
            >
              <span className="nav-icon">{"\u2699"}</span>
              Simulation
            </Link>
          </li>
        </ul>
        <div className="sidebar-footer">
          <Link
            href="/dashboard/settings"
            className={`sidebar-logout${pathname?.startsWith("/dashboard/settings") || pathname?.startsWith("/dashboard/locations") ? " sidebar-footer-active" : ""}`}
            onClick={onClose}
          >
            <span className="nav-icon">{"\u2699"}</span>
            Settings
          </Link>
          <button onClick={handleLogout} className="sidebar-logout">
            <span className="nav-icon">{"\u2190"}</span>
            Log Out
          </button>
        </div>
      </aside>
    </>
  );
}
