// scanner.ts
import { TextOccurrence } from "./types";

const CONSOLE_METHODS = new Set([
  "log",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "assert",
  "dir",
  "dirxml",
  "group",
  "groupEnd",
  "groupCollapsed",
  "profile",
  "profileEnd",
  "time",
  "timeEnd",
  "timeLog",
  "timeStamp",
  "table",
  "count",
  "countReset",
  "clear",
]);

type TokenType =
  | "console"
  | "method"
  | "dot"
  | "paren_open"
  | "paren_close"
  | "string"
  | "template"
  | "comment"
  | "whitespace"
  | "other";

interface TokenInfo {
  type: TokenType;
  value: string;
  start: number;
  end: number;
  line: number; // starting line number for this token (0-based)
}

export function scanConsoleLogsInText(text: string): TextOccurrence[] {
  try {
    const tokens = tokenizeCode(text);
    const consoleStatements = findConsoleStatements(tokens, text);
    return consoleStatements.map((stmt) => ({
      startIndex: stmt.start,
      endIndex: stmt.end,
      startLine: stmt.line,
      preview: generatePreview(text, stmt.start, stmt.end),
      method: stmt.method,
    }));
  } catch (error) {
    // Keep internal failure safe: return empty array on error
    console.error("Error in scanConsoleLogsInText:", error);
    return [];
  }
}

function tokenizeCode(text: string): TokenInfo[] {
  const tokens: TokenInfo[] = [];
  let i = 0;
  let line = 0;

  while (i < text.length) {
    const char = text[i];

    // Each token should capture the starting line number
    const tokenStartLine = line;

    // Track newline first for isolated newline char token handling
    if (char === "\n") {
      // Record newline as whitespace token (keeps positions accurate)
      tokens.push({
        type: "whitespace",
        value: "\n",
        start: i,
        end: i + 1,
        line: tokenStartLine,
      });
      i++;
      line++;
      continue;
    }

    // Whitespace (spaces, tabs, CR but not newline because handled above)
    if (/\s/.test(char)) {
      const start = i;
      while (i < text.length && /\s/.test(text[i]) && text[i] !== "\n") {
        i++;
      }
      tokens.push({
        type: "whitespace",
        value: text.slice(start, i),
        start,
        end: i,
        line: tokenStartLine,
      });
      continue;
    }

    // Single-line comment //
    if (char === "/" && text[i + 1] === "/") {
      const start = i;
      i += 2;
      while (i < text.length && text[i] !== "\n") {
        i++;
      }
      // do not consume newline here; newline loop will handle next iteration
      tokens.push({
        type: "comment",
        value: text.slice(start, i),
        start,
        end: i,
        line: tokenStartLine,
      });
      continue;
    }

    // Multi-line comment /* ... */
    if (char === "/" && text[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < text.length) {
        if (text[i] === "\n") {
          line++;
        }
        if (text[i] === "*" && text[i + 1] === "/") {
          i += 2;
          break;
        }
        i++;
      }
      tokens.push({
        type: "comment",
        value: text.slice(start, i),
        start,
        end: i,
        line: tokenStartLine,
      });
      continue;
    }

    // Single-quoted string
    if (char === "'") {
      const start = i;
      i++; // skip opening
      while (i < text.length) {
        if (text[i] === "\n") {
          line++;
        }
        if (text[i] === "\\") {
          // skip escaped char (safe guard if escape at end)
          i += 2;
          continue;
        }
        if (text[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      tokens.push({
        type: "string",
        value: text.slice(start, i),
        start,
        end: i,
        line: tokenStartLine,
      });
      continue;
    }

    // Double-quoted string
    if (char === '"') {
      const start = i;
      i++; // skip opening
      while (i < text.length) {
        if (text[i] === "\n") {
          line++;
        }
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      tokens.push({
        type: "string",
        value: text.slice(start, i),
        start,
        end: i,
        line: tokenStartLine,
      });
      continue;
    }

    // Template literal `...` (handles ${...} expressions)
    if (char === "`") {
      const start = i;
      i++; // skip opening backtick
      let braceDepth = 0;
      while (i < text.length) {
        if (text[i] === "\n") line++;
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        // Enter expression
        if (text[i] === "$" && text[i + 1] === "{") {
          braceDepth++;
          i += 2;
          continue;
        }
        // Exit expression
        if (text[i] === "}" && braceDepth > 0) {
          braceDepth--;
          i++;
          continue;
        }
        // Only close template if not inside ${}
        if (text[i] === "`" && braceDepth === 0) {
          i++;
          break;
        }
        i++;
      }
      tokens.push({
        type: "template",
        value: text.slice(start, i),
        start,
        end: i,
        line: tokenStartLine,
      });
      continue;
    }

    // Parentheses
    if (char === "(") {
      tokens.push({
        type: "paren_open",
        value: "(",
        start: i,
        end: i + 1,
        line: tokenStartLine,
      });
      i++;
      continue;
    }
    if (char === ")") {
      tokens.push({
        type: "paren_close",
        value: ")",
        start: i,
        end: i + 1,
        line: tokenStartLine,
      });
      i++;
      continue;
    }

    // Dot
    if (char === ".") {
      tokens.push({
        type: "dot",
        value: ".",
        start: i,
        end: i + 1,
        line: tokenStartLine,
      });
      i++;
      continue;
    }

    // Identifiers (letters, $, _)
    if (/[a-zA-Z_$]/.test(char)) {
      const start = i;
      while (i < text.length && /[a-zA-Z0-9_$]/.test(text[i])) {
        i++;
      }
      const value = text.slice(start, i);
      const type: TokenType =
        value === "console" ? "console" : CONSOLE_METHODS.has(value) ? "method" : "other";
      tokens.push({
        type,
        value,
        start,
        end: i,
        line: tokenStartLine,
      });
      continue;
    }

    // Everything else as 'other'
    tokens.push({
      type: "other",
      value: char,
      start: i,
      end: i + 1,
      line: tokenStartLine,
    });
    i++;
  }

  return tokens;
}

interface ConsoleStatement {
  start: number;
  end: number;
  method: string;
  line: number;
}

/**
 * Helper to find the next token index that is not whitespace or comment.
 * Returns -1 if none.
 */
function nextNonTrivialTokenIndex(tokens: TokenInfo[], fromIndex: number): number {
  for (let j = fromIndex; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.type !== "whitespace" && t.type !== "comment") return j;
  }
  return -1;
}

function findConsoleStatements(tokens: TokenInfo[], text: string): ConsoleStatement[] {
  const statements: ConsoleStatement[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const current = tokens[i];
    if (current.type !== "console") continue;

    // find next non-whitespace/comment token -> expect dot
    const dotIdx = nextNonTrivialTokenIndex(tokens, i + 1);
    if (dotIdx === -1) continue;
    if (tokens[dotIdx].type !== "dot") continue;

    // next non-trivial -> method name
    const methodIdx = nextNonTrivialTokenIndex(tokens, dotIdx + 1);
    if (methodIdx === -1) continue;
    if (tokens[methodIdx].type !== "method") continue;

    // next non-trivial -> open paren
    const parenIdx = nextNonTrivialTokenIndex(tokens, methodIdx + 1);
    if (parenIdx === -1) continue;
    if (tokens[parenIdx].type !== "paren_open") continue;

    // Find matching paren index (passing the paren token index)
    const closingParenIdx = findMatchingParen(tokens, parenIdx);
    if (closingParenIdx === -1) {
      // unmatched, skip
      continue;
    }

    // Determine end position: normally the end of closing paren token
    let endPos = tokens[closingParenIdx].end;

    // Check for semicolon right after (skip whitespace/comments in between)
    const afterIdx = nextNonTrivialTokenIndex(tokens, closingParenIdx + 1);
    if (afterIdx !== -1) {
      const nextToken = tokens[afterIdx];
      if (nextToken.value === ";") {
        endPos = nextToken.end;
      }
    }

    statements.push({
      start: current.start,
      end: endPos,
      method: tokens[methodIdx].value,
      line: current.line,
    });

    // Advance i past this statement to avoid overlapping detections
    i = closingParenIdx;
  }

  return statements;
}

/**
 * Given an index of an opening paren token in tokens[], find the index
 * of the matching closing paren, or -1 if none. Ignores tokens of type
 * string/template/comment when counting depth, because those tokens are atomic.
 */
function findMatchingParen(tokens: TokenInfo[], openParenIndex: number): number {
  let depth = 1;
  for (let i = openParenIndex + 1; i < tokens.length; i++) {
    const token = tokens[i];

    // ignore strings/templates/comments so parens inside them don't affect depth
    if (token.type === "string" || token.type === "template" || token.type === "comment") {
      continue;
    }

    if (token.type === "paren_open") {
      depth++;
    } else if (token.type === "paren_close") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function generatePreview(text: string, start: number, end: number): string {
  let preview = text.slice(start, end);
  preview = preview.replace(/\s+/g, " ").trim();
  if (preview.length > 100) {
    preview = preview.slice(0, 97) + "...";
  }
  return preview;
}
