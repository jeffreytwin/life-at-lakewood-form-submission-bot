-- 023: Salesforce contacts table for Email Hub lead matching
-- Separate from the leads/form submissions table.
-- Synced via Zapier from Salesforce to identify known leads by email.

CREATE TABLE IF NOT EXISTS salesforce_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salesforce_id text UNIQUE NOT NULL,
  email text NOT NULL,
  first_name text,
  last_name text,
  phone text,
  company text,
  lead_status text,
  lead_source text,
  property_interest text,
  budget text,
  timeline text,
  location_name text,
  is_active boolean DEFAULT true,
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Index for fast email lookups during inbox sync
CREATE INDEX IF NOT EXISTS idx_salesforce_contacts_email
  ON salesforce_contacts (lower(email));

-- Index for Salesforce ID upserts
CREATE INDEX IF NOT EXISTS idx_salesforce_contacts_sf_id
  ON salesforce_contacts (salesforce_id);
