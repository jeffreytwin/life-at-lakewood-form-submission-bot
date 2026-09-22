"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The Floor Plans pages, as tabs rather than links in the prose (Jeff,
// 2026-09-21), the way the Listings section carries Neighborhoods and
// Change Log. Builder Connections joined them rather than living under
// Settings (Jeff, 2026-09-22): it is where the work is, not configuration
// someone sets once.
const TABS = [
  { href: "/dashboard/floor-plans", label: "Changes" },
  { href: "/dashboard/floor-plans/campaign", label: "Email Campaign" },
  { href: "/dashboard/floor-plans/connections", label: "Builder Connections" },
];

export default function FloorPlanTabs() {
  const pathname = usePathname();
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
      {TABS.map((tab) => {
        const active =
          tab.href === "/dashboard/floor-plans"
            ? pathname === tab.href
            : (pathname?.startsWith(tab.href) ?? false);
        return (
          <Link key={tab.href} href={tab.href} className={`btn btn-sm ${active ? "btn-primary" : "btn-secondary"}`}>
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
