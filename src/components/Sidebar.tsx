"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: "\u2302" },
  { href: "/dashboard/leads", label: "Leads", icon: "\u2709" },
  { href: "/dashboard/agents", label: "Agents", icon: "\u263A" },
  { href: "/dashboard/locations", label: "Locations", icon: "\u2691" },
  { href: "/dashboard/audit", label: "Audit Log", icon: "\u2630" },
  { href: "/dashboard/weights", label: "Weights", icon: "\u2696" },
  { href: "/dashboard/simulate", label: "Simulation", icon: "\u26A1" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/internal/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img
          src="/logo.png"
          alt="Life at Lakewood"
          style={{ width: 48, height: 48, marginBottom: 8 }}
        />
        <h1>Life at Lakewood</h1>
        <span>Lead Routing System</span>
      </div>
      <ul className="sidebar-nav">
        {navItems.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={pathname === item.href ? "active" : ""}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="sidebar-footer">
        <button onClick={handleLogout} className="sidebar-logout">
          <span className="nav-icon">{"\u2190"}</span>
          Log Out
        </button>
      </div>
    </aside>
  );
}
