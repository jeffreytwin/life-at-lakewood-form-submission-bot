import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

const agentEntrySchema = z.object({
  name: z.string(),
  salesforce_user_id: z.string(),
  count: z.number().int().min(0),
});

const dailyAgentEntrySchema = z.object({
  salesforce_user_id: z.string(),
  date: z.string(), // "2026-03-09"
  count: z.number().int().min(0),
});

const monthEntrySchema = z.object({
  month: z.string(), // "2026-03" or "March 2026"
  count: z.number().int().min(0),
});

const payloadSchema = z.object({
  webhook_secret: z.string(),
  type: z.enum(["monthly_by_agent", "yearly_by_month"]),
  data: z.union([
    z.array(agentEntrySchema),
    z.array(monthEntrySchema),
    z.string(), // JSON-stringified array from Zapier
  ]),
  daily_data: z.union([
    z.array(dailyAgentEntrySchema),
    z.string(), // JSON-stringified array from Zapier
  ]).optional(),
});

/** Normalize month labels like "March 2026" → "2026-03" */
function normalizeMonth(input: string): string {
  // Already in YYYY-MM format
  if (/^\d{4}-\d{2}$/.test(input)) return input;

  // "March 2026" or "December 2024" format
  const date = new Date(input + " 1");
  if (!isNaN(date.getTime())) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  }

  return input;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = payloadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { webhook_secret, type } = parsed.data;

    const envSecret = String(
      process.env.ZAPIER_HAND_RAISES_WEBHOOK_SECRET || ""
    ).trim();
    if (!webhook_secret.trim() || webhook_secret.trim() !== envSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse data — may be a JSON string from Zapier Code step
    let data: unknown[];
    if (typeof parsed.data.data === "string") {
      try {
        data = JSON.parse(parsed.data.data);
      } catch {
        return NextResponse.json(
          { error: "Invalid JSON in data field" },
          { status: 400 }
        );
      }
    } else {
      data = parsed.data.data;
    }

    const syncedAt = new Date().toISOString();

    if (type === "monthly_by_agent") {
      const agents = z.array(agentEntrySchema).parse(data);

      // Current month in Eastern time
      const now = new Date();
      const etMonth = now.toLocaleDateString("en-US", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
      });
      const [month, year] = etMonth.split("/");
      const yearMonth = `${year}-${month}`;

      // Delete existing snapshot for this month, then insert fresh data
      await supabase
        .from("hand_raise_snapshots")
        .delete()
        .eq("type", "monthly_by_agent")
        .eq("year_month", yearMonth);

      const { error } = await supabase.from("hand_raise_snapshots").insert(
        agents.map((a) => ({
          type: "monthly_by_agent",
          year_month: yearMonth,
          agent_name: a.name,
          salesforce_user_id: a.salesforce_user_id,
          count: a.count,
          synced_at: syncedAt,
        }))
      );

      if (error) {
        logger.error("Failed to upsert hand raise agent data", {
          error: error.message,
        });
        return NextResponse.json(
          { error: "Database error", details: error.message },
          { status: 500 }
        );
      }

      logger.info("Hand raises (monthly by agent) synced", {
        yearMonth,
        agentCount: agents.length,
        total: agents.reduce((sum, a) => sum + a.count, 0),
      });

      // Process daily data if provided (per-agent per-date counts from report detail rows)
      let dailySynced = 0;
      if (parsed.data.daily_data) {
        let rawDaily: unknown[];
        if (typeof parsed.data.daily_data === "string") {
          try {
            rawDaily = JSON.parse(parsed.data.daily_data);
          } catch {
            logger.error("Invalid JSON in daily_data field");
            rawDaily = [];
          }
        } else {
          rawDaily = parsed.data.daily_data;
        }

        if (rawDaily.length > 0) {
          const dailyEntries = z.array(dailyAgentEntrySchema).parse(rawDaily);

          // Get unique dates in this batch
          const dates = [...new Set(dailyEntries.map((d) => d.date))];

          // Delete existing daily snapshots for these dates
          for (const date of dates) {
            await supabase
              .from("hand_raise_snapshots")
              .delete()
              .eq("type", "daily_by_agent")
              .eq("year_month", date);
          }

          const { error: dailyError } = await supabase
            .from("hand_raise_snapshots")
            .insert(
              dailyEntries.map((d) => ({
                type: "daily_by_agent",
                year_month: d.date,
                agent_name: null,
                salesforce_user_id: d.salesforce_user_id,
                count: d.count,
                synced_at: syncedAt,
              }))
            );

          if (dailyError) {
            logger.error("Failed to insert daily agent data", {
              error: dailyError.message,
            });
          } else {
            dailySynced = dailyEntries.length;
            logger.info("Daily lead counts synced from Salesforce", {
              dates,
              entries: dailySynced,
            });
          }
        }
      }

      return NextResponse.json({
        synced: agents.length,
        dailySynced,
        yearMonth,
        type,
      });
    } else {
      // yearly_by_month
      const months = z.array(monthEntrySchema).parse(data);

      const rows = months.map((m) => ({
        type: "yearly_by_month",
        year_month: normalizeMonth(m.month),
        agent_name: null,
        salesforce_user_id: null,
        count: m.count,
        synced_at: syncedAt,
      }));

      // Delete existing yearly snapshot, then insert fresh data
      await supabase
        .from("hand_raise_snapshots")
        .delete()
        .eq("type", "yearly_by_month");

      const { error } = await supabase
        .from("hand_raise_snapshots")
        .insert(rows);

      if (error) {
        logger.error("Failed to upsert hand raise monthly data", {
          error: error.message,
        });
        return NextResponse.json(
          { error: "Database error", details: error.message },
          { status: 500 }
        );
      }

      logger.info("Hand raises (yearly by month) synced", {
        monthCount: months.length,
        total: months.reduce((sum, m) => sum + m.count, 0),
      });

      return NextResponse.json({
        synced: months.length,
        type,
      });
    }
  } catch (error) {
    logger.error("Hand raises webhook error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
