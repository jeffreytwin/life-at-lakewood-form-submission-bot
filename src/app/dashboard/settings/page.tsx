"use client";

import { useRouter } from "next/navigation";

const settingsItems = [
  {
    href: "/dashboard/weights",
    label: "Weights",
    description: "Configure scoring weights for lead routing",
    icon: "\u2696",
  },
  {
    href: "/dashboard/email-hub/training",
    label: "Training Data",
    description: "Manage email draft training examples",
    icon: "\u2261",
  },
  {
    href: "/dashboard/email-hub/settings",
    label: "Connected Inboxes",
    description: "Manage Gmail accounts and AI configuration",
    icon: "\u2709",
  },
  {
    href: "/dashboard/locations",
    label: "Locations",
    description: "Manage locations and their configuration",
    icon: "\u2691",
  },
  {
    href: "/dashboard/audit",
    label: "Audit Log",
    description: "View system events and routing history",
    icon: "\u2713",
  },
];

export default function SettingsPage() {
  const router = useRouter();

  return (
    <>
      <div className="page-header">
        <h2>Settings</h2>
        <p>Manage system configuration, training data, and connected accounts.</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {settingsItems.map((item) => (
          <div
            key={item.href}
            className="card"
            onClick={() => router.push(item.href)}
            style={{ cursor: "pointer", padding: "16px 20px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>{item.icon}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text-heading)" }}>
                  {item.label}
                </div>
                <div className="text-muted text-sm" style={{ marginTop: 2 }}>
                  {item.description}
                </div>
              </div>
              <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: 18 }}>
                {"\u203A"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
