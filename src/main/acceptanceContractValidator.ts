import path from "node:path";
import type { AcceptanceCheck } from "../shared/agentGoal";
import { findBlockedShellControl } from "../shared/acceptanceCommand";

const deterministicKinds = new Set([
  "file_exists",
  "command_exit_code",
  "test_passes",
  "assertion",
]);
const builtinKinds = new Set([...deterministicKinds, "model_review"]);
const allowedDeferredEvidenceRefs = new Set(["artifact:goalEvidence"]);

export type AcceptanceContractValidationContext = {
  workspaceRoot?: string;
  evidenceRefs?: Iterable<string>;
  allowedCommandPrefixes?: string[];
  /**
   * User-visible success criteria that authorize implementation-specific
   * probes. Planner quality checks use this to reject brittle source markers
   * that are not part of the actual Goal contract.
   */
  semanticCriteria?: Iterable<string>;
  /**
   * Plan Mode may describe an explicit absolute output target outside the
   * selected workspace. The confirmed Goal runtime still has to authorize
   * that root and enforce its live sandbox boundary.
   */
  allowExternalFileTargets?: boolean;
  /** Goal runtime will perform location/provenance checks with live context. */
  deferRuntimeChecks?: boolean;
};

export type AcceptanceContractValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  deterministic: boolean;
};

/**
 * Planner 和 Goal Acceptance 共用的静态合同校验。
 *
 * 这里只验证结构、边界与声明权限；真正的文件访问、命令运行和产物验证
 * 仍由 Goal Acceptance 的执行器完成。
 */
export function validateAcceptanceCheckContract(
  check: AcceptanceCheck,
  context: AcceptanceContractValidationContext = {},
): AcceptanceContractValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const kind = check.kind;
  const deterministic = deterministicKinds.has(kind);

  if (!check.id?.trim()) {
    errors.push("验收检查缺少 id。");
  }
  if (!check.description?.trim()) {
    errors.push(`验收检查 ${check.id || "<unknown>"} 缺少 description。`);
  }
  if (!builtinKinds.has(kind) && !kind.startsWith("validator:")) {
    errors.push(`未知验收检查类型：${kind}。`);
  }
  if (!isRecord(check.params)) {
    errors.push(`验收检查 ${check.id || "<unknown>"} 的 params 必须是对象。`);
    return { valid: false, errors, warnings, deterministic };
  }

  switch (kind) {
    case "file_exists":
      validateFileExists(check, context, errors, warnings);
      break;
    case "command_exit_code":
      validateCommand(check, context, errors);
      if (
        !Number.isInteger(check.params.expectedExitCode) ||
        Number(check.params.expectedExitCode) < 0 ||
        Number(check.params.expectedExitCode) > 255
      ) {
        errors.push(
          `验收检查 ${check.id} 的 expectedExitCode 必须是 0 到 255 的整数。`,
        );
      }
      break;
    case "test_passes":
      validateCommand(check, context, errors);
      if (
        check.params.workspaceRoot !== undefined &&
        !context.deferRuntimeChecks &&
        !validateWorkspacePath(
          String(check.params.workspaceRoot),
          context.workspaceRoot,
        )
      ) {
        errors.push(`验收检查 ${check.id} 的 workspaceRoot 超出工作区。`);
      }
      break;
    case "assertion":
      if (!nonEmptyString(check.params.artifactRef)) {
        errors.push(`验收检查 ${check.id} 缺少 artifactRef。`);
      } else if (
        !context.deferRuntimeChecks &&
        !/^artifact:[a-zA-Z0-9._-]+$/.test(
          check.params.artifactRef.trim(),
        )
      ) {
        errors.push(`验收检查 ${check.id} 的 artifactRef 非法。`);
      }
      if (!nonEmptyString(check.params.path)) {
        errors.push(`验收检查 ${check.id} 缺少字段路径 path。`);
      } else if (
        check.params.path
          .split(".")
          .some((segment) =>
            ["__proto__", "prototype", "constructor"].includes(segment),
          )
      ) {
        errors.push(`验收检查 ${check.id} 的字段路径包含被禁止的属性。`);
      }
      if (!Object.prototype.hasOwnProperty.call(check.params, "equals")) {
        errors.push(`验收检查 ${check.id} 缺少期望值 equals。`);
      }
      break;
    case "model_review":
      validateModelReview(check, context, errors);
      break;
    default:
      if (kind.startsWith("validator:") && kind.length === "validator:".length) {
        errors.push(`验收检查 ${check.id} 的 validator 名称不能为空。`);
      }
      break;
  }

  if (deterministic && check.requiresEvidence) {
    warnings.push(
      `确定性验收检查 ${check.id} 声明了 requiresEvidence；执行时仍会以确定性结果为准。`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    deterministic,
  };
}

export function isDeterministicAcceptanceCheck(
  check: Pick<AcceptanceCheck, "kind">,
): boolean {
  return deterministicKinds.has(check.kind);
}

function validateFileExists(
  check: AcceptanceCheck,
  context: AcceptanceContractValidationContext,
  errors: string[],
  warnings: string[],
): void {
  const destination = getStructuredDestination(check.params.destination);
  if (
    check.params.destination !== undefined &&
    check.params.destination !== null &&
    !destination
  ) {
    errors.push(`验收检查 ${check.id} 的结构化 destination 非法。`);
    return;
  }
  const requestedPath = nonEmptyString(check.params.path)
    ? check.params.path.trim()
    : "";
  const targetPath = destination?.path ?? requestedPath;
  if (!targetPath) {
    errors.push(`验收检查 ${check.id} 必须提供 path 或结构化 destination。`);
    return;
  }
  if (!destination?.external && !context.deferRuntimeChecks) {
    const insideWorkspace = validateWorkspacePath(
      targetPath,
      context.workspaceRoot,
    );
    if (!insideWorkspace) {
      if (
        context.allowExternalFileTargets &&
        isExplicitExternalFilePath(targetPath)
      ) {
        warnings.push(
          `验收检查 ${check.id} 使用工作区外的明确输出路径；确认计划后仍须通过运行时授权与沙箱校验。`,
        );
      } else {
        errors.push(`验收检查 ${check.id} 的目标路径超出工作区。`);
      }
    }
  }
  if (
    check.params.requireProvenance === true &&
    !nonEmptyString(check.params.artifactRef)
  ) {
    errors.push(
      `验收检查 ${check.id} 要求产物溯源时必须提供 artifactRef。`,
    );
  }
}

function isExplicitExternalFilePath(candidate: string): boolean {
  const trimmed = candidate.trim();
  return path.isAbsolute(trimmed) || trimmed === "~" || trimmed.startsWith("~/");
}

function validateCommand(
  check: AcceptanceCheck,
  context: AcceptanceContractValidationContext,
  errors: string[],
): void {
  const command = nonEmptyString(check.params.command)
    ? check.params.command.trim()
    : "";
  if (!command) {
    errors.push(`验收检查 ${check.id} 缺少 command。`);
    return;
  }
  if (!context.deferRuntimeChecks && findBlockedShellControl(command)) {
    errors.push(`验收检查 ${check.id} 的 command 含有被禁止的 Shell 控制符。`);
  }
  if (
    !context.deferRuntimeChecks &&
    context.allowedCommandPrefixes?.length &&
    !context.allowedCommandPrefixes.some(
      (prefix) => command === prefix || command.startsWith(`${prefix} `),
    )
  ) {
    errors.push(`验收检查 ${check.id} 的 command 不在允许的命令合同内。`);
  }
  validateStableContentProbe(check, command, context, errors);
}

/**
 * A source declaration or a comment marker is not a stable proxy for a
 * semantic outcome unless the Goal explicitly requires that exact syntax.
 * This catches contracts such as `grep -c 'var echarts'` for the broader
 * requirement "contains ECharts", which otherwise strand execution even
 * when an equivalent import/API shape is present.
 */
function validateStableContentProbe(
  check: AcceptanceCheck,
  command: string,
  context: AcceptanceContractValidationContext,
  errors: string[],
): void {
  const probe = extractQuotedSearchProbe(command);
  if (!probe || !isImplementationSpecificProbe(probe)) return;

  const semanticContract = [
    check.description,
    ...(context.semanticCriteria ? [...context.semanticCriteria] : []),
  ]
    .join("\n")
    .toLowerCase();
  if (semanticContract.includes(probe.toLowerCase())) return;

  errors.push(
    `验收检查 ${check.id} 依赖未在成功标准中明确要求的源码声明或标记 “${probe}”；请改用稳定的可观察 API、可执行测试或证据复核。`,
  );
}

function extractQuotedSearchProbe(command: string): string | null {
  if (!/(?:^|\s)(?:grep|rg)(?:\s|$)/u.test(command)) return null;
  const match = command.match(
    /(?:^|\s)(?:grep|rg)\b[^"'`\n]*?(?:"([^"\n]+)"|'([^'\n]+)')/u,
  );
  return (match?.[1] ?? match?.[2] ?? "").trim() || null;
}

function isImplementationSpecificProbe(probe: string): boolean {
  const normalized = probe.trim();
  return (
    /^(?:\^\s*)?(?:var|let|const|function|class)\s+[A-Za-z_$]/u.test(
      normalized,
    ) ||
    /(?:BEGIN|END|START|STOP).{0,32}(?:MARKER|片段|标记)|(?:核心代码片段|验收标记|acceptance marker)/iu.test(
      normalized,
    )
  );
}

function validateModelReview(
  check: AcceptanceCheck,
  context: AcceptanceContractValidationContext,
  errors: string[],
): void {
  if (!check.requiresEvidence) {
    errors.push(`model_review 检查 ${check.id} 必须 requiresEvidence=true。`);
  }
  const rawRefs = check.params.evidenceRefs;
  const refs = stringArray(rawRefs);
  if (
    !Array.isArray(rawRefs) ||
    (Array.isArray(rawRefs) &&
      rawRefs.some((ref) => typeof ref !== "string")) ||
    (!context.deferRuntimeChecks &&
      (refs.length === 0 || refs.length !== rawRefs.length))
  ) {
    errors.push(`model_review 检查 ${check.id} 必须提供真实 evidenceRefs。`);
    return;
  }
  const available = context.evidenceRefs
    ? new Set(context.evidenceRefs)
    : undefined;
  if (available && !context.deferRuntimeChecks) {
    const missing = refs.filter(
      (ref) => !available.has(ref) && !allowedDeferredEvidenceRefs.has(ref),
    );
    if (missing.length > 0) {
      errors.push(
        `model_review 检查 ${check.id} 引用了不存在的证据：${missing.join("、")}。`,
      );
    }
  }
}

function getStructuredDestination(
  destination: unknown,
): { path: string; external: boolean } | null {
  if (!isRecord(destination)) return null;
  if (
    (destination.kind === "desktop" || destination.kind === "downloads") &&
    nonEmptyString(destination.filename)
  ) {
    const filename = destination.filename.trim();
    if (
      filename !== path.basename(filename) ||
      filename === "." ||
      filename === ".."
    ) {
      return null;
    }
    return {
      path: `${
        destination.kind === "desktop" ? "Desktop" : "Downloads"
      }/${filename}`,
      external: true,
    };
  }
  if (destination.kind === "path" && nonEmptyString(destination.path)) {
    return { path: destination.path.trim(), external: false };
  }
  return null;
}

function validateWorkspacePath(
  candidate: string,
  workspaceRoot: string | undefined,
): boolean {
  if (!workspaceRoot || !candidate.trim()) return Boolean(candidate.trim());
  if (
    candidate === "~" ||
    candidate.startsWith("~/") ||
    /^(?:Desktop|Downloads|桌面|下载)\//.test(candidate)
  ) {
    return false;
  }
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, candidate);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
