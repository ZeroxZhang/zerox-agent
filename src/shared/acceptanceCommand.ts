const leadingPythonCommandPattern = /^(\s*)python(?=\s)/;
const pythonCommandMissingPatterns = [
  /command not found:\s*python\b/i,
  /python:\s*command not found\b/i,
];

export type BlockedShellControl = "control" | "redirection";

/**
 * Detect shell syntax that changes the command structure, without treating
 * operators embedded in a quoted program argument as shell syntax.  Planning
 * checks commonly use `python3 -c "assert count >= 3"`; the `>` in that
 * string belongs to Python, not to the shell.
 */
export function findBlockedShellControl(
  command: string,
): BlockedShellControl | null {
  let quote: "single" | "double" | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    const next = command[index + 1];

    if (quote === "single") {
      if (char === "'") quote = null;
      continue;
    }

    if (quote === "double") {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === '"') {
        quote = null;
        continue;
      }
      if (char === "`" || (char === "$" && next === "(")) {
        return "control";
      }
      continue;
    }

    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "'") {
      quote = "single";
      continue;
    }
    if (char === '"') {
      quote = "double";
      continue;
    }
    if (char === "<" || char === ">") {
      return "redirection";
    }
    if (
      char === "\r" ||
      char === "\n" ||
      char === ";" ||
      char === "&" ||
      char === "|" ||
      char === "`" ||
      char === "(" ||
      char === ")" ||
      (char === "$" && next === "(")
    ) {
      return "control";
    }
  }

  return null;
}

/**
 * Returns the portable Python 3 equivalent of a command whose executable is
 * exactly `python`. Commands using python3, env wrappers, or shell expressions
 * are intentionally left unchanged.
 */
export function getPython3AcceptanceFallback(command: string): string | null {
  if (!leadingPythonCommandPattern.test(command)) {
    return null;
  }
  return command.replace(leadingPythonCommandPattern, "$1python3");
}

export function getAcceptanceCommandVariants(command: string): string[] {
  const normalized = command.trim();
  if (!normalized) {
    return [];
  }
  const fallback = getPython3AcceptanceFallback(normalized);
  return fallback && fallback !== normalized
    ? [normalized, fallback]
    : [normalized];
}

export function shouldRetryAcceptanceWithPython3(input: {
  command: string;
  exitCode: number;
  error: string;
}): boolean {
  return Boolean(
    input.exitCode === 127 &&
    getPython3AcceptanceFallback(input.command) &&
    pythonCommandMissingPatterns.some((pattern) => pattern.test(input.error)),
  );
}

/**
 * Planner models routinely express "run CMD in directory X" as the
 * idiomatic `cd X && CMD` chain. The acceptance sandbox forbids shell
 * control operators so every command stays a single statically checkable
 * invocation, but the semantic intent is legitimate and maps exactly onto
 * the workspaceRoot parameter that test_run already supports end-to-end.
 * This extractor separates the leading `cd <dir> &&` prefix (dir possibly
 * quoted) from the real command so callers can rewrite the pair into
 * params form instead of rejecting the check outright.
 */
const LEADING_CD_CHAIN_PATTERN =
  /^cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*&&\s*([\s\S]+)$/;

export function extractLeadingCdWorkspace(
  command: string,
): { dir: string; rest: string } | null {
  const match = LEADING_CD_CHAIN_PATTERN.exec(command.trim());
  if (!match) {
    return null;
  }
  const dir = (match[1] ?? match[2] ?? match[3] ?? "").trim();
  const rest = (match[4] ?? "").trim();
  if (!dir || !rest) {
    return null;
  }
  // Only a single `cd X && CMD` chain is mechanically rewritable. If the
  // remainder still chains or redirects, leave the command untouched so
  // the gate keeps blocking genuinely structural shell syntax.
  if (findBlockedShellControl(rest)) {
    return null;
  }
  return { dir, rest };
}
