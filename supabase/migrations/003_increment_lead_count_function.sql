-- Function to atomically increment monthly lead count
CREATE OR REPLACE FUNCTION increment_lead_count(
  p_agent_id UUID,
  p_year_month TEXT
)
RETURNS void AS $$
BEGIN
  INSERT INTO monthly_lead_counts (agent_id, year_month, lead_count)
  VALUES (p_agent_id, p_year_month, 1)
  ON CONFLICT (agent_id, year_month)
  DO UPDATE SET lead_count = monthly_lead_counts.lead_count + 1;
END;
$$ LANGUAGE plpgsql;
