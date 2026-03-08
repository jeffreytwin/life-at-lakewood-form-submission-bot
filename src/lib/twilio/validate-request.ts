import twilio from "twilio";
import { NextRequest } from "next/server";
import { logger } from "@/lib/shared/logger";

export function validateTwilioRequest(
  request: NextRequest,
  body: Record<string, string>
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    logger.warn("Twilio signature validation failed: missing TWILIO_AUTH_TOKEN");
    return false;
  }

  const signature = request.headers.get("x-twilio-signature");
  if (!signature) {
    logger.warn("Twilio signature validation failed: missing x-twilio-signature header");
    return false;
  }

  const baseUrl = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
  const url = `${baseUrl}${new URL(request.url).pathname}`;

  const isValid = twilio.validateRequest(authToken, signature, url, body);
  if (!isValid) {
    logger.warn("Twilio signature validation failed", {
      constructedUrl: url,
      appBaseUrl: baseUrl,
    });
  }
  return isValid;
}
