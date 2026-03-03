import { describe, it, expect } from "vitest";
import { classifyResponse } from "@/lib/twilio/parse-response";

describe("classifyResponse", () => {
  describe("affirmative responses", () => {
    const affirmatives = [
      "Yes",
      "yes",
      "YES",
      "Yeah",
      "Yep",
      "Yup",
      "Got it",
      "On it",
      "Sure",
      "Absolutely",
      "Of course",
      "Ok",
      "OK",
      "K",
      "Okay",
      "10-4",
      "Roger",
      "Copy",
      "Will do",
      "I'll take it",
      "I will accept it",
      "Sounds good",
      "Let's go",
      "I'm on it",
      "Mine",
      "Send it",
      "I got it",
      "Ya",
      "Yea",
      "Yah",
      "👍",
      "✅",
      "🤙",
    ];

    for (const response of affirmatives) {
      it(`classifies "${response}" as affirmative`, () => {
        expect(classifyResponse(response)).toBe("affirmative");
      });
    }
  });

  describe("negative responses", () => {
    const negatives = [
      "No",
      "no",
      "NO",
      "Nah",
      "Nope",
      "Pass",
      "Can't",
      "Busy",
      "Sorry",
      "Not right now",
      "Skip",
      "Decline",
      "Unavailable",
      "I'm busy",
      "I am busy",
      "Can't take it",
      "Can't do it",
      "Sorry can't",
      "Sorry, busy",
      "Not available",
      "Not able",
      "Not now",
      "No thanks",
      "Pass on this",
      "👎",
      "❌",
    ];

    for (const response of negatives) {
      it(`classifies "${response}" as negative`, () => {
        expect(classifyResponse(response)).toBe("negative");
      });
    }
  });

  describe("unclear responses", () => {
    const unclear = [
      "What's the address?",
      "Tell me more",
      "Maybe",
      "Let me check",
      "I'll think about it",
      "When did they submit?",
      "Is this the one from yesterday?",
      "Hmm",
    ];

    for (const response of unclear) {
      it(`classifies "${response}" as unclear`, () => {
        expect(classifyResponse(response)).toBe("unclear");
      });
    }
  });

  it("trims whitespace before classifying", () => {
    expect(classifyResponse("  Yes  ")).toBe("affirmative");
    expect(classifyResponse("\nNo\n")).toBe("negative");
  });
});
