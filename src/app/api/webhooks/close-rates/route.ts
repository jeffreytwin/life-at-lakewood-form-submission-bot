import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { parseCloseRateReport } from "@/lib/salesforce/parse-close-rate-report";

// Format 1: Pre-formatted agent array (original format)
const preformattedPayloadSchema = z.object({
  webhook_secret: z.string(),
  agents: z.array(
    z.object({
      salesforce_user_id: z.string(),
      name: z.string(),
      close_rate_trailing_12m: z.number().min(0).max(1),
      close_rate_all_time: z.number().min(0).max(1).optional(),
    })
  ),
});

// Format 2: Raw Salesforce Analytics API report response
const salesforceReportPayloadSchema = z.object({
  webhook_secret: z.string(),
  report: z.object({
    groupingsDown: z.object({
      groupings: z.array(z.unknown()),
    }),
    factMap: z.record(z.string(), z.unknown()),
  }),
});

export async function POST(request: NextRequest) {
  try {
    const rawText = await request.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawText);
    } catch {
      return NextResponse.json({
        error: "JSON parse failed",
        raw_preview: rawText.substring(0, 200),
        raw_type: typeof rawText,
      }, { status: 400 });
    }

    // TEMPORARY DEBUG: return body structure to diagnose auth issue
    // TODO: Remove this debug block after fixing auth
    const secret = body?.webhook_secret;
    const envSecret = process.env.ZAPIER_CLOSE_RATES_WEBHOOK_SECRET;
    if (secret !== envSecret) {
      return NextResponse.json({
        status: "AUTH_DEBUG",
        body_keys: Object.keys(body || {}),
        body_type: typeof body,
        secret_received: secret ? `${String(secret).substring(0, 4)}...` : "(missing)",
        secret_type: typeof secret,
        env_var_set: !!envSecret,
        env_var_preview: envSecret ? `${envSecret.substring(0, 4)}...` : "(not set)",
        raw_preview: rawText.substring(0, 100),
      });
    }

    // Detect format: does the payload have a "report" key or an "agents" key?
    let agentUpdates: {
      salesforce_user_id: string;
      name: string;
      close_rate_trailing_12m: number;
      close_rate_all_time?: number;
    }[];

    if ("report" in body) {
      // Format 2: Raw Salesforce report
      const reportValidation = salesforceReportPayloadSchema.safeParse(body);
      if (!reportValidation.success) {
        return NextResponse.json(
          { error: "Invalid Salesforce report payload", details: reportValidation.error.flatten() },
          { status: 400 }
        );
      }

      try {
        agentUpdates = parseCloseRateReport(reportValidation.data.report);
      } catch (parseError) {
        logger.error("Failed to parse Salesforce report", {
          error: parseError instanceof Error ? parseError.message : String(parseError),
        });
        return NextResponse.json(
          { error: "Failed to parse Salesforce report", details: parseError instanceof Error ? parseError.message : String(parseError) },
          { status: 400 }
        );
      }

      logger.info("Parsed Salesforce close rate report", {
        agentCount: agentUpdates.length,
        agents: agentUpdates.map((a) => ({
          name: a.name,
          rate: a.close_rate_trailing_12m,
        })),
      });
    } else if ("agents" in body) {
      // Format 1: Pre-formatted array
      const parsed = preformattedPayloadSchema.safeParse(body);
      if (!parsed.success) {
        const firstAgent = Array.isArray(body.agents) ? body.agents[0] : body.agents;
        return NextResponse.json(
          {
            error: "Invalid payload",
            details: parsed.error.flatten(),
            debug: {
              agents_type: typeof body.agents,
              agents_is_array: Array.isArray(body.agents),
              agents_length: Array.isArray(body.agents) ? body.agents.length : null,
              first_agent: firstAgent,
              first_agent_keys: firstAgent ? Object.keys(firstAgent) : null,
              first_agent_rate_type: firstAgent ? typeof firstAgent.close_rate_trailing_12m : null,
              first_agent_rate_value: firstAgent ? firstAgent.close_rate_trailing_12m : null,
              body_keys: Object.keys(body),
            },
          },
          { status: 400 }
        );
      }
      agentUpdates = parsed.data.agents;
    } else {
      return NextResponse.json(
        { error: "Invalid payload: must contain either 'agents' array or 'report' object" },
        { status: 400 }
      );
    }

    // Update each agent's close rate in the database
    let updated = 0;
    let skipped = 0;

    for (const agentData of agentUpdates) {
      const updateFields: Record<string, number> = {
        close_rate_trailing_12m: agentData.close_rate_trailing_12m,
      };
      if (agentData.close_rate_all_time !== undefined) {
        updateFields.close_rate_all_time = agentData.close_rate_all_time;
      }

      const { error } = await supabase
        .from("agents")
        .update(updateFields)
        .eq("salesforce_user_id", agentData.salesforce_user_id);

      if (error) {
        logger.warn("Failed to update close rate", {
          agent: agentData.name,
          salesforce_user_id: agentData.salesforce_user_id,
          error: error.message,
        });
        skipped++;
      } else {
        updated++;
      }
    }

    logger.info("Close rates synced", { updated, skipped, total: agentUpdates.length });

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
