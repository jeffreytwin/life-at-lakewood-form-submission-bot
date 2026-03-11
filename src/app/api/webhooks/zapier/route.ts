import { NextRequest, NextResponse } from "next/server";
import { zapierPayloadSchema } from "@/lib/shared/validation/zapier-payload";
import { routeLead } from "@/lib/routing/router";
import { logger } from "@/lib/shared/logger";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate payload
    const parsed = zapierPayloadSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn("Invalid Zapier payload", {
        errors: parsed.error.flatten(),
      });
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Verify webhook secret
    if (parsed.data.webhook_secret !== process.env.ZAPIER_WEBHOOK_SECRET) {
      logger.warn("Invalid webhook secret");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Route the lead
    const result = await routeLead(parsed.data);

    logger.info("Zapier webhook processed", {
      status: result.status,
      leadId: result.leadId,
      location: parsed.data.location,
      formName: parsed.data.form_name,
      contactName: `${parsed.data.first_name} ${parsed.data.last_name}`,
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error("Zapier webhook error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
