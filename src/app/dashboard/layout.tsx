"use client";

import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import RoutingToggle from "@/components/RoutingToggle";
import StatusSoundMonitor from "@/components/StatusSoundMonitor";
import PixelFireworks from "@/components/PixelFireworks";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="app-layout">
      {/* Mobile header with hamburger */}
      <header className="mobile-header">
        <button
          className="hamburger-btn"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="mobile-header-title">Life at Lakewood</span>
      </header>
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <main className="main-content">{children}</main>
      <RoutingToggle />
      <StatusSoundMonitor />
      <PixelFireworks />
    </div>
  );
}
