import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const messageSid = formData.get("MessageSid") as string;
    const messageStatus = formData.get("MessageStatus") as string;
    const errorCode = formData.get("ErrorCode") as string | null;

    logger.info("Twilio delivery status callback", {
      messageSid,
      messageStatus,
      errorCode,
    });

    // We log delivery statuses for debugging but don't take action
    // Failed deliveries will be caught by the timeout escalation flow

    return new NextResponse("<Response/>", {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  } catch (error) {
    logger.error("Twilio status webhook error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new NextResponse("<Response/>", {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }
}
