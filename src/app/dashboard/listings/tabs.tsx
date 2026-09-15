"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard/listings", label: "Overview" },
  { href: "/dashboard/listings/events", label: "Events" },
  { href: "/dashboard/listings/villages", label: "Villages" },
];

export default function ListingsTabs() {
  const pathname = usePathname();
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
      {TABS.map((tab) => {
        const active = tab.href === "/dashboard/listings" ? pathname === tab.href : (pathname?.startsWith(tab.href) ?? false);
        return (
          <Link key={tab.href} href={tab.href} className={`btn btn-sm ${active ? "btn-primary" : "btn-secondary"}`}>
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
