import { describe, expect, it } from "vitest";
import type { AcceptanceCheck } from "../shared/agentGoal";
import { validateAcceptanceCheckContract } from "./acceptanceContractValidator";

describe("shared acceptance contract validator", () => {
  it.each([
    {
      id: "file",
      kind: "file_exists",
      description: "文件存在",
      params: { path: "dist/report.md" },
      requiresEvidence: false,
    },
    {
      id: "test",
      kind: "test_passes",
      description: "测试通过",
      params: { command: "npm test", workspaceRoot: "." },
      requiresEvidence: false,
    },
    {
      id: "exit",
      kind: "command_exit_code",
      description: "命令成功",
      params: { command: "npm run build", expectedExitCode: 0 },
      requiresEvidence: false,
    },
    {
      id: "assert",
      kind: "assertion",
      description: "字段正确",
      params: { artifactRef: "artifact:result", path: "status", equals: "ok" },
      requiresEvidence: false,
    },
    {
      id: "review",
      kind: "model_review",
      description: "语义复核",
      params: { evidenceRefs: ["evidence_user_request"] },
      requiresEvidence: true,
    },
  ] satisfies AcceptanceCheck[])(
    "accepts the $kind contract",
    (check) => {
      expect(
        validateAcceptanceCheckContract(check, {
          workspaceRoot: "/workspace",
          evidenceRefs: ["evidence_user_request"],
        }),
      ).toMatchObject({ valid: true });
    },
  );

  it("rejects paths, command parameters, and invented evidence fail-closed", () => {
    expect(
      validateAcceptanceCheckContract(
        {
          id: "outside",
          kind: "file_exists",
          description: "越界文件",
          params: { path: "../secret" },
          requiresEvidence: false,
        },
        { workspaceRoot: "/workspace" },
      ).valid,
    ).toBe(false);
    expect(
      validateAcceptanceCheckContract({
        id: "exit",
        kind: "command_exit_code",
        description: "命令",
        params: { command: "npm test > out.txt", expectedExitCode: "0" },
        requiresEvidence: false,
      }).valid,
    ).toBe(false);
    expect(
      validateAcceptanceCheckContract(
        {
          id: "review",
          kind: "model_review",
          description: "语义",
          params: { evidenceRefs: ["invented"] },
          requiresEvidence: true,
        },
        { evidenceRefs: ["real"] },
      ).valid,
    ).toBe(false);
  });

  it("accepts structured user destinations but rejects traversal filenames", () => {
    expect(
      validateAcceptanceCheckContract(
        {
          id: "desktop-report",
          kind: "file_exists",
          description: "桌面报告存在",
          params: {
            destination: { kind: "desktop", filename: "report.md" },
          },
          requiresEvidence: false,
        },
        { workspaceRoot: "/workspace" },
      ).valid,
    ).toBe(true);
    expect(
      validateAcceptanceCheckContract(
        {
          id: "desktop-traversal",
          kind: "file_exists",
          description: "非法桌面路径",
          params: {
            destination: { kind: "desktop", filename: "../secret" },
          },
          requiresEvidence: false,
        },
        { workspaceRoot: "/workspace" },
      ).valid,
    ).toBe(false);
  });

  it("rejects malformed or invented semantic evidence during planning and runtime", () => {
    const malformed: AcceptanceCheck = {
      id: "malformed-review",
      kind: "model_review",
      description: "语义复核",
      params: { evidenceRefs: [123] },
      requiresEvidence: true,
    };
    expect(
      validateAcceptanceCheckContract(malformed, {
        deferRuntimeChecks: true,
      }).valid,
    ).toBe(false);
    expect(
      validateAcceptanceCheckContract(
        {
          ...malformed,
          id: "invented-artifact",
          params: { evidenceRefs: ["artifact:invented"] },
        },
        { evidenceRefs: ["evidence_user_request"] },
      ).valid,
    ).toBe(false);
    expect(
      validateAcceptanceCheckContract(
        {
          ...malformed,
          id: "goal-evidence",
          params: { evidenceRefs: ["artifact:goalEvidence"] },
        },
        { evidenceRefs: ["evidence_user_request"] },
      ).valid,
    ).toBe(true);
  });

  it("rejects prototype-chain assertion paths", () => {
    expect(
      validateAcceptanceCheckContract({
        id: "prototype-read",
        kind: "assertion",
        description: "不得读取原型链",
        params: {
          artifactRef: "artifact:result",
          path: "__proto__.secret",
          equals: "value",
        },
        requiresEvidence: false,
      }).valid,
    ).toBe(false);
  });
});
