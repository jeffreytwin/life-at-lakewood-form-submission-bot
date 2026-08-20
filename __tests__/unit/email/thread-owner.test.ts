import { describe, it, expect } from "vitest";
import { threadOwnerName } from "@/lib/email/thread-owner";

describe("threadOwnerName", () => {
  it("names a non-frontlines Salesforce owner", () => {
    expect(
      threadOwnerName({
        salesforce_owner_name: "Chris Kern",
        is_master_agent_owned: false,
      })
    ).toBe("Chris Kern");
  });

  it("treats a frontlines-owned lead as unowned", () => {
    // Frontlines is the pool, not an agent holding the relationship.
    expect(
      threadOwnerName({
        salesforce_owner_name: "Frontlines",
        is_master_agent_owned: true,
      })
    ).toBeNull();
  });

  it("names the former agent when the offboarding marker is set", () => {
    // Offboarding moves the lead onto the frontlines account, so ownership
    // alone reads as unowned — the marker is the only thing left saying
    // the relationship was someone's.
    expect(
      threadOwnerName({
        salesforce_owner_name: "Frontlines",
        is_master_agent_owned: true,
        previous_agent_offboarded: "Kathryn W. Plosica",
      })
    ).toBe("Kathryn W. Plosica");
  });

  it("prefers the offboarded agent over a stale owner name", () => {
    expect(
      threadOwnerName({
        salesforce_owner_name: "Chris Kern",
        is_master_agent_owned: false,
        previous_agent_offboarded: "Kathryn W. Plosica",
      })
    ).toBe("Kathryn W. Plosica");
  });

  it("treats a blank marker as absent", () => {
    expect(
      threadOwnerName({
        salesforce_owner_name: null,
        is_master_agent_owned: true,
        previous_agent_offboarded: "",
      })
    ).toBeNull();
  });

  it("ignores an owner name when Salesforce says frontlines holds it", () => {
    // is_master_agent_owned is the deciding half of that pair; a name alone
    // is just whoever the record happens to point at.
    expect(
      threadOwnerName({
        salesforce_owner_name: "Chris Kern",
        is_master_agent_owned: true,
      })
    ).toBeNull();
  });

  it("returns null when nothing is known", () => {
    expect(threadOwnerName({})).toBeNull();
  });
});
