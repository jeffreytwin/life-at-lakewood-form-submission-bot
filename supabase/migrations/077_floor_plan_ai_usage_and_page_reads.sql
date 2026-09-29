-- (Applied to production 2026-09-29 via MCP.)
-- 077: what each Claude call costs, and a page read once (Jeff, 2026-09-29).
--
-- Nothing recorded what the floor plan pipeline spent on Claude: the plan
-- doc guessed "single-digit dollars a month", and a night's sync read every
-- plan's page again whether or not it had changed. Two tables:
--
-- fp_ai_usage: one row per Claude call — what it was for, which model,
-- who asked (a nightly tick, a Run, a Sync now, the photo sort, the Sort
-- button, a stand-in, the connection check), the connection and run it
-- belonged to, the tokens, and the cost at that day's prices (ai-usage.ts).
-- A page served from fp_page_reads is a row too, marked cached, so the
-- share of pages read for nothing is plain.
--
-- fp_page_reads: what Claude last read off a page, kept by the page's
-- address and a digest of the text it distilled to (page-reads.ts). A page
-- that distills to the same text is not read again: the remembered facts
-- are used, and the run goes on as before. The variant is a digest of the
-- prompt, the tool and the model, so a change to any of them forgets every
-- read on its own.
--
-- The connection's row keeps its last run's tally for the Builder
-- Connections page.

CREATE TABLE IF NOT EXISTS fp_ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  purpose text NOT NULL,
  model text NOT NULL,
  source text,
  connection_id uuid REFERENCES fp_builder_communities(id) ON DELETE SET NULL,
  run_id text,
  url text,
  input_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  images integer NOT NULL DEFAULT 0,
  cached boolean NOT NULL DEFAULT false,
  ms integer,
  ok boolean NOT NULL DEFAULT true,
  error text,
  cost_cents numeric(12, 4) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS fp_ai_usage_at ON fp_ai_usage (at DESC);
CREATE INDEX IF NOT EXISTS fp_ai_usage_run ON fp_ai_usage (run_id);
CREATE INDEX IF NOT EXISTS fp_ai_usage_connection ON fp_ai_usage (connection_id, at DESC);

ALTER TABLE fp_ai_usage ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE fp_ai_usage IS
  'One row per Claude call made by the floor plan pipeline, with its tokens and cost (ai-usage.ts).';
COMMENT ON COLUMN fp_ai_usage.cached IS
  'A page read served from fp_page_reads: no call was made, nothing was spent.';

CREATE TABLE IF NOT EXISTS fp_page_reads (
  url text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('plan', 'list')),
  variant text NOT NULL,
  digest text NOT NULL,
  facts jsonb NOT NULL,
  model text NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (url, kind, variant)
);

ALTER TABLE fp_page_reads ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE fp_page_reads IS
  'What Claude last read off a builder page, by its address and a digest of its text; reused while the text is the same (page-reads.ts).';

ALTER TABLE fp_builder_communities ADD COLUMN IF NOT EXISTS last_run_reads integer;
ALTER TABLE fp_builder_communities ADD COLUMN IF NOT EXISTS last_run_cached integer;
ALTER TABLE fp_builder_communities ADD COLUMN IF NOT EXISTS last_run_cost_cents numeric(12, 4);
