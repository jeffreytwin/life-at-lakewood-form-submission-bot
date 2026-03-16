import { supabase } from "../client";

/**
 * Count today's sent email drafts with agent handoffs, per agent.
 * Uses Eastern time to match the Salesforce daily boundary.
 */
export async function getTodayEmailHandoffCountsByAgent(): Promise<
  Map<string, number>
> {
  const now = new Date();
  const etDate = now.toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });

  // Query a wide UTC window (last 30 hours) then filter by ET date in code.
  const windowStart = new Date(now.getTime() - 30 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from("email_drafts")
    .select("agent_handoff_id, sent_at")
    .eq("status", "sent")
    .not("agent_handoff_id", "is", null)
    .gte("sent_at", windowStart.toISOString());

  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    if (!row.agent_handoff_id || !row.sent_at) continue;
    const rowETDate = new Date(row.sent_at).toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });
    if (rowETDate === etDate) {
      counts.set(
        row.agent_handoff_id,
        (counts.get(row.agent_handoff_id) ?? 0) + 1
      );
    }
  }
  return counts;
}
