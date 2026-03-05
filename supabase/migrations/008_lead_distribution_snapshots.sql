-- Lead distribution snapshots from Salesforce (via Zapier)
-- Stores the latest lead-per-agent counts for the current month

CREATE TABLE lead_distribution_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  year_month TEXT NOT NULL,                 -- '2026-03'
  agent_name TEXT NOT NULL,
  lead_count INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (year_month, agent_name)
);

CREATE INDEX idx_lead_dist_month ON lead_distribution_snapshots (year_month);
