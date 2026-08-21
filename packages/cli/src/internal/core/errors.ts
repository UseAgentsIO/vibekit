export const FAILURE_CATEGORIES = [
  "invalid_input",
  "permission_denied",
  "authorization_required",
  "policy_blocked",
  "dependency_missing",
  "configuration_invalid",
  "compatibility_error",
  "conflict",
  "resource_busy",
  "unavailable",
  "timed_out",
  "cancelled",
  "verification_failed",
  "external_error",
  "internal_error",
  "cleanup_failed",
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export const FAILURE_CATEGORY_SET: ReadonlySet<string> = new Set(FAILURE_CATEGORIES);

export function isFailureCategory(value: string): value is FailureCategory {
  return FAILURE_CATEGORY_SET.has(value);
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9]{10,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._\-+=/]+\b/gi,
  /(?:api[_-]?key|token|secret|password|passwd|authorization)\s*[:=]\s*\S+/gi,
];

export function redactSecrets(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[redacted]");
  }
  return redacted;
}

export function containsLikelySecret(text: string): boolean {
  return redactSecrets(text) !== text;
}

export interface VibeKitErrorOptions {
  readonly category: FailureCategory;
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export class VibeKitError extends Error {
  readonly category: FailureCategory;
  readonly code: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(options: VibeKitErrorOptions) {
    super(redactSecrets(options.message));
    this.name = "VibeKitError";
    this.category = options.category;
    this.code = options.code;
    if (options.details !== undefined) {
      this.details = redactDetails(options.details);
    }
  }
}

function redactDetails(
  details: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "string") {
      redacted[key] = redactSecrets(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export function isVibeKitError(value: unknown): value is VibeKitError {
  return value instanceof VibeKitError;
}
