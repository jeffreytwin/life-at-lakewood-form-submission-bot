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
    const it = error as {
      message?: unknown;
      code?: unknown;
      details?: unknown;
      hint?: unknown;
      status?: unknown;
    };
    const said = [
      typeof it.message === "string" ? it.message : null,
      typeof it.details === "string" && it.details ? it.details : null,
      typeof it.hint === "string" && it.hint ? it.hint : null,
    ].filter(Boolean);
    if (said.length) {
      // "Bad Request" on its own is a gateway's answer, not the
      // database's: the number is the only thing that says so.
      const marks = [
        typeof it.code === "string" && it.code ? it.code : null,
        typeof it.status === "number" ? String(it.status) : null,
      ].filter(Boolean);
      return `${said.join(" — ")}${marks.length ? ` (${marks.join(" ")})` : ""}`;
    }
    try {
      return JSON.stringify(error).slice(0, 500);
    } catch {
      return "an error that will not describe itself";
    }
  }
  return String(error);
}

/** The same, saying which step of a longer piece of work it was. */
export const failedAt = (step: string, error: unknown) => new Error(`${step}: ${describeError(error)}`);
