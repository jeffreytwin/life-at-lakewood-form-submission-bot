import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

const closeRatePayloadSchema = z.object({
  webhook_secret: z.string(),
  agents: z.array(
    z.object({
      salesforce_user_id: z.string(),
      name: z.string(),
      close_rate_trailing_12m: z.number().min(0).max(1),
      close_rate_all_time: z.number().min(0).max(1),
    })
  ),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = closeRatePayloadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { webhook_secret, agents } = parsed.data;

    if (webhook_secret !== process.env.ZAPIER_CLOSE_RATES_WEBHOOK_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let updated = 0;
    let skipped = 0;

    for (const agentData of agents) {
      const { error } = await supabase
        .from("agents")
        .update({
          close_rate_trailing_12m: agentData.close_rate_trailing_12m,
          close_rate_all_time: agentData.close_rate_all_time,
        })
        .eq("salesforce_user_id", agentData.salesforce_user_id);

      if (error) {
        logger.warn("Failed to update close rate", {
          agent: agentData.name,
          error: error.message,
        });
        skipped++;
      } else {
        updated++;
      }
    }

    logger.info("Close rates synced", { updated, skipped, total: agents.length });

    return NextResponse.json({ updated, skipped });
  } catch (error) {
    logger.error("Close rates webhook error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
