import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

/**
 * Returns email hub overview stats:
 * - inboundThisMonth: count of inbound emails this calendar month
 * - avgResponseMinutes: avg time from inbound email to draft sent/approved,
 *   excluding emails received during quiet hours
 * - pendingDrafts: drafts still awaiting review
 * - totalActiveThreads: active conversation threads
 */
export async function GET() {
  try {
    // ── Current month boundaries (Eastern Time) ─────────────────
    const now = new Date();
    const etFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = etFormatter.formatToParts(now);
    const year = parts.find((p) => p.type === "year")!.value;
    const month = parts.find((p) => p.type === "month")!.value;
    // Start of month in ET, converted to UTC for DB queries
    const monthStartET = new Date(`${year}-${month}-01T00:00:00-05:00`);

    // ── Fetch quiet hours settings ──────────────────────────────
    const { data: settings } = await supabase
      .from("system_settings")
      .select("quiet_hours_enabled, quiet_hours_start, quiet_hours_end")
      .eq("id", 1)
      .single();

    const qhEnabled = settings?.quiet_hours_enabled ?? true;
    const qhStart = settings?.quiet_hours_start ?? "21:00";
    const qhEnd = settings?.quiet_hours_end ?? "08:30";

    // ── 1. Inbound emails this month ────────────────────────────
    const { count: inboundThisMonth } = await supabase
      .from("email_messages")
      .select("id", { count: "exact", head: true })
      .eq("direction", "inbound")
      .gte("received_at", monthStartET.toISOString());

    // ── 2. Pending drafts ───────────────────────────────────────
    const { count: pendingDrafts } = await supabase
      .from("email_drafts")
      .select("id", { count: "exact", head: true })
      .eq("status", "drafted")
      .eq("is_simulation", false);

    // ── 3. Active threads ───────────────────────────────────────
    const { count: totalActiveThreads } = await supabase
      .from("email_threads")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);

    // ── 4. Avg email response time (excluding quiet hours) ──────
    // Response time = time from inbound message received_at to
    // draft sent_at (for sent drafts) or edited_at (for approved drafts)
    const { data: sentDrafts } = await supabase
      .from("email_drafts")
      .select("thread_id, sent_at, edited_at, status")
      .in("status", ["sent", "edited"])
      .eq("is_simulation", false);

    let totalResponseMinutes = 0;
    let responseCount = 0;

    if (sentDrafts && sentDrafts.length > 0) {
      // Get the triggering inbound message for each thread
      const threadIds = [...new Set(sentDrafts.map((d) => d.thread_id))];
      const { data: inboundMessages } = await supabase
        .from("email_messages")
        .select("thread_id, received_at")
        .eq("direction", "inbound")
        .in("thread_id", threadIds)
        .order("received_at", { ascending: false });

      // Map: thread_id -> most recent inbound message received_at
      const latestInbound = new Map<string, string>();
      for (const msg of inboundMessages ?? []) {
        if (!latestInbound.has(msg.thread_id)) {
          latestInbound.set(msg.thread_id, msg.received_at);
        }
      }

      for (const draft of sentDrafts) {
        const receivedAt = latestInbound.get(draft.thread_id);
        if (!receivedAt) continue;

        // Exclude emails received during quiet hours
        if (qhEnabled && isDuringQuietHours(receivedAt, qhStart, qhEnd)) {
          continue;
        }

        const respondedAt = draft.sent_at ?? draft.edited_at;
        if (!respondedAt) continue;

        const diffMs =
          new Date(respondedAt).getTime() - new Date(receivedAt).getTime();
        if (diffMs < 0) continue;

        totalResponseMinutes += diffMs / 60000;
        responseCount++;
      }
    }

    const avgResponseMinutes =
      responseCount > 0
        ? Math.round((totalResponseMinutes / responseCount) * 10) / 10
        : null;

    return NextResponse.json({
      inboundThisMonth: inboundThisMonth ?? 0,
      avgResponseMinutes,
      responseCount,
      pendingDrafts: pendingDrafts ?? 0,
      totalActiveThreads: totalActiveThreads ?? 0,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/**
 * Check if a timestamp falls during quiet hours (Eastern Time).
 * Quiet hours typically span overnight, e.g. 21:00 → 08:30.
 */
function isDuringQuietHours(
  isoTimestamp: string,
  qhStart: string,
  qhEnd: string,
): boolean {
  // Convert to ET hour/minute
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
    // Overnight span (e.g. 21:00 → 08:30)
    return timeMinutes >= startMinutes || timeMinutes < endMinutes;
  } else {
    // Same-day span
    return timeMinutes >= startMinutes && timeMinutes < endMinutes;
  }
}
