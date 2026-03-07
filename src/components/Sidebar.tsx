"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { onFailedCount, clearFailed } from "@/lib/lead-events";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: "\u2302" },
  { href: "/dashboard/leads", label: "Form Submissions", icon: "\u2709" },
  { href: "/dashboard/agents", label: "Agents", icon: "\u263A" },
  { href: "/dashboard/locations", label: "Locations", icon: "\u2691" },
  { href: "/dashboard/weights", label: "Weights", icon: "\u2696" },
  { href: "/dashboard/simulate", label: "Simulation", icon: "\u26A1" },
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

  useEffect(() => {
    return onFailedCount(setFailedBadge);
  }, []);

  // Clear failed count when user is on the leads page
  useEffect(() => {
    if (pathname === "/dashboard/leads") {
      clearFailed();
    }
  }, [pathname]);

  async function handleLogout() {
    await fetch("/api/internal/logout", { method: "POST" });
    router.push("/login");
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
          <span>Form Submission Hub</span>
        </div>
        <ul className="sidebar-nav">
          {navItems.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={pathname === item.href ? "active" : ""}
                onClick={onClose}
                style={{ position: "relative" }}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
                {item.href === "/dashboard/leads" && failedBadge > 0 && (
                  <span className="nav-badge">{failedBadge}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
        <div className="sidebar-footer">
          <Link
            href="/dashboard/audit"
            className={`sidebar-logout${pathname === "/dashboard/audit" ? " sidebar-footer-active" : ""}`}
            onClick={onClose}
          >
            <span className="nav-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
                <polyline points="3,8.5 6.5,12 13,4" />
              </svg>
            </span>
            Audit Log
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
