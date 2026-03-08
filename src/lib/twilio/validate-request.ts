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

  // Build the URL from the request's host header so it matches the URL
  // Twilio actually sent to, regardless of APP_BASE_URL configuration.
  const host = request.headers.get("host") ?? request.headers.get("x-forwarded-host") ?? "";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const pathname = new URL(request.url).pathname;
  const url = `${proto}://${host}${pathname}`;

  const isValid = twilio.validateRequest(authToken, signature, url, body);
  if (!isValid) {
    logger.warn("Twilio signature validation failed", {
      constructedUrl: url,
      host,
      proto,
    });
  }
  return isValid;
}
