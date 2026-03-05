import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

const leadDistPayloadSchema = z.object({
  webhook_secret: z.string(),
  agents: z.array(
    z.object({
      name: z.string(),
      lead_count: z.number().int().min(0),
    })
  ),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = leadDistPayloadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { webhook_secret, agents } = parsed.data;

    if (
      webhook_secret !==
      process.env.ZAPIER_LEAD_DISTRIBUTION_WEBHOOK_SECRET
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Current month in Eastern time
    const now = new Date();
    const etMonth = now.toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
    });
    // etMonth is "MM/DD/YYYY" — extract to "YYYY-MM"
    const [month, , year] = etMonth.split("/");
    const yearMonth = `${year}-${month}`;

    const syncedAt = now.toISOString();

    // Upsert all agent counts for this month
    const { error } = await supabase.from("lead_distribution_snapshots").upsert(
      agents.map((a) => ({
        year_month: yearMonth,
        agent_name: a.name,
        lead_count: a.lead_count,
        synced_at: syncedAt,
      })),
      { onConflict: "year_month,agent_name" }
    );

    if (error) {
      logger.error("Failed to upsert lead distribution", {
        error: error.message,
      });
      return NextResponse.json(
        { error: "Database error", details: error.message },
        { status: 500 }
      );
    }

    logger.info("Lead distribution synced", {
      yearMonth,
      agentCount: agents.length,
    });

    return NextResponse.json({
      synced: agents.length,
      yearMonth,
    });
  } catch (error) {
    logger.error("Lead distribution webhook error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
