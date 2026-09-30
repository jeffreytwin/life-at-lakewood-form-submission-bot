-- (Applied to production 2026-09-30 via MCP.)
-- 078: the text a page was digested from, and what changed when it was
-- read again (Jeff, 2026-09-30).
--
-- The second night with pages read once (077) cost $9.91 against the
-- first's $22.48, and the pages still read again were three builders'
-- whole sites: Neal's carry an Instagram feed that changes with every
-- post, Kolter's a tracking pixel with a fresh random number on every
-- load, and Medallion's something not yet seen — their site will not
-- answer a fetch from outside. So each remembered read now keeps the
-- text it was digested from, and when a page is read again because its
-- text changed, where the two texts differ (page-reads.ts, changeBetween):
-- the row says what keeps changing on the page, and the digest can be
-- taught to look past it.

ALTER TABLE fp_page_reads ADD COLUMN IF NOT EXISTS text text;
ALTER TABLE fp_page_reads ADD COLUMN IF NOT EXISTS last_change jsonb;

COMMENT ON COLUMN fp_page_reads.text IS
  'The page''s distilled text as digested (page-reads.ts normalizedText), for the next read to say what changed.';
COMMENT ON COLUMN fp_page_reads.last_change IS
  'Where the text differed from the read before, the last time this page was read again: {when, at, was, now, before, after}.';
