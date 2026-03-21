import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

/** Convert a Date to YYYY-MM-DD in US Eastern time */
function toEasternDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Get start-of-day in Eastern time as a UTC ISO string */
function easternMonthBoundary(year: number, month: number, day: number): string {
  const str = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00`;
  const eastern = new Date(
    new Date(str).toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  // Reconstruct as if the wall-clock time is midnight ET
  const offset = eastern.getTime() - new Date(str).getTime();
  return new Date(new Date(str).getTime() - offset).toISOString();
}

/**
 * Check if a timestamp falls during quiet hours (Eastern Time).
 * Quiet hours typically span overnight, e.g. 21:00 -> 08:30.
 */
function isDuringQuietHours(
  isoTimestamp: string,
  qhStart: string,
  qhEnd: string,
): boolean {
  const dt = new Date(isoTimestamp);
  const etTime = dt.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [hStr, mStr] = etTime.split(":");
  const timeMinutes = parseInt(hStr) * 60 + parseInt(mStr);

  const [sh, sm] = qhStart.split(":").map(Number);
  const startMinutes = sh * 60 + sm;
  const [eh, em] = qhEnd.split(":").map(Number);
  const endMinutes = eh * 60 + em;

  if (startMinutes > endMinutes) {
    // Overnight span (e.g. 21:00 -> 08:30)
    return timeMinutes >= startMinutes || timeMinutes < endMinutes;
  } else {
    return timeMinutes >= startMinutes && timeMinutes < endMinutes;
  }
}

/**
 * Pick the correct quiet hours end time for a given timestamp,
 * based on whether the "morning" that ends quiet hours falls on a weekday or weekend.
 */
function getEndForTimestamp(
  isoTimestamp: string,
  qhStart: string,
  endWeekday: string,
  endWeekend: string,
): string {
  const dt = new Date(isoTimestamp);
  const et = new Date(dt.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const nowMin = et.getHours() * 60 + et.getMinutes();
  const [sh, sm] = qhStart.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const [ewh, ewm] = endWeekday.split(":").map(Number);
  const endWeekdayMin = ewh * 60 + ewm;

  const day = et.getDay();
  let endDay: number;
  if (startMin > endWeekdayMin) {
    endDay = nowMin >= startMin ? (day + 1) % 7 : day;
  } else {
    endDay = day;
  }
  const isWeekend = endDay === 0 || endDay === 6;
  return isWeekend ? endWeekend : endWeekday;
}

export async function GET() {
  try {
    // Get current month boundaries in Eastern time
    const nowET = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
    );
    const monthStart = easternMonthBoundary(nowET.getFullYear(), nowET.getMonth(), 1);
    const monthEnd = easternMonthBoundary(nowET.getFullYear(), nowET.getMonth() + 1, 1);

    // Fetch quiet hours settings
    const { data: settings } = await supabase
      .from("system_settings")
      .select("quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_end_weekday, quiet_hours_end_weekend")
      .eq("id", 1)
      .single();

    const qhEnabled = settings?.quiet_hours_enabled ?? true;
    const qhStart = settings?.quiet_hours_start ?? "21:00";
    const qhEndWeekday = settings?.quiet_hours_end_weekday ?? "06:30";
    const qhEndWeekend = settings?.quiet_hours_end_weekend ?? settings?.quiet_hours_end ?? "08:30";

    // Incoming emails this month (only from Salesforce-verified senders)
    // First get thread IDs that have a Salesforce lead linked
    const { data: verifiedThreads } = await supabase
      .from("email_threads")
      .select("id")
      .not("salesforce_lead_id", "is", null);

    const verifiedThreadIds = (verifiedThreads ?? []).map((t) => t.id);

    let inboundThisMonth = 0;
    if (verifiedThreadIds.length > 0) {
      const { count } = await supabase
        .from("email_messages")
        .select("id", { count: "exact", head: true })
        .eq("direction", "inbound")
        .in("thread_id", verifiedThreadIds)
        .gte("received_at", monthStart)
        .lt("received_at", monthEnd);
      inboundThisMonth = count ?? 0;
    }

    // Average email response time this month (excluding quiet hours)
    // Measures time from first inbound message in thread to sent_at
    const { data: sentDraftsForAvg } = await supabase
      .from("email_drafts")
      .select("thread_id, sent_at")
      .eq("status", "sent")
      .eq("is_simulation", false)
      .not("sent_at", "is", null)
      .not("thread_id", "is", null)
      .gte("sent_at", monthStart)
      .lt("sent_at", monthEnd);

    let avgResponseTimeMinutes: number | null = null;
    if (sentDraftsForAvg && sentDraftsForAvg.length > 0) {
      const threadIds = [...new Set(sentDraftsForAvg.map((d) => d.thread_id!))];
      // Get the earliest inbound message per thread
      const { data: inboundMessages } = await supabase
        .from("email_messages")
        .select("thread_id, received_at")
        .in("thread_id", threadIds)
        .eq("direction", "inbound")
        .order("received_at", { ascending: true });

      if (inboundMessages && inboundMessages.length > 0) {
        // Map thread_id -> earliest inbound received_at
        const earliestInbound: Record<string, string> = {};
        for (const msg of inboundMessages) {
          if (msg.thread_id && msg.received_at && !earliestInbound[msg.thread_id]) {
            earliestInbound[msg.thread_id] = msg.received_at;
          }
        }

        const diffs: number[] = [];
        for (const draft of sentDraftsForAvg) {
          const inboundAt = draft.thread_id ? earliestInbound[draft.thread_id] : null;
          if (inboundAt && draft.sent_at) {
            // Exclude emails received during quiet hours
            const qhEnd = getEndForTimestamp(inboundAt, qhStart, qhEndWeekday, qhEndWeekend);
            if (qhEnabled && isDuringQuietHours(inboundAt, qhStart, qhEnd)) {
              continue;
            }
            const diffMs = new Date(draft.sent_at).getTime() - new Date(inboundAt).getTime();
            if (diffMs > 0) diffs.push(diffMs);
          }
        }

        if (diffs.length > 0) {
          const avgMs = diffs.reduce((a, b) => a + b, 0) / diffs.length;
          avgResponseTimeMinutes = Math.round(avgMs / 60_000);
        }
      }
    }

    // Sent emails this month
    const { count: sentEmails } = await supabase
      .from("email_drafts")
      .select("*", { count: "exact", head: true })
      .eq("status", "sent")
      .eq("is_simulation", false)
      .gte("created_at", monthStart)
      .lt("created_at", monthEnd);

    // Agent handoffs this month
    const { count: agentHandoffs } = await supabase
      .from("email_drafts")
      .select("*", { count: "exact", head: true })
      .eq("agent_handoff_transferred", true)
      .eq("is_simulation", false)
      .gte("agent_handoff_transferred_at", monthStart)
      .lt("agent_handoff_transferred_at", monthEnd);

    // Drafts per day this month (for graph)
    const { data: monthDrafts } = await supabase
      .from("email_drafts")
      .select("created_at, status, sent_at")
      .eq("is_simulation", false)
      .gte("created_at", monthStart)
      .lt("created_at", monthEnd)
      .order("created_at", { ascending: true });

    // Aggregate by day (Eastern time)
    const dailyStats: Record<string, { drafted: number; sent: number }> = {};
    for (const d of monthDrafts ?? []) {
      const day = toEasternDate(new Date(d.created_at));
      if (!dailyStats[day]) dailyStats[day] = { drafted: 0, sent: 0 };
      dailyStats[day].drafted++;
      if (d.status === "sent") dailyStats[day].sent++;
    }

    const dailyGraph = Object.entries(dailyStats)
      .map(([date, counts]) => ({ date, ...counts }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Recent emails (mix of drafts and sent, last 10 — exclude discarded)
    const { data: recentEmails } = await supabase
      .from("email_drafts")
      .select("id, status, subject, created_at, sent_at, approved_at, agent_handoff_transferred")
      .eq("is_simulation", false)
      .neq("status", "discarded")
      .order("created_at", { ascending: false })
      .limit(10);

    // Agent handoffs per agent this month (for handoffs graph)
    const { data: handoffDrafts } = await supabase
      .from("email_drafts")
      .select("agent_handoff_id")
      .eq("agent_handoff_transferred", true)
      .eq("is_simulation", false)
      .gte("agent_handoff_transferred_at", monthStart)
      .lt("agent_handoff_transferred_at", monthEnd);

    // Count per agent
    const handoffCounts: Record<string, number> = {};
    for (const d of handoffDrafts ?? []) {
      if (d.agent_handoff_id) {
        handoffCounts[d.agent_handoff_id] = (handoffCounts[d.agent_handoff_id] ?? 0) + 1;
      }
    }

    // Resolve agent names
    const agentIds = Object.keys(handoffCounts);
    let agentHandoffGraph: { agentName: string; handoffs: number }[] = [];
    if (agentIds.length > 0) {
      const { data: agents } = await supabase
        .from("agents")
        .select("id, name")
        .in("id", agentIds);

      const nameMap: Record<string, string> = {};
      for (const a of agents ?? []) {
        nameMap[a.id] = a.name;
      }

      agentHandoffGraph = agentIds
        .map((id) => ({
          agentName: nameMap[id] ?? "Unknown",
          handoffs: handoffCounts[id],
        }))
        .sort((a, b) => b.handoffs - a.handoffs);
    }

    return NextResponse.json({
      inboundThisMonth,
      avgResponseTimeMinutes,
      sentEmails: sentEmails ?? 0,
      agentHandoffs: agentHandoffs ?? 0,
      dailyGraph,
      recentEmails: recentEmails ?? [],
      agentHandoffGraph,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
