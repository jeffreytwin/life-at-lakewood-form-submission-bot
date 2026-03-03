import { logger } from "@/lib/shared/logger";

interface AcceptancePayload {
  salesforce_record_id: string;
  agent_name: string;
  agent_salesforce_user_id: string | null;
  lead_name: string;
  accepted_at: string;
}

export async function notifyAcceptance(payload: AcceptancePayload) {
  const catchHookUrl = process.env.ZAPIER_CATCH_HOOK_ACCEPTANCE;

  if (!catchHookUrl) {
    logger.warn("ZAPIER_CATCH_HOOK_ACCEPTANCE not configured, skipping SF update");
    return;
  }

  try {
    const response = await fetch(catchHookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logger.error("Zapier Catch Hook failed", {
        status: response.status,
        statusText: response.statusText,
        payload,
      });
    } else {
      logger.info("Zapier Catch Hook notified of acceptance", {
        salesforce_record_id: payload.salesforce_record_id,
        agent_name: payload.agent_name,
      });
    }
  } catch (error) {
    logger.error("Failed to call Zapier Catch Hook", {
      error: error instanceof Error ? error.message : String(error),
      payload,
    });
  }
}
