import { z } from "zod";

/**
 * Parses the raw Salesforce Analytics API response for the
 * "Close Rate (Trailing 12 Months)" report.
 *
 * Report structure:
 *   groupingsDown.groupings[] → agent name (label) + SF user ID (value)
 *   factMap["<key>!T"].aggregates → [closes, closeRate%, totalLeads]
 *
 * The FORMULA1 aggregate (index 1) contains the close rate as a percentage.
 */

const groupingSchema = z.object({
  key: z.union([z.string(), z.number()]).transform(String),
  label: z.string(),
  value: z.string(), // Salesforce User ID (005...)
});

const aggregateSchema = z.object({
  label: z.union([z.string(), z.number()]),
  value: z.number(),
});

const factMapEntrySchema = z.object({
  aggregates: z.array(aggregateSchema),
});

const salesforceReportSchema = z.object({
  groupingsDown: z.object({
    groupings: z.array(groupingSchema),
  }),
  factMap: z.record(z.string(), factMapEntrySchema),
});

export interface ParsedAgentCloseRate {
  salesforce_user_id: string;
  name: string;
  close_rate_trailing_12m: number; // decimal 0-1
}

/**
 * Parses a raw Salesforce Analytics API report response and extracts
 * per-agent close rates.
 *
 * @param reportJson - The raw JSON response from the Salesforce Analytics API
 * @param closeRateAggregateIndex - Index of the close rate aggregate (default: 1, matching FORMULA1)
 */
export function parseCloseRateReport(
  reportJson: unknown,
  closeRateAggregateIndex = 1
): ParsedAgentCloseRate[] {
  const parsed = salesforceReportSchema.parse(reportJson);
  const agents: ParsedAgentCloseRate[] = [];

  for (const grouping of parsed.groupingsDown.groupings) {
    const factMapKey = `${grouping.key}!T`;
    const factEntry = parsed.factMap[factMapKey];

    if (!factEntry) {
      continue; // Skip if no matching fact map entry
    }

    const aggregates = factEntry.aggregates;
    if (aggregates.length <= closeRateAggregateIndex) {
      continue; // Skip if close rate aggregate missing
    }

    // Salesforce reports close rate as percentage (e.g. 4.48 for 4.48%)
    // Convert to decimal (0.0448) for storage
    const closeRatePercent = aggregates[closeRateAggregateIndex].value;
    const closeRateDecimal = closeRatePercent / 100;

    agents.push({
      salesforce_user_id: grouping.value,
      name: grouping.label,
      close_rate_trailing_12m: closeRateDecimal,
    });
  }

  return agents;
}
