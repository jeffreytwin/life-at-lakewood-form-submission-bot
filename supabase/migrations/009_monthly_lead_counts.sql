-- Monthly team-wide lead counts from Salesforce (via Zapier)
-- Stores total leads generated per month for the "Leads Generated This Year" chart

CREATE TABLE monthly_lead_counts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  year_month TEXT NOT NULL UNIQUE,           -- '2026-03'
  lead_count INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_monthly_lead_month ON monthly_lead_counts (year_month);
