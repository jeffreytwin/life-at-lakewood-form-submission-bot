-- Rename "Lynn Brown - Lakewood" to "Lynn Brown - Lakewood Ranch"
UPDATE email_accounts
SET display_name = 'Lynn Brown - Lakewood Ranch'
WHERE email_address = 'lynn@lifeatlakewood.com'
  AND display_name = 'Lynn Brown - Lakewood';
