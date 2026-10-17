-- 082: Community Alerts (Jeff, 2026-10-17). A section of the Hub that tells
-- the frontlines person when a neighborhood needs work on the website:
-- first, when one sells out (its new-build inventory reaches zero). Each
-- alert carries a to-do list; it closes when every item is done or marked
-- not applicable, or when a person dismisses it with a reason. Nothing
-- clears an alert on its own.
--
-- The to-do items' wording lives in code (src/lib/community-alerts/
-- checklists.ts); a row here holds only an item's key and what was done
-- about it, so rewording an item reaches every alert.
-- (Applied to production 2026-10-17 via MCP.)

-- ============================================================
-- ALERTS
-- ============================================================
CREATE TABLE IF NOT EXISTS ca_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind TEXT NOT NULL CHECK (kind IN ('sold_out')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
  site_id UUID REFERENCES fp_sites(id),
  community_id UUID REFERENCES fp_communities(id) ON DELETE SET NULL,
  name TEXT NOT NULL,                     -- the neighborhood, as the alert names it
  detail JSONB NOT NULL DEFAULT '{}'::jsonb, -- links and counts the alert was raised with
  dismissed_reason TEXT,
  resolved_at TIMESTAMPTZ,                -- done or dismissed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One open alert of a kind per neighborhood: a check that runs again
-- refreshes it instead of raising another.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ca_alerts_open
  ON ca_alerts (kind, community_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_ca_alerts_status ON ca_alerts (status, created_at DESC);

-- ============================================================
-- TO-DO ITEMS
-- done_at set = done. by_hand says a person checked it; an item the Hub
-- can verify for itself (by_hand false) is re-checked while the alert is
-- open. choice is the answer to an item that asks for one.
-- ============================================================
CREATE TABLE IF NOT EXISTS ca_alert_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_id UUID NOT NULL REFERENCES ca_alerts(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  done_at TIMESTAMPTZ,
  by_hand BOOLEAN NOT NULL DEFAULT false,
  not_applicable BOOLEAN NOT NULL DEFAULT false,
  choice TEXT,
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (alert_id, item_key)
);

-- ============================================================
-- INVENTORY STATE
-- What the last check saw for each new-build community, so an alert is
-- raised when a community goes from having inventory to having none, and
-- not for one that already had none when the check first ran.
-- ============================================================
CREATE TABLE IF NOT EXISTS ca_community_state (
  community_id UUID PRIMARY KEY REFERENCES fp_communities(id) ON DELETE CASCADE,
  sold_out BOOLEAN NOT NULL,
  live_plans INTEGER NOT NULL DEFAULT 0,
  changed_at TIMESTAMPTZ,                 -- when sold_out last flipped
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ca_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ca_alert_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ca_community_state ENABLE ROW LEVEL SECURITY;
