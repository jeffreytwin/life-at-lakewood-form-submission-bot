import { describe, it, expect } from "vitest";
import { validateLeadQuality } from "@/lib/shared/validation/lead-quality";
import type { ZapierPayload } from "@/lib/shared/validation/zapier-payload";

function makePayload(overrides: Partial<ZapierPayload> = {}): ZapierPayload {
  return {
    webhook_secret: "secret",
    location: "Life At Lakewood - Lake Nona",
    form_name: "Contact Us",
    is_master_agent_owned: true,
    first_name: "John",
    last_name: "Smith",
    email: "john@gmail.com",
    phone: "407-555-1234",
    ...overrides,
  };
}

describe("validateLeadQuality", () => {
  it("passes a valid lead", () => {
    const result = validateLeadQuality(makePayload());
    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  describe("contact info checks", () => {
    it("rejects when both phone and email are missing", () => {
      const result = validateLeadQuality(
        makePayload({ phone: null, email: null })
      );
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain("no_contact_info");
    });

    it("rejects when both phone and email are empty strings", () => {
      const result = validateLeadQuality(
        makePayload({ phone: "", email: "" })
      );
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain("no_contact_info");
    });

    it("passes with only phone", () => {
      const result = validateLeadQuality(
        makePayload({ email: null })
      );
      expect(result.passed).toBe(true);
    });

    it("passes with only email", () => {
      const result = validateLeadQuality(
        makePayload({ phone: null })
      );
      expect(result.passed).toBe(true);
    });
  });

  describe("name checks", () => {
    it("rejects single-character first name", () => {
      const result = validateLeadQuality(makePayload({ first_name: "A" }));
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain("first_name_too_short");
    });

    it("rejects single-character last name", () => {
      const result = validateLeadQuality(makePayload({ last_name: "B" }));
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain("last_name_too_short");
    });

    it("rejects test names", () => {
      const testNames = ["Test", "test", "FAKE", "asdf", "qwerty", "none", "N/A", "null"];
      for (const name of testNames) {
        const result = validateLeadQuality(makePayload({ first_name: name }));
        expect(result.reasons).toContain("test_name_detected");
      }
    });

    it("does not flag legitimate short names", () => {
      const result = validateLeadQuality(makePayload({ first_name: "Al", last_name: "Li" }));
      expect(result.passed).toBe(true);
    });
  });

  describe("phone checks", () => {
    it("rejects all-zeros phone", () => {
      const result = validateLeadQuality(makePayload({ phone: "000-000-0000" }));
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain("invalid_phone_number");
    });

    it("rejects sequential 1234567890", () => {
      const result = validateLeadQuality(makePayload({ phone: "123-456-7890" }));
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain("invalid_phone_number");
    });

    it("rejects all-nines phone", () => {
      const result = validateLeadQuality(makePayload({ phone: "(999) 999-9999" }));
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain("invalid_phone_number");
    });

    it("rejects too-short phone numbers", () => {
      const result = validateLeadQuality(makePayload({ phone: "12345" }));
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain("phone_wrong_length");
    });

    it("accepts valid US phone with country code", () => {
      const result = validateLeadQuality(makePayload({ phone: "+1 (407) 555-1234" }));
      expect(result.passed).toBe(true);
    });
  });

  describe("email checks", () => {
    it("rejects disposable email domains", () => {
      const result = validateLeadQuality(makePayload({ email: "foo@mailinator.com" }));
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain("disposable_email");
    });

    it("rejects test@example.com", () => {
      const result = validateLeadQuality(makePayload({ email: "test@example.com" }));
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain("test_email_detected");
    });

    it("rejects emails starting with fake@", () => {
      const result = validateLeadQuality(makePayload({ email: "fake@gmail.com" }));
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain("test_email_detected");
    });

    it("accepts normal emails", () => {
      const result = validateLeadQuality(makePayload({ email: "jane.doe@outlook.com" }));
      expect(result.passed).toBe(true);
    });
  });

  describe("multiple failures", () => {
    it("reports all failing checks at once", () => {
      const result = validateLeadQuality(
        makePayload({
          first_name: "Test",
          last_name: "A",
          phone: "000-000-0000",
          email: "test@example.com",
        })
      );
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain("last_name_too_short");
      expect(result.reasons).toContain("test_name_detected");
      expect(result.reasons).toContain("invalid_phone_number");
      expect(result.reasons).toContain("test_email_detected");
    });
  });
});
