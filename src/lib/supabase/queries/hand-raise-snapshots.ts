import { supabase } from "../client";

/**
 * Get the most recent synced_at timestamp for today's daily_by_agent snapshot.
 * Returns null if no daily snapshot exists for today.
 *
 * This is used to determine which bot-routed leads have already been captured
 * in the Salesforce snapshot, so we only add post-sync leads on top.
 */
export async function getLastDailySyncTimestamp(): Promise<string | null> {
  const etDate = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });

  const { data, error } = await supabase
    .from("hand_raise_snapshots")
    .select("synced_at")
    .eq("type", "daily_by_agent")
    .eq("year_month", etDate)
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.synced_at ?? null;
}
