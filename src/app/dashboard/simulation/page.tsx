"use client";

import { useRouter } from "next/navigation";

export default function SimulationPage() {
  const router = useRouter();

  return (
    <>
      <div className="page-header">
        <h2>Simulation</h2>
        <p>
          Test routing and email configurations without sending SMS, emails, or
          writing to the database.
        </p>
      </div>

      <div className="grid-2">
        <button
          className="card"
          onClick={() => router.push("/dashboard/simulate")}
          style={{
            cursor: "pointer",
            textAlign: "left",
            transition: "border-color 0.15s, background 0.15s",
            border: "1px solid var(--border)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--accent)";
            e.currentTarget.style.background = "var(--bg-card-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.background = "var(--bg-card)";
          }}
        >
          <div className="sim-icon-static" style={{ fontSize: 36, marginBottom: 12 }}>{"\u2630"}</div>
          <h3
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "var(--text-heading)",
              marginBottom: 6,
            }}
          >
            Simulate Form Submission
          </h3>
          <p className="text-muted" style={{ fontSize: 13 }}>
            Test lead routing with single, bulk, or 30-day simulations using
            your current agent configuration.
          </p>
        </button>

        <button
          className="card"
          onClick={() => router.push("/dashboard/email-hub/simulate")}
          style={{
            cursor: "pointer",
            textAlign: "left",
            transition: "border-color 0.15s, background 0.15s",
            border: "1px solid var(--border)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--accent)";
            e.currentTarget.style.background = "var(--bg-card-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.background = "var(--bg-card)";
          }}
        >
          <div className="sim-icon-static" style={{ fontSize: 36, marginBottom: 12 }}>{"\u2709"}</div>
          <h3
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "var(--text-heading)",
              marginBottom: 6,
            }}
          >
            Simulate Email
          </h3>
          <p className="text-muted" style={{ fontSize: 13 }}>
            Test AI-generated email responses by composing a mock inbound email
            and reviewing the draft.
          </p>
        </button>
      </div>
    </>
  );
}
