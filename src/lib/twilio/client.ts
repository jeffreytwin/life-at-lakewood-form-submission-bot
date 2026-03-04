import twilio from "twilio";

type TwilioClient = ReturnType<typeof twilio>;

let _client: TwilioClient | null = null;

export function getTwilioClient(): TwilioClient {
  if (_client) return _client;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error("Missing Twilio environment variables");
  }

  _client = twilio(accountSid, authToken);
  return _client;
}

export function getTwilioPhoneNumber(): string {
  const phone = process.env.TWILIO_PHONE_NUMBER;
  if (!phone) throw new Error("Missing TWILIO_PHONE_NUMBER");
  return phone;
}
