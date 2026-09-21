"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The two Floor Plans pages, as tabs rather than links in the prose
// (Jeff, 2026-09-21), the way the Listings section carries Neighborhoods
// and Change Log.
const TABS = [
  { href: "/dashboard/floor-plans", label: "Changes" },
  { href: "/dashboard/floor-plans/campaign", label: "Email Campaign" },
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
