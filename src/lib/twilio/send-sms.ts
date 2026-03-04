import { getTwilioClient, getTwilioPhoneNumber } from "./client";
import { logger } from "@/lib/shared/logger";
import type { Lead } from "@/lib/supabase/types";

function buildLeadDetailsBlock(lead: Lead, locationName: string): string {
  const lines: string[] = [
    `Name: ${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim(),
  ];

  if (lead.email) lines.push(`Email: ${lead.email}`);
  if (lead.phone) lines.push(`Phone: ${lead.phone}`);
  if (lead.floor_plan) {
    // Match existing SMS format based on form type
    if (lead.form_name === "Lot Availability") {
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
    if (lead.form_name === "Realtor Connect") {
      lines.push(`Message (if any): Interested in connecting with a Realtor.`);
      lines.push(lead.message);
    } else {
      lines.push(`Message (if any): ${lead.message}`);
    }
  }

  return lines.join("\n");
}

export async function sendLeadNotification(
  agentPhone: string,
  lead: Lead,
  locationName: string
): Promise<string> {
  const details = buildLeadDetailsBlock(lead, locationName);

  const body = [
    `Heads up! You have a new form submission for ${locationName}. See below:`,
    "",
    details,
    "",
    "Reply YES to accept or NO to pass.",
  ].join("\n");

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
  ownerName: string
): Promise<string> {
  const details = buildLeadDetailsBlock(lead, locationName);

  const body = [
    `Heads up! One of ${ownerName}'s clients just submitted a new form for ${locationName}. See below:`,
    "",
    details,
    `Lead Owner: ${ownerName}`,
  ].join("\n");

  const message = await getTwilioClient().messages.create({
    to: frontlinesPhone,
    from: getTwilioPhoneNumber(),
    body,
  });

  logger.info("Owned-by notification SMS sent", {
    to: frontlinesPhone,
    messageSid: message.sid,
    ownerName,
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
