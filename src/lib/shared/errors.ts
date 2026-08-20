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
