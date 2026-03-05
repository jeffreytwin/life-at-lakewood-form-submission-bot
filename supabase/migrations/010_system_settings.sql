-- System-wide settings (singleton row)
-- routing_enabled: when false, incoming leads are queued but not routed

CREATE TABLE system_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  routing_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the single settings row
INSERT INTO system_settings (id, routing_enabled) VALUES (1, true);
