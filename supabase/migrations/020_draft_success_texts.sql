-- Add draft success text notification fields to agents
ALTER TABLE agents
  ADD COLUMN send_draft_success_texts BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN draft_success_phone TEXT;
