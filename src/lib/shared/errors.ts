export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class WebhookAuthError extends AppError {
  constructor(message = "Invalid webhook authentication") {
    super(message, "WEBHOOK_AUTH_ERROR", 401);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", 400, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, "NOT_FOUND", 404);
  }
}

export class DuplicateError extends AppError {
  constructor(message = "Duplicate request") {
    super(message, "DUPLICATE", 409);
  }
}

export class NoAgentsAvailableError extends AppError {
  constructor() {
    super(
      "No agents available for routing",
      "NO_AGENTS_AVAILABLE",
      500
    );
  }
}

/**
 * True for a Postgres unique-constraint violation surfaced through PostgREST.
 * Used to turn a lost race against a partial unique index into a normal
 * "someone else got there first" outcome rather than a 500.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

/**
 * A readable message for anything that was thrown.
 *
 * Supabase reports a failed query as a plain `{ message, code, details }`
 * object, not an Error, so the usual `error instanceof Error ? error.message :
 * String(error)` prints "[object Object]" and hides what actually went wrong.
 * That is how a Gateway Timeout that stranded a lead mid-escalation showed up
 * in the logs as nothing at all.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  if (typeof error === "object" && error !== null) {
    const { message, code, details } = error as {
      message?: unknown;
      code?: unknown;
      details?: unknown;
    };
    if (typeof message === "string" && message.length > 0) {
      const extras = [code, details].filter(
        (part): part is string => typeof part === "string" && part.length > 0
      );
      return extras.length > 0 ? `${message} (${extras.join("; ")})` : message;
    }
    try {
      return JSON.stringify(error);
    } catch {
      // Circular or otherwise unserializable — fall through to String().
    }
  }

  return String(error);
}
