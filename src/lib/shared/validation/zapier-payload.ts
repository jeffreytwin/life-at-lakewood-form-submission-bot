import { z } from "zod";

/** Treat empty and whitespace-only strings as absent. */
const blankToNull = z.preprocess(
  (val) => (typeof val === "string" && val.trim() === "" ? null : val),
  z.string().optional().nullable()
);

export const zapierPayloadSchema = z.object({
  webhook_secret: z.string(),
  location: z.string(),
  form_name: z.string(),
  salesforce_record_id: z.string().optional().nullable(),
  salesforce_owner_id: z.string().optional().nullable(),
  is_master_agent_owned: z.preprocess(
    (val) => String(val).toLowerCase() === "true" || val === true,
    z.boolean()
  ).optional().default(false),
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
  // Salesforce Previous_Agent_Offboarded__c: the former agent's name, set
  // when their leads were moved to the frontlines account, so a lead that
  // looks unowned is really theirs. The Salesforce lead record holds no user
  // ID for them, only this name. Zapier sends "" rather than omitting an
  // empty Salesforce field, so fold blanks down to null.
  previous_agent_offboarded: blankToNull,
});

export type ZapierPayload = z.infer<typeof zapierPayloadSchema>;
