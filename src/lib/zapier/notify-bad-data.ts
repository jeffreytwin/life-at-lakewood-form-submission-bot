import { logger } from "@/lib/shared/logger";

interface BadDataPayload {
  salesforce_record_id: string;
  lead_id: string;
  lead_name: string;
  email: string | null;
  phone: string | null;
  form_name: string | null;
  new_status: "Bad Data";
  bad_data_disqualified: "Bogus Lead";
  marked_at: string;
}

export interface NotifyBadDataResult {
  success: boolean;
  error?: string;
}

/**
 * Fire the Zapier webhook that sets the lead's Salesforce Status to
 * "Bad Data" and its "Bad Data / Disqualified" field to "Bogus Lead".
 *
 * Unlike the acceptance hook this is NOT fire-and-forget: the admin button
 * that triggers it aborts the local cleanup when Salesforce can't be
 * updated, otherwise local state says "bogus" while the Salesforce hand
 * raise report keeps counting the lead.
 */
export async function notifyBadData(
  payload: BadDataPayload
): Promise<NotifyBadDataResult> {
  const catchHookUrl = process.env.ZAPIER_BAD_DATA_HOOK;

  if (!catchHookUrl) {
    return { success: false, error: "ZAPIER_BAD_DATA_HOOK not configured" };
  }

  let response: Response;
  try {
    response = await fetch(catchHookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return {
      success: false,
      error: `Zapier webhook fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    return {
      success: false,
      error: `Zapier webhook returned ${response.status}: ${errText}`,
    };
  }

  logger.info("Zapier notified of bad data lead", {
    salesforceRecordId: payload.salesforce_record_id,
    leadId: payload.lead_id,
  });

  return { success: true };
}
