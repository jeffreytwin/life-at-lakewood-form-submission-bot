import type { ZapierPayload } from "./zapier-payload";

export interface QualityResult {
  passed: boolean;
  reasons: string[];
}

/**
 * Normalize a phone string to digits only (strip formatting).
 * Returns null if no digits found.
 */
function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  // Strip leading "1" country code if 11 digits
  const normalized = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
  return normalized.length > 0 ? normalized : null;
}

/** Known fake/placeholder phone patterns (after normalizing to 10 digits) */
const INVALID_PHONE_PATTERNS = [
  /^0{7,}$/,             // all zeros
  /^1234567890$/,        // sequential
  /^0000000000$/,        // all zeros (10)
  /^1111111111$/,        // all ones
  /^2222222222$/,        // all twos
  /^5551234567$/,        // classic fake
  /^555012\d{4}$/,       // 555-012-xxxx reserved range
  /^9999999999$/,        // all nines
];

/** Known test / disposable email domains */
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "tempmail.com",
  "throwaway.email",
  "yopmail.com",
  "sharklasers.com",
  "grr.la",
  "guerrillamailblock.com",
  "pokemail.net",
  "spam4.me",
  "trashmail.com",
  "fakeinbox.com",
  "tempinbox.com",
  "dispostable.com",
]);

/** Patterns that indicate a test/fake name */
const TEST_NAME_PATTERNS = [
  /^test$/i,
  /^testing$/i,
  /^fake$/i,
  /^asdf+$/i,
  /^qwerty$/i,
  /^xxx+$/i,
  /^aaa+$/i,
  /^zzz+$/i,
  /^none$/i,
  /^n\/?a$/i,
  /^null$/i,
  /^undefined$/i,
  /^unknown$/i,
  /^sample$/i,
  /^demo$/i,
];

/**
 * Validates lead quality before routing.
 * Returns { passed: true } if the lead looks legitimate,
 * or { passed: false, reasons: [...] } with all failing checks.
 */
export function validateLeadQuality(payload: ZapierPayload): QualityResult {
  const reasons: string[] = [];

  // 1. Must have at least one valid contact method
  const hasPhone = Boolean(payload.phone?.trim());
  const hasEmail = Boolean(payload.email?.trim());
  if (!hasPhone && !hasEmail) {
    reasons.push("no_contact_info");
  }

  // 2. Name checks
  const firstName = payload.first_name.trim();
  const lastName = payload.last_name.trim();

  if (firstName.length < 2) {
    reasons.push("first_name_too_short");
  }
  if (lastName.length < 2) {
    reasons.push("last_name_too_short");
  }

  for (const pattern of TEST_NAME_PATTERNS) {
    if (pattern.test(firstName) || pattern.test(lastName)) {
      reasons.push("test_name_detected");
      break;
    }
  }

  // 3. Phone validation (if provided)
  if (hasPhone) {
    const normalized = normalizePhone(payload.phone!);
    if (normalized && normalized.length === 10) {
      for (const pattern of INVALID_PHONE_PATTERNS) {
        if (pattern.test(normalized)) {
          reasons.push("invalid_phone_number");
          break;
        }
      }
    } else if (normalized && (normalized.length < 7 || normalized.length > 15)) {
      reasons.push("phone_wrong_length");
    }
  }

  // 4. Email validation (if provided)
  if (hasEmail) {
    const email = payload.email!.trim().toLowerCase();

    // Check disposable domains
    const domain = email.split("@")[1];
    if (domain && DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
      reasons.push("disposable_email");
    }

    // Check test email patterns
    if (/^test[@+]/.test(email) || email === "test@example.com" || email.startsWith("fake@")) {
      reasons.push("test_email_detected");
    }
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}
