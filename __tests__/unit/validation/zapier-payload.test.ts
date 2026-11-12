import { describe, it, expect } from "vitest";
import { zapierPayloadSchema } from "@/lib/shared/validation/zapier-payload";

const base = {
  webhook_secret: "s",
  location: "Life At Lakewood",
  form_name: "Contact Form (Realtor)",
  first_name: "Tester",
  last_name: "Testmanson",
};

describe("zapierPayloadSchema buy_build_or_sell", () => {
  it("keeps the ticked interests as sent", () => {
    const parsed = zapierPayloadSchema.parse({ ...base, buy_build_or_sell: "Buy, Sell" });
    expect(parsed.buy_build_or_sell).toBe("Buy, Sell");
  });

  it("folds a blank field down to null", () => {
    const parsed = zapierPayloadSchema.parse({ ...base, buy_build_or_sell: "  " });
    expect(parsed.buy_build_or_sell).toBeNull();
  });

  it("is optional for forms that don't send it", () => {
    const parsed = zapierPayloadSchema.parse(base);
    expect(parsed.buy_build_or_sell).toBeUndefined();
  });
});
