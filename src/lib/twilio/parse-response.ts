export type ResponseClassification = "affirmative" | "negative" | "unclear";

const AFFIRMATIVE_PATTERNS = [
  /^y(es|eah|ep|up)?$/i,
  /^(got it|on it|sure|absolutely|of course|okay|ok|k|yea|ya|yah)$/i,
  /^(10-4|roger|copy|will do|i('ll| will) (take|accept|handle|grab) (it|this|that|them))$/i,
  /^(sounds good|let'?s go|i'm on it|mine|send it|i got it)$/i,
  /^👍$/,
  /^✅$/,
  /^🤙$/,
];

const NEGATIVE_PATTERNS = [
  /^n(o|ah|ope)?$/i,
  /^(pass|can'?t|busy|sorry|not right now|skip|decline|unavailable)$/i,
  /^(i('m| am) busy|can'?t (take|do|handle) (it|this|that|them))$/i,
  /^(sorry.*(can'?t|busy|unavailable|not available))$/i,
  /^(not (available|able|now)|no thanks|pass on this)$/i,
  /^👎$/,
  /^❌$/,
];

export function classifyResponse(text: string): ResponseClassification {
  const trimmed = text.trim();

  // Check affirmative patterns
  for (const pattern of AFFIRMATIVE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return "affirmative";
    }
  }

  // Check negative patterns
  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return "negative";
    }
  }

  return "unclear";
}
