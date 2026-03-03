import { z } from "zod";

export const twilioInboundSchema = z.object({
  MessageSid: z.string(),
  AccountSid: z.string(),
  From: z.string(),
  To: z.string(),
  Body: z.string(),
  NumMedia: z.string().optional(),
});

export type TwilioInboundPayload = z.infer<typeof twilioInboundSchema>;

export const twilioStatusSchema = z.object({
  MessageSid: z.string(),
  MessageStatus: z.string(),
  To: z.string(),
  ErrorCode: z.string().optional(),
  ErrorMessage: z.string().optional(),
});

export type TwilioStatusPayload = z.infer<typeof twilioStatusSchema>;
