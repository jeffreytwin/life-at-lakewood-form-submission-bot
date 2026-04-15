import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { isBusinessHours } from "@/lib/shared/business-hours";

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

/** Compute start-of-day N days ago in Eastern time, returned as UTC ISO string */
function easternDayStart(daysAgo: number): string {
  const now = new Date();
  const etNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  etNow.setHours(0, 0, 0, 0);
  etNow.setDate(etNow.getDate() - (daysAgo - 1)); // days=1 means start of today ET
  const etMidnightStr = `${etNow.getFullYear()}-${String(etNow.getMonth() + 1).padStart(2, "0")}-${String(etNow.getDate()).padStart(2, "0")}T00:00:00`;
  const naive = new Date(etMidnightStr);
  const sample = new Date(naive.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offsetMs = sample.getTime() - naive.getTime();
  return new Date(naive.getTime() - offsetMs).toISOString();
}

export async function GET(request: NextRequest) {
  try {
    const daysParam = request.nextUrl.searchParams.get("days");
    const days = daysParam ? parseInt(daysParam, 10) : 7;
    const periodCutoff = days > 0 ? easternDayStart(days) : null;

    // Get current month boundaries in Eastern time
    const nowET = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
    );
    const monthStart = easternMonthBoundary(nowET.getFullYear(), nowET.getMonth(), 1);
    const monthEnd = easternMonthBoundary(nowET.getFullYear(), nowET.getMonth() + 1, 1);

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

    // Median email response time (filtered by requested period).
    // Measures time from draft creation to sent_at, but only for drafts
    // where the triggering inbound email was received during business hours
    // (Mon-Fri 8:30am-5:30pm ET, excluding US federal holidays).
    let medianQuery = supabase
      .from("email_drafts")
      .select("id, thread_id, sent_at, created_at")
      .eq("status", "sent")
      .eq("is_simulation", false)
      .not("sent_at", "is", null);
    if (periodCutoff) medianQuery = medianQuery.gte("sent_at", periodCutoff);
    const { data: sentDraftsForMedian } = await medianQuery;

    let medianResponseTimeMinutes: number | null = null;
    if (sentDraftsForMedian && sentDraftsForMedian.length > 0) {
      // For each draft, find the most recent inbound email in its thread
      // that arrived at or before the draft was created. That is the
      // inbound email the draft is a response to.
      const threadIds = Array.from(
        new Set(
          sentDraftsForMedian
            .map((d) => d.thread_id)
            .filter((id): id is string => !!id)
        )
      );

      const inboundByThread: Record<string, { received_at: string }[]> = {};
      if (threadIds.length > 0) {
        const { data: inbound } = await supabase
          .from("email_messages")
          .select("thread_id, received_at")
          .eq("direction", "inbound")
          .in("thread_id", threadIds)
          .not("received_at", "is", null)
          .order("received_at", { ascending: false });

        for (const m of inbound ?? []) {
          if (!m.thread_id || !m.received_at) continue;
          if (!inboundByThread[m.thread_id]) inboundByThread[m.thread_id] = [];
          inboundByThread[m.thread_id].push({ received_at: m.received_at });
        }
      }

      const diffs: number[] = [];
      for (const draft of sentDraftsForMedian) {
        if (!draft.sent_at || !draft.created_at || !draft.thread_id) continue;
        const createdMs = new Date(draft.created_at).getTime();
        const sentMs = new Date(draft.sent_at).getTime();

        // Find the latest inbound message received at or before the draft
        // was created.
        const msgs = inboundByThread[draft.thread_id] ?? [];
        const triggering = msgs.find(
          (m) => new Date(m.received_at).getTime() <= createdMs
        );
        if (!triggering) continue;

        // Filter: only include emails that came in during business hours.
        if (!isBusinessHours(new Date(triggering.received_at))) continue;

        const diffMs = sentMs - createdMs;
        if (diffMs > 0) diffs.push(diffMs);
      }

      if (diffs.length > 0) {
        diffs.sort((a, b) => a - b);
        const mid = Math.floor(diffs.length / 2);
        const medianMs =
          diffs.length % 2 === 0
            ? (diffs[mid - 1] + diffs[mid]) / 2
            : diffs[mid];
        medianResponseTimeMinutes = Math.round(medianMs / 60_000);
      }
    }

    // Sent emails in selected period
    let sentQuery = supabase
      .from("email_drafts")
      .select("*", { count: "exact", head: true })
      .eq("status", "sent")
      .eq("is_simulation", false);
    if (periodCutoff) sentQuery = sentQuery.gte("sent_at", periodCutoff);
    const { count: sentEmails } = await sentQuery;

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
    // sender_name lives on email_threads, so join via thread_id
    const { data: recentDraftsRaw } = await supabase
      .from("email_drafts")
      .select("id, status, subject, created_at, sent_at, approved_at, agent_handoff_transferred, thread:thread_id(sender_name)")
      .eq("is_simulation", false)
      .neq("status", "discarded")
      .order("created_at", { ascending: false })
      .limit(10);

    const recentEmails = (recentDraftsRaw ?? []).map((d) => ({
      id: d.id,
      status: d.status,
      subject: d.subject,
      created_at: d.created_at,
      sent_at: d.sent_at,
      approved_at: d.approved_at,
      agent_handoff_transferred: d.agent_handoff_transferred,
      sender_name: (d.thread as unknown as { sender_name: string | null } | null)?.sender_name ?? null,
    }));

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
      medianResponseTimeMinutes,
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
