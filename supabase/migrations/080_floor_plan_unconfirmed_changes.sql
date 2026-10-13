-- 080: a change read twice before anyone is asked about it (Jeff,
-- 2026-10-13: "reduce unnecessary changes without skipping over real
-- changes").
--
-- A run reads a builder's page a little differently from one night to the
-- next, and each reading that differed from the record went to the queue,
-- then the next reading went to the queue back: David Weekley's Truman lost
-- and regained an elevation six times in a week, ICI's drawings swapped
-- revisions on Oct 7 and back on Oct 8, M/I's Interlude description traded
-- places with itself six days running. A description, photos or drawings a
-- run reads differently from the record now wait here until the next run
-- that reads the field reads them the same way (confirm-reads.ts), and a
-- field read differently on three runs within two weeks, however it read,
-- goes to the queue on the third. One row per plan and field.

CREATE TABLE IF NOT EXISTS fp_unconfirmed_changes (
  site_id uuid NOT NULL REFERENCES fp_sites(id) ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES fp_communities(id) ON DELETE CASCADE,
  builder_id uuid NOT NULL REFERENCES fp_builders(id) ON DELETE CASCADE,
  plan_key text NOT NULL,
  field_changed text NOT NULL,
  new_value text,
  run_id text NOT NULL,
  runs integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, community_id, builder_id, plan_key, field_changed)
);

ALTER TABLE fp_unconfirmed_changes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE fp_unconfirmed_changes IS
  'A change a run read and holds until the next run that reads the field reads it the same way (confirm-reads.ts).';
COMMENT ON COLUMN fp_unconfirmed_changes.new_value IS
  'The queue value the field last read (a description''s lead-in and digest, a gallery''s count and digest); null when the last run that read it read the record''s.';
COMMENT ON COLUMN fp_unconfirmed_changes.runs IS
  'Runs that read the field differently from the record, in a row or not; at MOST_RUNS_HELD the change is queued however it read.';
COMMENT ON COLUMN fp_unconfirmed_changes.seen_at IS
  'When a run last read the field differently from the record; a row older than SIGHTING_DAYS is cleared.';

-- The copies a background check took out of a waiting photos change that
-- then wrote nothing (sort-queue.ts), added to the plan's record in place:
-- only copiesOf is touched, so a write to another part of the record made
-- at the same moment is not undone.
CREATE OR REPLACE FUNCTION fp_remember_copies(plan_id uuid, copies jsonb)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE fp_floor_plans
     SET record = jsonb_set(
           record,
           '{copiesOf}',
           (CASE WHEN jsonb_typeof(record->'copiesOf') = 'object' THEN record->'copiesOf' ELSE '{}'::jsonb END) || copies
         )
   WHERE id = plan_id
     AND removed_at IS NULL
     AND jsonb_typeof(record) = 'object'
     AND jsonb_typeof(copies) = 'object';
$$;

REVOKE ALL ON FUNCTION fp_remember_copies(uuid, jsonb) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION fp_remember_copies(uuid, jsonb) IS
  'Adds copies a waiting photos change found to a plan''s record.copiesOf, touching nothing else (sort-queue.ts, rememberCopies).';
