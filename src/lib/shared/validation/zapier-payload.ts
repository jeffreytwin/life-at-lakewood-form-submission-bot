import { z } from "zod";

export const zapierPayloadSchema = z.object({
  webhook_secret: z.string(),
  location: z.string(),
  form_name: z.string(),
  salesforce_record_id: z.string().optional().nullable(),
  owner_name: z.string().optional().nullable(),
  salesforce_owner_id: z.string().optional().nullable(),
  first_name: z.string(),
  last_name: z.string(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  floor_plan: z.string().optional().nullable(),
  village: z.string().optional().nullable(),
  price: z.string().optional().nullable(),
  home_type: z.string().optional().nullable(),
  property_address: z.string().optional().nullable(),
  url: z.string().optional().nullable(),
  builder: z.string().optional().nullable(),
  timeline: z.string().optional().nullable(),
  message: z.string().optional().nullable(),
});

export type ZapierPayload = z.infer<typeof zapierPayloadSchema>;
