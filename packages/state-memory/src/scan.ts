const INJECTION_PATTERNS: readonly RegExp[] = [
  /\bignore\s+(all\s+)?(previous|prior|above)\s+instructions\b/i,
  /\bdisregard\s+(all\s+)?(previous|prior|above)\s+instructions\b/i,
  /\bsystem\s+prompt\s+override\b/i,
  /\boverride\s+(the\s+)?system\s+prompt\b/i,
  /\bnew\s+system\s+prompt\b/i,
];

const CREDENTIAL_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /\bsk-[A-Za-z0-9]{8,}\b/, label: "sk- token" },
  { pattern: /\bghp_[A-Za-z0-9]{20,}\b/, label: "GitHub token" },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/, label: "GitHub token" },
  { pattern: /\bAKIA[A-Z0-9]{8,}\b/, label: "AWS access key" },
  { pattern: /(?:api[_-]?key)\s*[:=]\s*\S+/i, label: "api_key assignment" },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, label: "Slack token" },
  { pattern: /\bBearer\s+[A-Za-z0-9._\-+=/]{12,}\b/i, label: "Bearer token" },
];

const SSH_PRIVATE_KEY =
  /-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/;

const INVISIBLE_UNICODE = /[\u0000\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;

export type MemoryScanResult = { ok: true } | { ok: false; error: string };

export function scanMemoryContent(content: string): MemoryScanResult {
  if (typeof content !== "string") {
    return { ok: false, error: "memory content rejected: content must be a string" };
  }
  if (INVISIBLE_UNICODE.test(content)) {
    return {
      ok: false,
      error: "memory content rejected: invisible or bidirectional Unicode",
    };
  }
  if (SSH_PRIVATE_KEY.test(content)) {
    return { ok: false, error: "memory content rejected: SSH private key header" };
  }
  for (const { pattern, label } of CREDENTIAL_PATTERNS) {
    if (pattern.test(content)) {
      return {
        ok: false,
        error: `memory content rejected: credential-looking string (${label})`,
      };
    }
  }
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      return {
        ok: false,
        error: "memory content rejected: prompt-injection pattern",
      };
    }
  }
  return { ok: true };
}

const REDACT_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9]{8,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[A-Z0-9]{8,}\b/g,
  /(?:api[_-]?key|token|secret|password|passwd|authorization)\s*[:=]\s*\S+/gi,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._\-+=/]{12,}\b/gi,
  /-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/g,
];

export function redactSecretLookingValues(text: string): string {
  let redacted = text;
  for (const pattern of REDACT_PATTERNS) {
    redacted = redacted.replace(pattern, "[redacted]");
  }
  return redacted;
}
