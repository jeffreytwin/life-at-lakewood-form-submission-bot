// Whether a text speaks as the plan's owner. Its own file, with no IO, so
// the diff rules (diff.ts) can ask it too.

/** First-person ownership words, as whole words. "US" the country is not one of them. */
const OWNER_WORDS = /\b(we|we're|we've|we'll|we'd|our|ours|ourselves|us)\b/gi;

/** Whether a description speaks as the plan's owner: "we", "our", "us" and their contractions. */
export function speaksAsOwner(text: string | null | undefined): boolean {
  if (!text) return false;
  return [...text.matchAll(OWNER_WORDS)].some((m) => m[0] !== "US");
}
