"use client";

import { useState } from "react";
import { FORM_NAMES } from "@/lib/shared/constants";

interface SimulationResult {
  status: string;
  leadId?: string;
  error?: string;
  details?: string;
}

export default function SimulatePage() {
  const [form, setForm] = useState({
    first_name: "Jane",
    last_name: "Doe",
    email: "jane.doe@example.com",
    phone: "+19415550100",
    location: "Lakewood Ranch",
    form_name: "Contact Us",
    village: "",
    price: "$450,000 - $550,000",
    floor_plan: "",
    home_type: "Single Family",
    builder: "",
    timeline: "3-6 months",
    message: "Interested in learning more about available homes.",
    property_address: "",
    url: "",
    owner_name: "",
    salesforce_record_id: "",
  });

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setResult(null);

    try {
      const payload = {
        ...form,
        webhook_secret: "SIMULATED_TEST",
        salesforce_record_id: form.salesforce_record_id || undefined,
        owner_name: form.owner_name || undefined,
      };

      const res = await fetch("/api/webhooks/zapier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setResult({
          status: "error",
          error: data.error ?? `HTTP ${res.status}`,
          details: JSON.stringify(data.details ?? data, null, 2),
        });
      } else {
        setResult({
          status: data.status,
          leadId: data.leadId,
        });
      }
    } catch (e) {
      setResult({
        status: "error",
        error: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>Test Lead Submission</h2>
        <p>
          Simulate a Zapier webhook to test the full routing pipeline. This sends
          a real lead through the system.
        </p>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3>Lead Details</h3>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>First Name</label>
              <input
                className="form-input"
                value={form.first_name}
                onChange={(e) =>
                  setForm({ ...form, first_name: e.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>Last Name</label>
              <input
                className="form-input"
                value={form.last_name}
                onChange={(e) =>
                  setForm({ ...form, last_name: e.target.value })
                }
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Email</label>
              <input
                className="form-input"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Phone</label>
              <input
                className="form-input"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Location</label>
              <input
                className="form-input"
                value={form.location}
                onChange={(e) =>
                  setForm({ ...form, location: e.target.value })
                }
                placeholder="Lakewood Ranch"
              />
            </div>
            <div className="form-group">
              <label>Form Name</label>
              <select
                className="form-input"
                value={form.form_name}
                onChange={(e) =>
                  setForm({ ...form, form_name: e.target.value })
                }
              >
                {FORM_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Village</label>
              <input
                className="form-input"
                value={form.village}
                onChange={(e) => setForm({ ...form, village: e.target.value })}
                placeholder="Waterside"
              />
            </div>
            <div className="form-group">
              <label>Price</label>
              <input
                className="form-input"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Home Type</label>
              <input
                className="form-input"
                value={form.home_type}
                onChange={(e) =>
                  setForm({ ...form, home_type: e.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>Timeline</label>
              <input
                className="form-input"
                value={form.timeline}
                onChange={(e) =>
                  setForm({ ...form, timeline: e.target.value })
                }
              />
            </div>
          </div>

          <div className="form-group">
            <label>Message</label>
            <textarea
              className="form-input"
              rows={3}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              style={{ resize: "vertical" }}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Owner Name (triggers &quot;owned by other&quot; flow)</label>
              <input
                className="form-input"
                value={form.owner_name}
                onChange={(e) =>
                  setForm({ ...form, owner_name: e.target.value })
                }
                placeholder="Leave blank for normal routing"
              />
            </div>
            <div className="form-group">
              <label>Salesforce Record ID</label>
              <input
                className="form-input"
                value={form.salesforce_record_id}
                onChange={(e) =>
                  setForm({ ...form, salesforce_record_id: e.target.value })
                }
                placeholder="Optional"
              />
            </div>
          </div>

          <div style={{ marginTop: 8 }}>
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={submitting}
              style={{ width: "100%", justifyContent: "center", padding: "12px 16px" }}
            >
              {submitting ? "Submitting..." : "Submit Test Lead"}
            </button>
          </div>
        </div>

        <div>
          <div className="card">
            <div className="card-header">
              <h3>Result</h3>
            </div>

            {!result ? (
              <div className="empty-state">
                <div className="empty-icon">&#9889;</div>
                <h3>Ready to test</h3>
                <p>
                  Fill in the lead details and click submit. The lead will be
                  processed through the full routing pipeline.
                </p>
              </div>
            ) : result.status === "error" ? (
              <div>
                <div
                  className="badge badge-danger"
                  style={{ marginBottom: 12 }}
                >
                  Error
                </div>
                <p style={{ marginBottom: 8 }}>{result.error}</p>
                {result.details && (
                  <pre
                    style={{
                      background: "var(--bg-input)",
                      padding: 12,
                      borderRadius: "var(--radius)",
                      fontSize: 12,
                      overflow: "auto",
                      maxHeight: 300,
                    }}
                  >
                    {result.details}
                  </pre>
                )}
              </div>
            ) : (
              <div>
                <div
                  className={`badge ${result.status === "routing" ? "badge-success" : result.status === "duplicate" ? "badge-warning" : "badge-info"}`}
                  style={{ marginBottom: 12 }}
                >
                  {result.status}
                </div>
                {result.leadId && (
                  <p className="text-sm" style={{ marginBottom: 8 }}>
                    <span className="text-muted">Lead ID: </span>
                    <span className="font-mono">{result.leadId}</span>
                  </p>
                )}
                <p className="text-muted text-sm">
                  {result.status === "routing" &&
                    "Lead has been sent to the best available agent via SMS. Check the Leads and Audit Log pages to track progress."}
                  {result.status === "duplicate" &&
                    "This lead was already processed recently (deduplication)."}
                  {result.status === "owned_by_other" &&
                    "Lead is owned by a non-frontlines agent. Notification sent."}
                </p>
              </div>
            )}
          </div>

          <div className="card mt-4">
            <div className="card-header">
              <h3>How It Works</h3>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.7 }}>
              <ol style={{ paddingLeft: 20 }}>
                <li>
                  <strong>Dedup check</strong> - Skip if same SF ID seen in last
                  5 min
                </li>
                <li>
                  <strong>Create lead</strong> - Store in database with all form
                  data
                </li>
                <li>
                  <strong>Owner check</strong> - If owner_name set, notify
                  frontlines instead
                </li>
                <li>
                  <strong>Score agents</strong> - 6 weighted factors determine
                  best match
                </li>
                <li>
                  <strong>Send SMS</strong> - Notify selected agent with lead
                  details
                </li>
                <li>
                  <strong>Wait for reply</strong> - YES = accept, NO = escalate
                  to next
                </li>
                <li>
                  <strong>Timeout</strong> - Follow-up at 2 min, escalate at 4
                  min
                </li>
                <li>
                  <strong>Fallback</strong> - After 5 agents, alert frontlines
                  for manual routing
                </li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
