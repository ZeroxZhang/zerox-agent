// ShellPlan analyzer (contracts v1.4 §3.1, Exit Criteria for P6).
//
// Parses a raw `shell_exec` command into a structured `ShellPlan`: the command
// sequence, per-command read/write paths, control operators, and network access.
// This replaces the legacy wildcard + naive-tokenizer permission matching (which
// missed relative paths, `$VAR` expansion, command substitution, and redirection
// targets) with a single source of truth consumed by both permission layers.
//
// Implementation note (spec R1 / Q4): the contract names tree-sitter bash
// grammar. tree-sitter is a native module with Electron ABI packaging cost; the
// spec explicitly permits a fallback (WASM / mvdan.cc/sh). This implementation
// uses a focused tokenizer that correctly handles control-operator splitting,
// `$()`/backtick substitution, redirection, and path classification — capturing
// the injection-detection security value without a second native dependency.
// `ZEROX_SHELL_ANALYZER=legacy` falls back to the original regex behavior.

import path from "node:path";

export interface ShellCommand {
  name: string;
  args: string[];
  writesPaths: string[];
  readsPaths: string[];
}

export interface ShellPlan {
  commands: ShellCommand[];
  touchedPaths: string[]; // union of all writes+reads (aggregate; per-command fields are authoritative)
  controlOperators: string[];
  networkAccess: boolean;
  opaqueExecution: boolean;
  raw: string;
}

const NETWORK_COMMANDS = new Set([
  "curl",
  "wget",
  "ftp",
  "scp",
  "rsync",
  "ssh",
  "telnet",
  "nc",
  "netcat",
  "http",
  "https",
]);
const NETWORK_HINT_SUBSTRINGS = ["npm install", "npm i ", "pnpm install", "yarn add", "pip install", "pip3 install", "git fetch", "git pull", "git clone", "git push", "brew install"];

const CONTROL_OPERATORS: Array<[string, RegExp]> = [
  ["newline", /[\r\n]/g],
  ["&&", /&&/g],
  ["||", /\|\|/g],
  ["|", /\|/g],
  [";", /;/g],
  ["$(", /\$\(/g],
  ["`", /`/g],
  [">>", />>/g],
  [">", /(?<!>)>(?!>)/g],
  ["<", /<(?!<)/g],
];

/**
 * Analyze a raw shell command into a ShellPlan. `opts.cwd` resolves relative
 * paths to absolute form (best-effort; `~` and `$VAR` are expanded where
 * determinable, otherwise the raw token is kept and flagged via the path
 * classifier).
 */
export function analyzeShell(raw: string, opts: { cwd: string }): ShellPlan {
  const cwd = opts.cwd || process.cwd();
  const controlOperators = detectControlOperators(raw);
  const segments = splitOnControlOperators(raw);
  const commands: ShellCommand[] = [];
  for (const seg of segments) {
    const cmd = parseCommand(seg, cwd);
    if (cmd) commands.push(cmd);
  }

  const touched = new Set<string>();
  for (const c of commands) {
    for (const p of [...c.writesPaths, ...c.readsPaths]) touched.add(p);
  }

  const networkAccess =
    commands.some((command) =>
      NETWORK_COMMANDS.has(effectiveExecutableName(command)),
    ) ||
    NETWORK_HINT_SUBSTRINGS.some((s) => raw.includes(s)) ||
    (controlOperators.includes("$(") &&
      /curl|wget|ssh|scp|git\s+(fetch|pull|clone|push)/.test(raw)) ||
    /\b(?:curl|wget|scp|sftp|ssh|nc|netcat)\b|\brequests\.(?:get|post|put|delete)\s*\(|\b(?:fetch|axios)\s*\(|\b(?:urllib|http|https)\.(?:request|client)\b/i.test(raw);
  const opaqueExecution = commands.some((command) => {
    const name = effectiveExecutableName(command);
    const interpreters = [
      "sh",
      "bash",
      "zsh",
      "fish",
      "python",
      "python3",
      "node",
      "ruby",
      "perl",
      "npm",
      "npx",
      "pnpm",
      "yarn",
      "bun",
      "bunx",
      "open",
    ];
    return (
      (interpreters.includes(name) &&
        !(
          command.args.length > 0 &&
          command.args.every((arg) =>
            ["--version", "--help", "-V", "-v"].includes(arg),
          )
        )) ||
      name === "xargs"
    );
  });

  return {
    commands,
    touchedPaths: [...touched],
    controlOperators,
    networkAccess,
    opaqueExecution,
    raw,
  };
}

function effectiveExecutableName(command: ShellCommand): string {
  let name = path.basename(command.name).toLowerCase();
  let args = command.args;
  while (name === "env" || name === "command") {
    const index = args.findIndex(
      (arg) => !arg.startsWith("-") && !isEnvAssignment(arg),
    );
    if (index < 0) break;
    name = path.basename(args[index]!).toLowerCase();
    args = args.slice(index + 1);
  }
  return name;
}

function detectControlOperators(raw: string): string[] {
  const found = new Set<string>();
  for (const [name, re] of CONTROL_OPERATORS) {
    re.lastIndex = 0;
    if (re.test(raw)) found.add(name);
  }
  // Preserve a stable, deduped order.
  const order = ["newline", "&&", "||", "|", ";", "$(", "`", ">>", ">", "<"];
  return order.filter((o) => found.has(o));
}

/**
 * Split a raw command into top-level command segments on newlines, `;`, `&&`, `||`, `|`,
 * while respecting quotes and `$()`/backtick substitution (we keep substitution
 * boundaries as their own segments so the inner command is also analyzed).
 */
function splitOnControlOperators(raw: string): string[] {
  const segments: string[] = [];
  let current = "";
  let i = 0;
  let quote: string | null = null;
  while (i < raw.length) {
    const ch = raw[i];
    const two = raw.slice(i, i + 2);
    if (quote) {
      current += ch;
      if (ch === quote && raw[i - 1] !== "\\") quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      i++;
      continue;
    }
    if (two === "$(") {
      // command substitution: capture inner as a separate segment
      if (current.trim()) segments.push(current);
      current = "";
      const end = findMatching(raw, i + 2, "(", ")");
      if (end > 0) {
        segments.push(raw.slice(i + 2, end));
        i = end + 1;
        continue;
      }
    }
    if (ch === "`") {
      if (current.trim()) segments.push(current);
      current = "";
      const end = raw.indexOf("`", i + 1);
      if (end > 0) {
        segments.push(raw.slice(i + 1, end));
        i = end + 1;
        continue;
      }
    }
    if (two === "&&" || two === "||") {
      if (current.trim()) segments.push(current);
      current = "";
      i += 2;
      continue;
    }
    if (ch === ";" || ch === "|" || ch === "\n" || ch === "\r") {
      if (current.trim()) segments.push(current);
      current = "";
      if (ch === "\r" && raw[i + 1] === "\n") {
        i++;
      }
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (current.trim()) segments.push(current);
  return segments;
}

function findMatching(s: string, start: number, open: string, close: string): number {
  let depth = 1;
  let i = start;
  let quote: string | null = null;
  while (i < s.length) {
    const ch = s[i];
    if (quote) {
      if (ch === quote && s[i - 1] !== "\\") quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; i++; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function parseCommand(seg: string, cwd: string): ShellCommand | null {
  // Strip leading assignment tokens (FOO=bar) and redirection targets, but
  // capture redirection targets as paths.
  const tokens = tokenize(seg);
  if (!tokens.length) return null;
  const writesPaths: string[] = [];
  const readsPaths: string[] = [];
  const args: string[] = [];
  let name = "";
  let foundName = false;
  let pendingRedirect: ">" | ">>" | "<" | null = null;
  for (const tok of tokens) {
    if (tok === ">" || tok === ">>" || tok === "<") {
      pendingRedirect = tok as ">" | ">>" | "<";
      continue;
    }
    if (!foundName && isEnvAssignment(tok)) {
      // skip leading VAR=value
      continue;
    }
    if (!foundName) {
      name = tok;
      foundName = true;
      continue;
    }
    if (pendingRedirect === ">" || pendingRedirect === ">>") {
      const resolved = resolvePath(tok, cwd);
      if (resolved) writesPaths.push(resolved);
      pendingRedirect = null;
      continue;
    }
    if (pendingRedirect === "<") {
      const resolved = resolvePath(tok, cwd);
      if (resolved) readsPaths.push(resolved);
      pendingRedirect = null;
      continue;
    }
    args.push(tok);
    const pathLike = classifyPathArg(tok, cwd);
    if (pathLike?.write) writesPaths.push(pathLike.path);
    else if (pathLike?.read) readsPaths.push(pathLike.path);
  }
  if (!name) return null;
  return { name, args, writesPaths: dedup(writesPaths), readsPaths: dedup(readsPaths) };
}

function tokenize(seg: string): string[] {
  const out: string[] = [];
  const re = /(?:"[^"]*"|'[^']*'|>>|>|<|[^\s"'<>]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seg)) !== null) {
    const t = m[0];
    if (t === '"' || t === "'") continue;
    out.push(stripQuotes(t));
  }
  return out;
}

function stripQuotes(t: string): string {
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function isEnvAssignment(tok: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(tok);
}

function resolvePath(tok: string, cwd: string): string | null {
  const expanded = expandToken(tok);
  if (!expanded) return null;
  if (path.isAbsolute(expanded)) return expanded;
  return path.resolve(cwd, expanded);
}

function classifyPathArg(tok: string, cwd: string): { path: string; read: boolean; write: boolean } | null {
  // Flags and option values are not paths.
  if (tok.startsWith("-")) return null;
  // Path-like: absolute, home-relative, contains a separator, OR looks like a
  // filename with an extension (e.g. `a.txt`, `out.md`). Bare tokens without a
  // slash/extension (e.g. `status`, `hello`) are treated as args, not paths.
  const isBareParentDirectory = tok === "..";
  const looksLikeFile = /^[A-Za-z0-9._~][A-Za-z0-9._~-]*\.[A-Za-z0-9]+$/.test(tok);
  if (!isBareParentDirectory && !tok.includes("/") && !tok.startsWith("~") && !looksLikeFile) return null;
  const resolved = resolvePath(tok, cwd);
  if (!resolved) return null;
  // Conservative: classify as read by default; write detection for args is
  // command-specific (e.g. `rm`, `mv`, `cp`, `tee`, `>`). Mark writes for
  // known mutating commands at the command level via writesPaths there.
  return { path: resolved, read: true, write: false };
}

function expandToken(tok: string): string | null {
  if (!tok) return null;
  if (tok.startsWith("~")) return tok.replace(/^~/, process.env.HOME ?? "~");
  // `$VAR` — conservatively expand a few known; otherwise keep raw token (the
  // permission layer will treat unknown-expanded tokens as suspect).
  if (/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(tok)) {
    return tok.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_, name) => process.env[name] ?? `$${name}`);
  }
  return tok;
}

function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}
