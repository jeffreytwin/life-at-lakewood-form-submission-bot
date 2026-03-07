-- Hand raise snapshots from Salesforce reports (via Zapier)
-- Stores per-agent hand raise counts for the current month
-- and per-month totals for yearly tracking

CREATE TABLE hand_raise_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT NOT NULL,                          -- 'monthly_by_agent' or 'yearly_by_month'
  year_month TEXT NOT NULL,                    -- '2026-03'
  agent_name TEXT,                             -- populated for monthly_by_agent
  salesforce_user_id TEXT,                     -- populated for monthly_by_agent
  count INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (type, year_month, COALESCE(agent_name, ''), COALESCE(salesforce_user_id, ''))
);

CREATE INDEX idx_hand_raise_type ON hand_raise_snapshots (type);
CREATE INDEX idx_hand_raise_month ON hand_raise_snapshots (year_month);
