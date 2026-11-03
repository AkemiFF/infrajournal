import { DIAGNOSTICS } from "../diagnostics/warnings.js";
import {
  type CaddyParseResult,
  type CaddyRouteDraft,
  type CaddySiteDraft,
  issue,
  type ParserIssue,
} from "./types.js";

interface Token {
  value: string;
  line: number;
  column: number;
  type: "word" | "{" | "}" | "newline";
}

function isBlockBrace(text: string, index: number): boolean {
  const next = text[index + 1];
  return next === undefined || /\s/.test(next) || next === "}";
}

function tokenize(text: string): { tokens: Token[]; issues: ParserIssue[] } {
  const tokens: Token[] = [];
  const issues: ParserIssue[] = [];
  let index = 0;
  let line = 1;
  let column = 1;

  const advance = (count = 1) => {
    for (let i = 0; i < count; i += 1) {
      if (text[index] === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      index += 1;
    }
  };

  while (index < text.length) {
    const char = text[index];
    if (char === undefined) break;
    if (char === "\n") {
      tokens.push({ value: "\n", line, column, type: "newline" });
      advance();
      continue;
    }
    if (char === " " || char === "\t" || char === "\r") {
      advance();
      continue;
    }
    if (char === "#") {
      while (index < text.length && text[index] !== "\n") advance();
      continue;
    }
    if (char === "{" && isBlockBrace(text, index)) {
      tokens.push({ value: "{", line, column, type: "{" });
      advance();
      continue;
    }
    if (char === "}" && isBlockBrace(text, index)) {
      tokens.push({ value: "}", line, column, type: "}" });
      advance();
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      const startLine = line;
      const startColumn = column;
      let value = "";
      advance();
      let closed = false;
      while (index < text.length) {
        const current = text[index];
        if (current === "\\") {
          advance();
          if (index < text.length) {
            value += text[index];
            advance();
          }
          continue;
        }
        if (current === quote) {
          advance();
          closed = true;
          break;
        }
        value += current;
        advance();
      }
      if (!closed) {
        issues.push(
          issue(DIAGNOSTICS.CADDY_PARSE_ERROR, "Unterminated quoted string.", {
            line: startLine,
            column: startColumn,
          }),
        );
      }
      tokens.push({ value, line: startLine, column: startColumn, type: "word" });
      continue;
    }

    const startLine = line;
    const startColumn = column;
    let value = "";
    let placeholderDepth = 0;
    while (index < text.length) {
      const current = text[index];
      if (
        current === undefined ||
        current === " " ||
        current === "\t" ||
        current === "\r" ||
        current === "\n"
      ) {
        break;
      }
      if (current === "{") {
        if (placeholderDepth === 0 && isBlockBrace(text, index)) break;
        placeholderDepth += 1;
        value += current;
        advance();
        continue;
      }
      if (current === "}") {
        if (placeholderDepth > 0) {
          placeholderDepth -= 1;
          value += current;
          advance();
          continue;
        }
        if (isBlockBrace(text, index)) break;
      }
      value += current;
      advance();
    }
    if (value) tokens.push({ value, line: startLine, column: startColumn, type: "word" });
  }

  return { tokens, issues };
}

interface Directive {
  name: string;
  args: string[];
  block?: Directive[];
  line: number;
  column: number;
}

function parseBlock(
  tokens: Token[],
  start: number,
  issues: ParserIssue[],
): { directives: Directive[]; next: number; closed: boolean } {
  const directives: Directive[] = [];
  let index = start;
  while (index < tokens.length) {
    while (tokens[index]?.type === "newline") index += 1;
    const token = tokens[index];
    if (!token) break;
    if (token.type === "}") return { directives, next: index + 1, closed: true };
    if (token.type === "{") {
      issues.push(
        issue(DIAGNOSTICS.CADDY_PARSE_ERROR, "Unexpected opening brace.", {
          line: token.line,
          column: token.column,
        }),
      );
      index += 1;
      continue;
    }
    if (token.type !== "word") {
      index += 1;
      continue;
    }

    const directive: Directive = {
      name: token.value,
      args: [],
      line: token.line,
      column: token.column,
    };
    index += 1;
    while (index < tokens.length) {
      const current = tokens[index];
      if (!current || current.type === "newline" || current.type === "}") break;
      if (current.type === "{") {
        const parsed = parseBlock(tokens, index + 1, issues);
        directive.block = parsed.directives;
        index = parsed.next;
        if (!parsed.closed) {
          issues.push(
            issue(DIAGNOSTICS.CADDY_PARSE_ERROR, `Block for "${directive.name}" is not closed.`, {
              line: directive.line,
              column: directive.column,
            }),
          );
        }
        break;
      }
      directive.args.push(current.value);
      index += 1;
    }
    directives.push(directive);
    while (tokens[index]?.type === "newline") index += 1;
    if (tokens[index]?.type === "}") return { directives, next: index + 1, closed: true };
  }
  return { directives, next: index, closed: false };
}

function normalizeTarget(raw: string, line: number, issues: ParserIssue[]): string | undefined {
  if (raw.includes("$") || raw.includes("{")) {
    issues.push(
      issue(
        DIAGNOSTICS.PROXY_VARIABLE_UNRESOLVED,
        "Caddy reverse_proxy target contains a placeholder and was not resolved.",
        { line, suggestion: "Use a literal upstream target to make routing analyzable." },
      ),
    );
    return undefined;
  }
  if (raw.startsWith("unix/") || raw.startsWith("unix//")) {
    issues.push(
      issue(DIAGNOSTICS.UNSUPPORTED_PROXY_TARGET, "Caddy Unix socket upstreams are not modeled.", {
        line,
      }),
    );
    return undefined;
  }
  const withoutScheme = raw.replace(/^(https?|grpc|grpcs|h2c):\/\//i, "");
  const withoutPath = withoutScheme.split("/", 1)[0] ?? "";
  if (withoutPath.includes("@")) {
    issues.push(
      issue(
        DIAGNOSTICS.UNSUPPORTED_PROXY_TARGET,
        "Caddy upstream contains URL credentials and was ignored.",
        { line },
      ),
    );
    return undefined;
  }
  if (!withoutPath) {
    issues.push(
      issue(DIAGNOSTICS.UNSUPPORTED_PROXY_TARGET, `Caddy upstream "${raw}" is not analyzable.`, {
        line,
      }),
    );
    return undefined;
  }
  return withoutPath;
}

function isMatcherToken(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("@") ||
    value === "*" ||
    value === "path" ||
    value === "method" ||
    value === "header" ||
    value === "query" ||
    value === "expression" ||
    value === "not" ||
    value === "remote_ip" ||
    value === "client_ip" ||
    value === "protocol"
  );
}

function collectRoutes(
  directives: Directive[],
  inheritedPath: string | undefined,
  routes: CaddyRouteDraft[],
  issues: ParserIssue[],
): void {
  for (const directive of directives) {
    if (directive.name === "import") {
      issues.push(
        issue(
          DIAGNOSTICS.INCLUDE_NOT_FOLLOWED,
          `Caddy import was not followed: ${directive.args[0] ?? "(unknown)"}`,
          {
            line: directive.line,
            column: directive.column,
            suggestion: "Include the imported file explicitly in scan.include.",
          },
        ),
      );
    }

    if (directive.name === "reverse_proxy") {
      const matcher = directive.args.find(isMatcherToken);
      const path = matcher && matcher.startsWith("/") ? matcher : inheritedPath;
      let targets = directive.args.filter((arg) => !isMatcherToken(arg));
      if (directive.block) {
        const toDirectives = directive.block.filter((child) => child.name === "to");
        const toTargets = toDirectives.flatMap((child) => child.args);
        if (toTargets.length > 0) targets = toTargets;
      }
      if (targets.length === 0) {
        issues.push(
          issue(
            DIAGNOSTICS.UNSUPPORTED_PROXY_TARGET,
            "Caddy reverse_proxy has no analyzable target.",
            {
              line: directive.line,
              column: directive.column,
            },
          ),
        );
      }
      for (const target of targets) {
        const normalized = normalizeTarget(target, directive.line, issues);
        if (normalized) {
          routes.push({
            ...(path ? { path } : {}),
            upstream: normalized,
            line: directive.line,
          });
        }
      }
    }

    if (directive.block) {
      let nextPath = inheritedPath;
      if (directive.name === "handle_path" || directive.name === "handle") {
        const matcher = directive.args.find((arg) => arg.startsWith("/"));
        if (matcher) nextPath = matcher;
      }
      collectRoutes(directive.block, nextPath, routes, issues);
    }
  }
}

function splitAddresses(rawAddresses: string[]): string[] {
  return rawAddresses
    .flatMap((address) => address.split(","))
    .map((address) => address.trim())
    .filter((address) => address.length > 0);
}

function addressInfo(
  address: string,
  line: number,
  issues: ParserIssue[],
): { host: string; tls: boolean } | undefined {
  if (address.includes("$") || address.includes("{")) {
    issues.push(
      issue(
        DIAGNOSTICS.UNRESOLVED_INTERPOLATION,
        "Caddy site address contains a placeholder and was skipped.",
        { line },
      ),
    );
    return undefined;
  }
  const schemeMatch = /^(https?):\/\//i.exec(address);
  const scheme = schemeMatch?.[1]?.toLowerCase();
  let rest = scheme ? address.slice(schemeMatch?.[0].length ?? 0) : address;
  rest = rest.replace(/\/.*$/, "");
  const host = rest.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (!host || host === ":") {
    issues.push(
      issue(DIAGNOSTICS.CADDY_SITE_WITHOUT_HOST, `Caddy site address "${address}" has no host.`, {
        line,
        suggestion: "Use a hostname such as example.com; port-only sites cannot be documented.",
      }),
    );
    return undefined;
  }
  return { host: host.toLowerCase(), tls: scheme === "http" ? false : true };
}

export function parseCaddy(text: string): CaddyParseResult {
  const { tokens, issues } = tokenize(text);
  const sites: CaddySiteDraft[] = [];
  let index = 0;
  let guards = 0;

  while (index < tokens.length && guards < 100_000) {
    guards += 1;
    while (tokens[index]?.type === "newline") index += 1;
    const token = tokens[index];
    if (!token) break;

    if (token.type === "{") {
      const parsed = parseBlock(tokens, index + 1, issues);
      index = parsed.next;
      if (!parsed.closed) {
        issues.push(
          issue(DIAGNOSTICS.CADDY_PARSE_ERROR, "Global options block is not closed.", {
            line: token.line,
            column: token.column,
          }),
        );
      }
      continue;
    }
    if (token.type === "}") {
      issues.push(
        issue(DIAGNOSTICS.CADDY_PARSE_ERROR, "Unexpected closing brace.", {
          line: token.line,
          column: token.column,
        }),
      );
      index += 1;
      continue;
    }

    const addressTokens: Token[] = [];
    while (index < tokens.length) {
      const current = tokens[index];
      if (!current || current.type === "newline" || current.type === "{") break;
      if (current.type === "}") break;
      addressTokens.push(current);
      index += 1;
    }
    while (tokens[index]?.type === "newline") index += 1;
    if (tokens[index]?.type !== "{") {
      const first = addressTokens[0];
      issues.push(
        issue(DIAGNOSTICS.CADDY_PARSE_ERROR, "Expected a site block starting with '{'.", {
          ...(first ? { line: first.line, column: first.column } : {}),
        }),
      );
      while (index < tokens.length && tokens[index]?.type !== "newline") index += 1;
      continue;
    }
    const opening = tokens[index];
    if (!opening) break;
    index += 1;
    const parsed = parseBlock(tokens, index, issues);
    index = parsed.next;
    if (!parsed.closed) {
      issues.push(
        issue(DIAGNOSTICS.CADDY_PARSE_ERROR, "Site block is not closed.", {
          line: opening.line,
          column: opening.column,
        }),
      );
    }

    const routes: CaddyRouteDraft[] = [];
    collectRoutes(parsed.directives, undefined, routes, issues);
    const tlsDirective = parsed.directives.some((directive) => directive.name === "tls");
    const dedupedRoutes = new Map<string, CaddyRouteDraft>();
    for (const route of routes) {
      dedupedRoutes.set(`${route.path ?? ""}\u0000${route.upstream}`, route);
    }

    const addresses = splitAddresses(addressTokens.map((item) => item.value));
    for (const address of addresses) {
      const info = addressInfo(address, addressTokens[0]?.line ?? opening.line, issues);
      if (!info) continue;
      sites.push({
        addresses: [info.host],
        tls: info.tls || tlsDirective,
        routes: [...dedupedRoutes.values()].sort(
          (a, b) =>
            (a.path ?? "").localeCompare(b.path ?? "") || a.upstream.localeCompare(b.upstream),
        ),
        line: addressTokens[0]?.line ?? opening.line,
      });
    }
  }

  return { sites, issues };
}
