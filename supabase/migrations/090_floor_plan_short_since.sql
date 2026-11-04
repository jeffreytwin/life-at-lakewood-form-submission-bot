-- 090: when a connection's shortfall began (Jeff, 2026-11-04: Ashton Woods
-- at Oakfield, "7 consecutive failures"). A run short of the count it is
-- held to keeps that count until the shortfall has lasted from one night
-- to the next (coverage.ts, countAfterShortfall). That used to be measured
-- from the run before, and every run, a night's retry or a Run pressed in
-- the day, moved it on: Ashton dropped its Traditional plans on 11-04, the
-- connection read the 11 it lists now on every run, and stayed held to the
-- 28 from the day before. Set by the first short run, cleared by a run
-- that meets its count.

ALTER TABLE fp_builder_communities ADD COLUMN IF NOT EXISTS short_since timestamptz;
