"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { onFailedCount, clearFailed } from "@/lib/lead-events";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: "\u2302" },
  { href: "/dashboard/leads", label: "Form Submissions", icon: "\u2630" },
  { href: "/dashboard/email-hub/drafts", label: "Email", icon: "\u2709" },
  { href: "/dashboard/agents", label: "Agents", icon: "\u263A" },
  { href: "/dashboard/locations", label: "Locations", icon: "\u2691" },
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
            className={`sidebar-logout${pathname?.startsWith("/dashboard/settings") ? " sidebar-footer-active" : ""}`}
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
