/**
 * Escaping helpers for untrusted values that originate from scanned
 * configuration files. Generated Markdown must never let a service name,
 * domain or warning message inject HTML, break a table or escape a code span.
 */

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape text that is rendered as normal Markdown prose. */
export function text(value: string): string {
  return value
    .replace(/[&<>"']/g, (character) => HTML_ENTITIES[character] ?? character)
    .replace(/\\/g, "\\\\")
    .replace(/([*_[\]`])/g, "\\$1")
    .replace(/\r?\n/g, " ");
}

/** Escape text used as a table cell. Pipes are escaped for GFM tables. */
export function cell(value: string): string {
  return text(value).replace(/\|/g, "\\|");
}

/**
 * Render an untrusted value as an inline code span. The delimiter is chosen so
 * that embedded backticks cannot terminate the span early.
 */
export function code(value: string): string {
  const singleLine = value.replace(/\r?\n/g, " ");
  const runs = singleLine.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(Math.max(1, longest + 1));
  const needsPadding = singleLine.startsWith("`") || singleLine.endsWith("`");
  const content = needsPadding ? ` ${singleLine} ` : singleLine;
  return `${fence}${content}${fence}`;
}

/** Table cell containing a code span, with pipes escaped for GFM tables. */
export function codeCell(value: string): string {
  return code(value.replace(/\|/g, "\\|"));
}

/** Escape a Mermaid quoted label. HTML entities are intentional. */
export function mermaidLabel(value: string): string {
  return value
    .replace(/[&<>"']/g, (character) => HTML_ENTITIES[character] ?? character)
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sourceLabel(source: { file: string; line?: number } | undefined): string {
  if (!source) return "unknown";
  return source.line === undefined ? source.file : `${source.file}:${source.line}`;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
