import { DIAGNOSTICS } from "../diagnostics/warnings.js";
import {
  issue,
  type NginxParseResult,
  type NginxRouteDraft,
  type NginxServerDraft,
  type ParserIssue,
} from "./types.js";

interface Token {
  value: string;
  line: number;
  column: number;
  type: "word" | "{" | "}" | ";";
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
    if (char === " " || char === "\t" || char === "\r" || char === "\n") {
      advance();
      continue;
    }
    if (char === "#") {
      while (index < text.length && text[index] !== "\n") advance();
      continue;
    }
    if (char === "{" || char === "}" || char === ";") {
      tokens.push({ value: char, line, column, type: char });
      advance();
      continue;
    }
    if (char === '"' || char === "'") {
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
          issue(DIAGNOSTICS.NGINX_PARSE_ERROR, "Unterminated quoted string.", {
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
    while (index < text.length) {
      const current = text[index];
      if (
        current === undefined ||
        current === " " ||
        current === "\t" ||
        current === "\r" ||
        current === "\n" ||
        current === "{" ||
        current === "}" ||
        current === ";" ||
        current === "#"
      ) {
        break;
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
  args: Token[];
  block?: Directive[];
  line: number;
  column: number;
}

function parseDirectives(
  tokens: Token[],
  issues: ParserIssue[],
): { directives: Directive[]; next: number } {
  let index = 0;

  const parseBlock = (expectBrace: boolean, opening?: Token): Directive[] => {
    const result: Directive[] = [];
    while (index < tokens.length) {
      const token = tokens[index];
      if (!token) break;
      if (token.type === "}") {
        if (expectBrace) {
          index += 1;
          return result;
        }
        issues.push(
          issue(DIAGNOSTICS.NGINX_PARSE_ERROR, "Unexpected closing brace.", {
            line: token.line,
            column: token.column,
          }),
        );
        index += 1;
        continue;
      }
      if (token.type === ";" || token.type === "{") {
        issues.push(
          issue(DIAGNOSTICS.NGINX_PARSE_ERROR, "Unexpected token at start of directive.", {
            line: token.line,
            column: token.column,
          }),
        );
        index += 1;
        continue;
      }

      const name = token.value;
      const args: Token[] = [];
      const directive: Directive = {
        name,
        args,
        line: token.line,
        column: token.column,
      };
      index += 1;
      let terminated = false;
      while (index < tokens.length) {
        const current = tokens[index];
        if (!current) break;
        if (current.type === ";") {
          index += 1;
          terminated = true;
          break;
        }
        if (current.type === "{") {
          index += 1;
          directive.block = parseBlock(true, current);
          terminated = true;
          break;
        }
        if (current.type === "}") {
          break;
        }
        args.push(current);
        index += 1;
      }
      if (!terminated) {
        issues.push(
          issue(
            DIAGNOSTICS.NGINX_PARSE_ERROR,
            `Directive "${name}" is not terminated by ";" or a block.`,
            { line: directive.line, column: directive.column },
          ),
        );
      }
      result.push(directive);
    }
    if (expectBrace) {
      issues.push(
        issue(DIAGNOSTICS.NGINX_PARSE_ERROR, "Block is not closed before end of file.", {
          ...(opening ? { line: opening.line, column: opening.column } : {}),
        }),
      );
    }
    return result;
  };

  const directivesParsed = parseBlock(false);
  return { directives: directivesParsed, next: index };
}

function walk(directives: Directive[], visit: (directive: Directive) => void): void {
  for (const directive of directives) {
    visit(directive);
    if (directive.block) walk(directive.block, visit);
  }
}

function parseProxyTarget(
  rawTarget: string,
  line: number,
  issues: ParserIssue[],
): string | undefined {
  if (rawTarget.includes("$")) {
    issues.push(
      issue(
        DIAGNOSTICS.PROXY_VARIABLE_UNRESOLVED,
        "proxy_pass contains a variable and was not resolved.",
        {
          line,
          suggestion: "Use a literal upstream target to make routing analyzable.",
        },
      ),
    );
    return undefined;
  }
  const match = /^(https?|grpcs?):\/\/([^/]+)/i.exec(rawTarget);
  if (!match) {
    issues.push(
      issue(
        DIAGNOSTICS.UNSUPPORTED_PROXY_TARGET,
        "proxy_pass target is not an HTTP(S)/gRPC URL and was ignored.",
        { line },
      ),
    );
    return undefined;
  }
  if (match[2]?.includes("@")) {
    issues.push(
      issue(
        DIAGNOSTICS.UNSUPPORTED_PROXY_TARGET,
        "proxy_pass target contains URL credentials and was ignored.",
        { line },
      ),
    );
    return undefined;
  }
  return match[2];
}

function parseLocationPath(location: Directive, issues: ParserIssue[]): string | undefined {
  const first = location.args[0]?.value;
  if (!first) return undefined;
  if (first.startsWith("/")) return first;
  if ((first === "=" || first === "^~") && location.args[1]) return location.args[1].value;
  if (first.startsWith("~")) {
    const expression = location.args.map((arg) => arg.value).join(" ");
    issues.push(
      issue(
        DIAGNOSTICS.UNSUPPORTED_DIRECTIVE,
        `Regular-expression location "${expression}" is not evaluated; its proxy route is recorded without a path.`,
        { line: location.line, column: location.column },
      ),
    );
    return undefined;
  }
  return first.startsWith("@") ? undefined : first;
}

export function parseNginx(text: string): NginxParseResult {
  const { tokens, issues } = tokenize(text);
  const { directives } = parseDirectives(tokens, issues);
  const servers: NginxServerDraft[] = [];
  const upstreams = new Map<string, Array<{ target: string; line?: number }>>();
  const allDirectives: Directive[] = [];
  walk(directives, (directive) => allDirectives.push(directive));

  walk(directives, (directive) => {
    if (directive.name === "include") {
      const target = directive.args[0]?.value ?? "(unknown)";
      issues.push(
        issue(DIAGNOSTICS.INCLUDE_NOT_FOLLOWED, `Nginx include was not followed: ${target}`, {
          line: directive.line,
          column: directive.column,
          suggestion: "Include the referenced file explicitly in scan.include.",
        }),
      );
    }
    if (directive.name === "map") {
      issues.push(
        issue(DIAGNOSTICS.UNSUPPORTED_DIRECTIVE, "Nginx map directives are not evaluated.", {
          line: directive.line,
          column: directive.column,
        }),
      );
    }
    if (directive.name === "if") {
      const hasProxy = directive.block
        ? (() => {
            let found = false;
            walk(directive.block ?? [], (child) => {
              if (child.name === "proxy_pass") found = true;
            });
            return found;
          })()
        : false;
      if (hasProxy) {
        issues.push(
          issue(
            DIAGNOSTICS.UNSUPPORTED_DIRECTIVE,
            "Conditional proxy_pass inside an if block is recorded but the condition is not evaluated.",
            { line: directive.line, column: directive.column },
          ),
        );
      }
    }
  });

  for (const directive of allDirectives) {
    if (directive.name !== "upstream" || !directive.block) continue;
    const upstreamName = directive.args[0]?.value;
    if (!upstreamName) {
      issues.push(
        issue(DIAGNOSTICS.NGINX_PARSE_ERROR, "upstream block is missing a name.", {
          line: directive.line,
          column: directive.column,
        }),
      );
      continue;
    }
    const targets: Array<{ target: string; line?: number }> = [];
    for (const child of directive.block ?? []) {
      if (child.name !== "server") continue;
      const target = child.args[0]?.value;
      if (target && !target.startsWith("unix:")) {
        targets.push({ target, line: child.line });
      }
    }
    upstreams.set(upstreamName, targets);
  }

  for (const directive of allDirectives) {
    if (directive.name !== "server" || !directive.block) continue;
    const childDirectives = directive.block;
    const listens: string[] = [];
    const serverNames: string[] = [];
    let tls = false;

    for (const child of childDirectives) {
      if (child.name === "listen") {
        const value = child.args[0]?.value;
        if (value) listens.push(value);
        if (child.args.some((arg) => arg.value === "ssl")) tls = true;
        if (child.args.some((arg) => arg.value === "quic")) tls = true;
      }
      if (child.name === "server_name") {
        for (const arg of child.args) {
          const name = arg.value.toLowerCase();
          if (name === "_" || name === "") continue;
          if (name.startsWith("~")) {
            issues.push(
              issue(
                DIAGNOSTICS.UNSUPPORTED_DIRECTIVE,
                `Regular-expression server_name "${name}" is not evaluated.`,
                { line: arg.line, column: arg.column },
              ),
            );
            continue;
          }
          if (name.includes("$")) {
            issues.push(
              issue(
                DIAGNOSTICS.UNRESOLVED_INTERPOLATION,
                `server_name "${name}" contains a variable and was not resolved.`,
                { line: arg.line, column: arg.column },
              ),
            );
            continue;
          }
          serverNames.push(name);
        }
      }
      if (child.name === "ssl_certificate" || child.name === "ssl_certificate_key") {
        tls = true;
      }
    }

    const routes: NginxRouteDraft[] = [];
    const collectProxy = (location: Directive, path: string | undefined): void => {
      const proxyDirectives = (location.block ?? []).filter(
        (child) => child.name === "proxy_pass" && child.args.length > 0,
      );
      for (const proxy of proxyDirectives) {
        const target = proxy.args[0]?.value;
        if (!target) continue;
        const parsed = parseProxyTarget(target, proxy.line, issues);
        if (!parsed) continue;
        const [host, port] = splitHostPort(parsed);
        const upstreamTargets = host ? upstreams.get(host) : undefined;
        if (upstreamTargets && upstreamTargets.length > 0) {
          for (const upstreamTarget of upstreamTargets) {
            routes.push({
              ...(path ? { path } : {}),
              upstream: upstreamTarget.target,
              line: proxy.line,
            });
          }
        } else {
          routes.push({
            ...(path ? { path } : {}),
            upstream: port ? `${host}:${port}` : (host ?? parsed),
            line: proxy.line,
          });
        }
      }
      for (const child of location.block ?? []) {
        if (child.name === "location") {
          collectProxy(child, parseLocationPath(child, issues));
        }
      }
    };

    for (const child of childDirectives) {
      if (child.name === "proxy_pass" && child.args[0]) {
        const parsed = parseProxyTarget(child.args[0].value, child.line, issues);
        if (parsed) routes.push({ upstream: parsed, line: child.line });
      }
      if (child.name === "location") {
        collectProxy(child, parseLocationPath(child, issues));
      }
    }

    const uniqueRoutes = new Map<string, NginxRouteDraft>();
    for (const route of routes) {
      uniqueRoutes.set(`${route.path ?? ""}\u0000${route.upstream}`, route);
    }

    if (serverNames.length === 0) {
      issues.push(
        issue(
          DIAGNOSTICS.NGINX_SERVER_WITHOUT_NAME,
          "Nginx server block has no analyzable server_name and was skipped.",
          {
            line: directive.line,
            column: directive.column,
            suggestion: "Add a literal server_name to document its routing.",
          },
        ),
      );
      continue;
    }

    servers.push({
      serverNames,
      listens,
      tls,
      routes: [...uniqueRoutes.values()].sort(
        (a, b) =>
          (a.path ?? "").localeCompare(b.path ?? "") || a.upstream.localeCompare(b.upstream),
      ),
      line: directive.line,
    });
  }

  return { servers, upstreams, issues };
}

function splitHostPort(value: string): [string | undefined, string | undefined] {
  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    if (close !== -1) {
      const host = value.slice(1, close);
      const rest = value.slice(close + 1);
      return [host, rest.startsWith(":") ? rest.slice(1) : undefined];
    }
  }
  const lastColon = value.lastIndexOf(":");
  if (lastColon === -1) return [value, undefined];
  const possiblePort = value.slice(lastColon + 1);
  if (!/^\d+$/.test(possiblePort)) return [value, undefined];
  return [value.slice(0, lastColon), possiblePort];
}
