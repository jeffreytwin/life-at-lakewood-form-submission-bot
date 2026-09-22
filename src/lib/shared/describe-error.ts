/**
 * What went wrong, in words, whatever was thrown.
 *
 * Supabase throws plain objects — { message, code, details, hint } — and
 * `String(error)` turns every one of them into "[object Object]". A Reset
 * that failed three times running said exactly that and nothing else
 * (Jeff, 2026-09-22), so there was nothing to go on. Pure.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
    return `${error.message}${cause}`;
  }
  if (error && typeof error === "object") {
    const it = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const said = [
      typeof it.message === "string" ? it.message : null,
      typeof it.details === "string" && it.details ? it.details : null,
      typeof it.hint === "string" && it.hint ? it.hint : null,
    ].filter(Boolean);
    if (said.length) {
      const code = typeof it.code === "string" && it.code ? ` (${it.code})` : "";
      return `${said.join(" — ")}${code}`;
    }
    try {
      return JSON.stringify(error).slice(0, 500);
    } catch {
      return "an error that will not describe itself";
    }
  }
  return String(error);
}
