import { getTwilioClient, getTwilioPhoneNumber } from "./client";
import { logger } from "@/lib/shared/logger";
import type { Lead } from "@/lib/supabase/types";

/**
 * Format "HH:MM" (24h) to a friendly "8:30am" style string for SMS.
 */
function formatTimeForSms(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, "0")}${suffix}`;
}

function buildLeadDetailsBlock(lead: Lead, locationName: string): string {
  const lines: string[] = [
    `Name: ${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim(),
  ];

  if (lead.email) lines.push(`Email: ${lead.email}`);
  if (lead.phone) lines.push(`Phone: ${lead.phone}`);
  if (lead.floor_plan) {
    // Match existing SMS format based on form type
    if (lead.form_name?.startsWith("Lot Availability")) {
      lines.push(`Floor Plan: Interested in lot availability for the ${lead.floor_plan}`);
    } else {
      lines.push(`Floor Plan: Interested in the ${lead.floor_plan}`);
    }
  }
  if (lead.village) lines.push(`Village: ${lead.village}`);
  if (lead.price) lines.push(`Price: ${lead.price}`);
  if (lead.home_type) lines.push(`Home Type: ${lead.home_type}`);
  if (lead.property_address) lines.push(`Property Address: ${lead.property_address}`);
  if (lead.url) lines.push(`URL: ${lead.url}`);
  if (lead.builder) lines.push(`Interested in builder: ${lead.builder}`);
  if (lead.timeline) lines.push(`Timeline: ${lead.timeline}`);
  if (lead.message) {
    if (lead.form_name?.includes("Realtor")) {
      lines.push(`Message (if any): Interested in connecting with a Realtor.`);
      lines.push(lead.message);
    } else {
      lines.push(`Message (if any): ${lead.message}`);
    }
  }

  return lines.join("\n\n");
}

/**
 * @param quietHoursEnd - If provided (e.g. "08:30"), indicates this is during
 *   quiet hours and the follow-up will be deferred until that time.
 */
export async function sendLeadNotification(
  agentPhone: string,
  lead: Lead,
  locationName: string,
  quietHoursEnd?: string
): Promise<string> {
  const details = buildLeadDetailsBlock(lead, locationName);

  const lines = [
    `Heads up! You have a new form submission for ${locationName}. See below:`,
    "",
    details,
    "",
    "Reply YES to accept or NO to pass.",
  ];

  if (quietHoursEnd) {
    lines.push(
      "",
      `(Night mode active — no rush, we'll follow up at ${formatTimeForSms(quietHoursEnd)} ET if we don't hear from you.)`
    );
  }

  const body = lines.join("\n");

  const message = await getTwilioClient().messages.create({
    to: agentPhone,
    from: getTwilioPhoneNumber(),
    body,
  });

  logger.info("Lead notification SMS sent", {
    to: agentPhone,
    messageSid: message.sid,
    leadId: lead.id,
  });

  return message.sid;
}

export async function sendOwnedByNotification(
  frontlinesPhone: string,
  lead: Lead,
  locationName: string,
  ownerName: string | null
): Promise<string> {
  const leadName = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unknown";
  const ownerLabel = ownerName ?? "another agent";

  const body = `FYI — ${leadName} just submitted a new form for ${locationName}.\nAlready owned by ${ownerLabel}; they've been notified.`;

  const message = await getTwilioClient().messages.create({
    to: frontlinesPhone,
    from: getTwilioPhoneNumber(),
    body,
  });

  logger.info("Owned-by notification SMS sent", {
    to: frontlinesPhone,
    messageSid: message.sid,
    leadId: lead.id,
  });

  return message.sid;
}

export async function sendExistingOwnerNotification(
  agentPhone: string,
  lead: Lead,
  locationName: string
): Promise<string> {
  const details = buildLeadDetailsBlock(lead, locationName);

  const body = [
    `Heads up! One of your existing clients just filled out a form submission for ${locationName}. See below:`,
    "",
    details,
  ].join("\n");

  const message = await getTwilioClient().messages.create({
    to: agentPhone,
    from: getTwilioPhoneNumber(),
    body,
  });

  logger.info("Existing owner notification SMS sent", {
    to: agentPhone,
    messageSid: message.sid,
    leadId: lead.id,
  });

  return message.sid;
}

export async function sendFollowUp(agentPhone: string): Promise<string> {
  const message = await getTwilioClient().messages.create({
    to: agentPhone,
    from: getTwilioPhoneNumber(),
    body: "Following up!",
  });

  logger.info("Follow-up SMS sent", { to: agentPhone, messageSid: message.sid });
  return message.sid;
}

export async function sendAcceptAck(
  agentPhone: string,
  leadFirstName: string,
  leadLastName: string
): Promise<string> {
  const message = await getTwilioClient().messages.create({
    to: agentPhone,
    from: getTwilioPhoneNumber(),
    body: `You've accepted the lead for ${leadFirstName} ${leadLastName}. It's all yours!`,
  });

  logger.info("Accept ack SMS sent", { to: agentPhone, messageSid: message.sid });
  return message.sid;
}

export async function sendDeclineAck(agentPhone: string): Promise<string> {
  const message = await getTwilioClient().messages.create({
    to: agentPhone,
    from: getTwilioPhoneNumber(),
    body: "No worries! We'll catch you on the next one.",
  });

  logger.info("Decline ack SMS sent", { to: agentPhone, messageSid: message.sid });
  return message.sid;
}

export async function sendMovedOn(agentPhone: string): Promise<string> {
  const message = await getTwilioClient().messages.create({
    to: agentPhone,
    from: getTwilioPhoneNumber(),
    body: "We've moved on to another agent. We'll catch you on the next one!",
  });

  logger.info("Moved-on SMS sent", { to: agentPhone, messageSid: message.sid });
  return message.sid;
}

export async function sendRoutingStoppedByAdmin(agentPhone: string): Promise<string> {
  const message = await getTwilioClient().messages.create({
    to: agentPhone,
    from: getTwilioPhoneNumber(),
    body: "Looks like the frontlines team stopped this lead and is handling it themselves (likely bad data). Please disregard.",
  });

  logger.info("Routing-stopped SMS sent", { to: agentPhone, messageSid: message.sid });
  return message.sid;
}

export async function sendAcceptedNotification(
  frontlinesPhone: string,
  agentName: string,
  leadFirstName: string,
  leadLastName: string
): Promise<string> {
  const message = await getTwilioClient().messages.create({
    to: frontlinesPhone,
    from: getTwilioPhoneNumber(),
    body: `${agentName} accepted the lead for ${leadFirstName} ${leadLastName}.`,
  });

  logger.info("Accepted notification sent to frontlines", {
    to: frontlinesPhone,
    messageSid: message.sid,
    agentName,
  });

  return message.sid;
}

export async function sendManualFallbackNotification(
  frontlinesPhone: string,
  leadFirstName: string,
  leadLastName: string
): Promise<string> {
  const message = await getTwilioClient().messages.create({
    to: frontlinesPhone,
    from: getTwilioPhoneNumber(),
    body: `No agent accepted the lead for ${leadFirstName} ${leadLastName}. Manual routing needed.`,
  });

  logger.info("Manual fallback notification sent to frontlines", {
    to: frontlinesPhone,
    messageSid: message.sid,
  });

  return message.sid;
}

export async function sendFrontlinesLeadDetails(
  frontlinesPhone: string,
  lead: Lead,
  locationName: string
): Promise<string> {
  const details = buildLeadDetailsBlock(lead, locationName);

  const body = [
    `Here are the details for a form submission that needs manual routing (${locationName}):`,
    "",
    details,
  ].join("\n");

  const message = await getTwilioClient().messages.create({
    to: frontlinesPhone,
    from: getTwilioPhoneNumber(),
    body,
  });

  logger.info("Frontlines lead details SMS sent", {
    to: frontlinesPhone,
    messageSid: message.sid,
    leadId: lead.id,
  });

  return message.sid;
}

export async function sendHandoffNotification(
  agentPhone: string,
  agentFirstName: string,
  leadName: string,
  locationName: string | null
): Promise<string> {
  const locationSuffix = locationName ? ` (${leadName} — ${locationName})` : ` (${leadName})`;

  const message = await getTwilioClient().messages.create({
    to: agentPhone,
    from: getTwilioPhoneNumber(),
    body: `Hey ${agentFirstName}, hot lead in your inbox!${locationSuffix}`,
  });

  logger.info("Handoff notification SMS sent", {
    to: agentPhone,
    messageSid: message.sid,
    agentFirstName,
    leadName,
  });

  return message.sid;
}

export async function sendUnclearResponseNotification(
  frontlinesPhone: string,
  agentName: string,
  responseText: string,
  leadFirstName: string,
  leadLastName: string
): Promise<string> {
  const message = await getTwilioClient().messages.create({
    to: frontlinesPhone,
    from: getTwilioPhoneNumber(),
    body: `${agentName} replied with an unclear response to the lead for ${leadFirstName} ${leadLastName}: "${responseText}". Please follow up manually.`,
  });

  logger.info("Unclear response notification sent to frontlines", {
    to: frontlinesPhone,
    messageSid: message.sid,
    agentName,
    responseText,
  });

  return message.sid;
}
