-- 081: the home type of every plan of one builder in one community, where
-- the builder's pages do not say (Jeff, 2026-10-14). A run no longer
-- guesses a home type: it takes the builder's own label, then this, then
-- the builder's setting (fp_builders.engine_config.homeType), and a plan
-- with none of them waits in the queue for a person to choose one. Set per
-- community because a builder can build villas and townhomes in one
-- (D.R. Horton's Star Farms) and only single-family homes in the next.

ALTER TABLE fp_builder_communities ADD COLUMN IF NOT EXISTS home_type text;
