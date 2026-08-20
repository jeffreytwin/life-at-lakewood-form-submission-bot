-- When an agent is offboarded, Salesforce ownership of their leads moves to
-- the frontlines account and their name is recorded in
-- Previous_Agent_Offboarded__c. Ownership therefore looks like "nobody owns
-- this" long after the relationship was real, and the lead would be auctioned
-- to a new agent as if it had never been worked.
--
-- Carry that marker through both paths that judge ownership: form submissions
-- (leads) and the email hub (salesforce_contacts -> email_threads).

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS previous_agent_offboarded text;

ALTER TABLE salesforce_contacts
  ADD COLUMN IF NOT EXISTS previous_agent_offboarded text;

ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS previous_agent_offboarded text;

COMMENT ON COLUMN leads.previous_agent_offboarded IS
  'Salesforce Previous_Agent_Offboarded__c. Non-blank means a former agent owned this lead before it was moved to frontlines, so it is not free to auction.';
