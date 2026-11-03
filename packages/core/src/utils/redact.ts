const SENSITIVE_KEY_PATTERN =
  /(password|passwd|pwd|secret|token|api[_-]?key|apikey|authorization|private[_-]?key|access[_-]?key|client[_-]?secret)(\s*[:=]\s*)(["']?)([^\s"',;]+)/gi;

const REDACTIONS: Array<[RegExp, string]> = [
  [
    /(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g,
    "$1[REDACTED]$2",
  ],
  [/AKIA[0-9A-Z]{16}/g, "[REDACTED_AWS_KEY]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED_SLACK_TOKEN]"],
  [/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]"],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, "$1$2:[REDACTED]@"],
];

/**
 * Best-effort redaction for diagnostics and CLI error messages. This is not a
 * complete secret detector: InfraJournal avoids collecting raw values in the
 * first place, and this helper only reduces accidental exposure.
 */
export function redactSensitiveText(value: string): string {
  let result = value;
  for (const [pattern, replacement] of REDACTIONS) {
    result = result.replace(pattern, replacement);
  }
  result = result.replace(SENSITIVE_KEY_PATTERN, (_match, key, separator, quote) => {
    return `${key}${separator}${quote}[REDACTED]`;
  });
  return result;
}

export function isSensitiveEnvironmentKey(key: string): boolean {
  return /(password|passwd|pwd|secret|token|api[_-]?key|private[_-]?key|access[_-]?key|client[_-]?secret|credential)/i.test(
    key,
  );
}
