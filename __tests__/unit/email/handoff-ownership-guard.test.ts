import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EmailAccount } from "@/lib/supabase/types";
import type { MatchedContact } from "@/lib/gmail/sync-inbox";

/** Draft rows handed to supabase.insert, so the test can inspect what was persisted. */
const insertedDrafts: Record<string, unknown>[] = [];

vi.mock("@/lib/supabase/client", () => {
  const chain = (table: string) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "ilike", "update", "upsert", "in"]) {
      c[m] = vi.fn(() => c);
    }
    c.insert = vi.fn((row: Record<string, unknown>) => {
      if (table === "email_drafts") insertedDrafts.push(row);
      return c;
    });
    // Serves the draft insert, the candidate's email/gender lookup, and the
    // location name in one shape.
    c.single = vi.fn(async () => ({
      data: {
        id: "draft-1",
        email: "chris@lifeatlakewood.com",
        gender: null,
        name: "Life At Lakewood",
      },
      error: null,
    }));
    c.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    // The conversation-thread query awaits the builder directly.
    c.then = (resolve: (v: unknown) => unknown) =>
      resolve({
        data:
          table === "email_messages"
            ? [
                {
                  direction: "inbound",
                  from_email: "peter@example.com",
                  body_text: "Can someone show me the Talise floor plan?",
                  received_at: "2026-08-16T00:00:00Z",
                },
              ]
            : table === "agents"
              ? [
                  {
                    id: "agent-chris",
                    name: "Chris Kern",
                    email: "chris@lifeatlakewood.com",
                    gender: null,
                  },
                ]
              : [],
        error: null,
      });
    return c;
  };
  return { supabase: { from: vi.fn((t: string) => chain(t)) } };
});

vi.mock("@/lib/ai/draft-generator", () => ({
  generateDraft: vi.fn().mockResolvedValue({
    bodyText: "Happy to help with the Talise!",
    modelUsed: "test-model",
    promptTokens: 1,
    completionTokens: 1,
  }),
}));
vi.mock("@/lib/ai/handoff-reconciler", () => ({
  detectHandoffIntent: vi.fn().mockReturnValue(true),
  findNamedAgent: vi.fn().mockReturnValue(null),
  rewriteHandoffBody: vi.fn().mockResolvedValue("Connecting you with Chris Kern."),
}));
vi.mock("@/lib/routing/select-handoff-agent", () => ({
  selectHandoffAgent: vi.fn().mockResolvedValue({
    agentId: "agent-chris",
    agentName: "Chris Kern",
  }),
}));
vi.mock("@/lib/gmail/client", () => ({
  getMessage: vi.fn(),
  getHeader: vi.fn(),
  extractBodyText: vi.fn(),
  extractBodyHtml: vi.fn(),
  listMessages: vi.fn(),
  listHistory: vi.fn(),
  getProfile: vi.fn(),
}));
vi.mock("@/lib/twilio/client", () => ({
  getTwilioClient: vi.fn(),
  getTwilioPhoneNumber: vi.fn(),
}));

import { generateAndStoreDraft } from "@/lib/gmail/sync-inbox";
import { selectHandoffAgent } from "@/lib/routing/select-handoff-agent";

const account = {
  id: "acct-1",
  email_address: "info@lifeatlakewood.com",
  location_id: null,
} as unknown as EmailAccount;

function contact(overrides: Partial<MatchedContact> = {}): MatchedContact {
  return {
    id: "c-1",
    salesforce_id: "00Q1",
    email: "peter@example.com",
    first_name: "Peter",
    last_name: "Matlosz",
    phone: null,
    budget: null,
    timeline: null,
    property_interest: null,
    lead_status: null,
    location_name: "Life At Lakewood",
    salesforce_owner_id: null,
    salesforce_owner_name: null,
    previous_agent_offboarded: null,
    is_master_agent_owned: true,
    ...overrides,
  } as MatchedContact;
}

async function draftFor(c: MatchedContact) {
  await generateAndStoreDraft(account, "thread-1", "Talise", null, c);
  return insertedDrafts.at(-1);
}

beforeEach(() => {
  vi.clearAllMocks();
  insertedDrafts.length = 0;
});

describe("draft generation — handoffs on a lead that already has an owner", () => {
  it("offers no handoff candidate when Salesforce names an owner", async () => {
    // Without a candidate the prompt gets no "Available Agent for Handoff"
    // section, so the model is never invited to introduce anyone.
    await draftFor(
      contact({ salesforce_owner_name: "Chris Kern", is_master_agent_owned: false })
    );

    expect(selectHandoffAgent).not.toHaveBeenCalled();
  });

  it("offers no handoff candidate when the owner was offboarded", async () => {
    await draftFor(contact({ previous_agent_offboarded: "Kathryn W. Plosica" }));

    expect(selectHandoffAgent).not.toHaveBeenCalled();
  });

  it("persists no CC or handoff id for an owned lead", async () => {
    // agent_handoff_id is what makes sending the reply rewrite the
    // Salesforce owner, so nothing may be stored on an owned lead.
    const row = await draftFor(
      contact({ salesforce_owner_name: "Chris Kern", is_master_agent_owned: false })
    );

    expect(row?.cc_emails).toEqual([]);
    expect(row?.agent_handoff_id).toBeNull();
  });

  it("refuses an explicitly passed handoff agent on an owned lead", async () => {
    // The handoffAgent argument skips candidate selection entirely, so the
    // guard has to hold at the point of writing too.
    await generateAndStoreDraft(
      account,
      "thread-1",
      "Talise",
      null,
      contact({ salesforce_owner_name: "Chris Kern", is_master_agent_owned: false }),
      {
        agentId: "agent-someone-else",
        agentName: "Someone Else",
        agentEmail: "someone@lifeatlakewood.com",
        agentGender: null,
      }
    );

    const row = insertedDrafts.at(-1);
    expect(row?.cc_emails).toEqual([]);
    expect(row?.agent_handoff_id).toBeNull();
  });

  it("still selects a candidate for a genuinely unowned lead", async () => {
    await draftFor(contact());

    expect(selectHandoffAgent).toHaveBeenCalled();
  });
});
