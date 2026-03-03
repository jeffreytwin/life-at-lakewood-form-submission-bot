import twilio from "twilio";
import { NextRequest } from "next/server";

export function validateTwilioRequest(
  request: NextRequest,
  body: Record<string, string>
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return false;

  const signature = request.headers.get("x-twilio-signature");
  if (!signature) return false;

  const url = `${process.env.APP_BASE_URL}${new URL(request.url).pathname}`;

  return twilio.validateRequest(authToken, signature, url, body);
}
