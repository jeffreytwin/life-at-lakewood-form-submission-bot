-- The Realtor contact form gained an "Interest" checkbox group asking whether
-- the contact wants to buy, build or sell. Zapier posts the ticked boxes as one
-- string (e.g. "Buy, Sell") in buy_build_or_sell.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS buy_build_or_sell text;

COMMENT ON COLUMN leads.buy_build_or_sell IS
  'Realtor contact form "Interest": which of Buy / Build / Sell the contact ticked, joined by Zapier (e.g. "Buy, Sell"). Null when none were ticked or the form has no such field.';
