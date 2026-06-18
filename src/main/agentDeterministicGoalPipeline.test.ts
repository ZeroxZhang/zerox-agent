import { describe, expect, it } from "vitest";
import type { AgentTaskContract } from "../shared/agentTaskContract";
import { buildPrimaryRunContext } from "../shared/agentWorkspace";
import { executeDeterministicGoalPipeline } from "./agentDeterministicGoalPipeline";

describe("agent deterministic goal pipeline", () => {
  it("executes a Chrome bookmark artifact contract with one native tool call", async () => {
    const calls: Array<{ toolName: string; args: Record<string, unknown> }> = [];
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_demo",
      workspaceRoot: "/Users/demo/project",
      runId: "goal_run_1",
      goalId: "goal_1",
      milestoneId: "milestone_1",
      locationEnv: {
        homeDir: "/Users/demo",
        workspaceRoot: "/Users/demo/project",
      },
      sandbox: {
        mode: "workspace_write",
        network: "task_policy",
        shell: "approved_commands",
        allowWorkspaceEscape: false,
        extraReadRoots: ["/Users/demo/Library/Application Support/Google/Chrome"],
        extraWriteRoots: ["/Users/demo/Desktop"],
      },
    });

    const result = await executeDeterministicGoalPipeline({
      contract: chromeBookmarkContract,
      runContext,
      async executeTool(toolName, args, options) {
        calls.push({ toolName, args });
        expect(toolName).toBe("chrome_bookmarks_read");
        return {
          ok: true,
          result: {
            artifactRef: "artifact:bookmark_list",
            artifactPath: "/Users/demo/Desktop/bookmark_list.md",
            provenanceRef: "provenance:bookmark_list",
            provenancePath: "/Users/demo/Desktop/bookmark_list.md.provenance.json",
            goalEvidenceRef: "artifact:goalEvidence",
            goalEvidencePath: "/Users/demo/Desktop/goalEvidence.md",
            goalEvidenceProvenanceRef: "provenance:goalEvidence",
            goalEvidenceProvenancePath:
              "/Users/demo/Desktop/goalEvidence.md.provenance.json",
            evidenceRefs: [
              "artifact:bookmark_list",
              "provenance:bookmark_list",
              "artifact:goalEvidence",
              "provenance:goalEvidence",
            ],
          },
        };
      },
    });

    expect(calls).toEqual([
      {
        toolName: "chrome_bookmarks_read",
        args: {
          chromeUserDataDir:
            "/Users/demo/Library/Application Support/Google/Chrome",
        },
      },
    ]);
    expect(result.status).toBe("succeeded");
    expect(result.toolNames).toEqual(["chrome_bookmarks_read"]);
    expect(result.artifacts.bookmarkList.path).toBe(
      "/Users/demo/Desktop/bookmark_list.md",
    );
    expect(result.artifacts.bookmarkList.provenancePath).toBe(
      "/Users/demo/Desktop/bookmark_list.md.provenance.json",
    );
    expect(result.replans).toBe(0);
  });

  it("fails a Chrome bookmark contract when required provenance outputs are missing", async () => {
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_demo",
      workspaceRoot: "/Users/demo/project",
      runId: "goal_run_1",
      goalId: "goal_1",
      milestoneId: "milestone_1",
      sandbox: {
        mode: "workspace_write",
        network: "task_policy",
        shell: "approved_commands",
        allowWorkspaceEscape: false,
        extraReadRoots: ["/Users/demo/Library/Application Support/Google/Chrome"],
        extraWriteRoots: ["/Users/demo/Desktop"],
      },
    });

    const result = await executeDeterministicGoalPipeline({
      contract: chromeBookmarkContract,
      runContext,
      async executeTool() {
        return {
          ok: true,
          result: {
            artifactRef: "artifact:bookmark_list",
            artifactPath: "/Users/demo/Desktop/bookmark_list.md",
            goalEvidenceRef: "artifact:goalEvidence",
            goalEvidencePath: "/Users/demo/Desktop/goalEvidence.md",
          },
        };
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      toolNames: ["chrome_bookmarks_read"],
      error: expect.stringContaining("provenance"),
    });
  });

  it("transforms a JSON local fixture into Markdown through file tools", async () => {
    const calls: Array<{ toolName: string; args: Record<string, unknown> }> = [];
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_demo",
      workspaceRoot: "/Users/demo/project",
      runId: "goal_run_2",
      goalId: "goal_2",
      milestoneId: "milestone_2",
      sandbox: {
        mode: "workspace_write",
        network: "task_policy",
        shell: "approved_commands",
        allowWorkspaceEscape: false,
        extraReadRoots: ["/Users/demo/project"],
        extraWriteRoots: ["/Users/demo/Desktop"],
      },
    });

    const result = await executeDeterministicGoalPipeline({
      contract: jsonMarkdownContract,
      runContext,
      async executeTool(toolName, args, options) {
        calls.push({ toolName, args });
        if (toolName === "file_read") {
          return {
            ok: true,
            result: {
              path: "/Users/demo/project/input/bookmarks.json",
              content: JSON.stringify({
                title: "Local fixture",
                links: ["https://example.com", "https://openai.com"],
              }),
            },
          };
        }
        if (toolName === "file_write") {
          expect(args).toMatchObject({
            path: "/Users/demo/Desktop/local_fixture.md",
          });
          expect(args).not.toHaveProperty("artifactId");
          expect(args).not.toHaveProperty("artifactRef");
          expect(options).toMatchObject({
            artifactWrite: {
              artifactId: "local_fixture",
              artifactRef: "artifact:local_fixture",
              source: {
                type: "json_file",
                path: "/Users/demo/project/input/bookmarks.json",
              },
            },
          });
          expect(String(args.content)).toContain("# Local Fixture");
          expect(String(args.content)).toContain("- https://openai.com");
          return {
            ok: true,
            result: {
              path: "/Users/demo/Desktop/local_fixture.md",
              artifactRef: "artifact:local_fixture",
              provenanceRef: "provenance:local_fixture",
              provenancePath:
                "/Users/demo/Desktop/local_fixture.md.provenance.json",
            },
          };
        }
        throw new Error(`Unexpected tool: ${toolName}`);
      },
    });

    expect(calls.map((call) => call.toolName)).toEqual([
      "file_read",
      "file_write",
    ]);
    expect(result.status).toBe("succeeded");
    expect(result.artifacts.localFixture.path).toBe(
      "/Users/demo/Desktop/local_fixture.md",
    );
    expect(result.artifacts.localFixture.provenancePath).toBe(
      "/Users/demo/Desktop/local_fixture.md.provenance.json",
    );
  });

  it("fails a JSON Markdown contract when file_write omits provenance", async () => {
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_demo",
      workspaceRoot: "/Users/demo/project",
      runId: "goal_run_2",
      goalId: "goal_2",
      milestoneId: "milestone_2",
      sandbox: {
        mode: "workspace_write",
        network: "task_policy",
        shell: "approved_commands",
        allowWorkspaceEscape: false,
        extraReadRoots: ["/Users/demo/project"],
        extraWriteRoots: ["/Users/demo/Desktop"],
      },
    });

    const result = await executeDeterministicGoalPipeline({
      contract: jsonMarkdownContract,
      runContext,
      async executeTool(toolName) {
        if (toolName === "file_read") {
          return {
            ok: true,
            result: {
              path: "/Users/demo/project/input/bookmarks.json",
              content: JSON.stringify({ title: "Local fixture" }),
            },
          };
        }
        return {
          ok: true,
          result: {
            path: "/Users/demo/Desktop/local_fixture.md",
            artifactRef: "artifact:local_fixture",
          },
        };
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      toolNames: ["file_read", "file_write"],
      error: expect.stringContaining("provenance"),
    });
  });

  it("fails a JSON Markdown contract when file_write omits the artifact ref", async () => {
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_demo",
      workspaceRoot: "/Users/demo/project",
      runId: "goal_run_2",
      goalId: "goal_2",
      milestoneId: "milestone_2",
      sandbox: {
        mode: "workspace_write",
        network: "task_policy",
        shell: "approved_commands",
        allowWorkspaceEscape: false,
        extraReadRoots: ["/Users/demo/project"],
        extraWriteRoots: ["/Users/demo/Desktop"],
      },
    });

    const result = await executeDeterministicGoalPipeline({
      contract: jsonMarkdownContract,
      runContext,
      async executeTool(toolName) {
        if (toolName === "file_read") {
          return {
            ok: true,
            result: {
              path: "/Users/demo/project/input/bookmarks.json",
              content: JSON.stringify({ title: "Local fixture" }),
            },
          };
        }
        return {
          ok: true,
          result: {
            path: "/Users/demo/Desktop/local_fixture.md",
            provenanceRef: "provenance:local_fixture",
            provenancePath:
              "/Users/demo/Desktop/local_fixture.md.provenance.json",
          },
        };
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      toolNames: ["file_read", "file_write"],
      error: expect.stringContaining("artifact:local_fixture"),
    });
  });
});

const chromeBookmarkContract: AgentTaskContract = {
  schemaVersion: 1,
  id: "task_contract_chrome_bookmarks_demo",
  taskKind: "local_data_to_artifact",
  mode: "deterministic",
  source: { type: "chrome_bookmarks" },
  transform: { type: "grouped_markdown" },
  deliverable: {
    artifactId: "bookmark_list",
    artifactRef: "artifact:bookmark_list",
    mediaType: "text/markdown",
    destination: { kind: "desktop", filename: "bookmark_list.md" },
  },
  capabilities: [
    { id: "chrome_bookmarks_read", toolName: "chrome_bookmarks_read" },
  ],
  acceptance: {
    evidenceRefs: ["artifact:bookmark_list", "artifact:goalEvidence"],
    provenanceRequired: true,
  },
  createdFrom: {
    description:
      "Get my Chrome bookmarks, group them, and write a Markdown file to Desktop.",
  },
};

const jsonMarkdownContract: AgentTaskContract = {
  schemaVersion: 1,
  id: "task_contract_json_fixture_demo",
  taskKind: "local_data_to_artifact",
  mode: "deterministic",
  source: {
    type: "json_file",
    path: "/Users/demo/project/input/bookmarks.json",
  },
  transform: { type: "json_markdown" },
  deliverable: {
    artifactId: "local_fixture",
    artifactRef: "artifact:local_fixture",
    mediaType: "text/markdown",
    destination: { kind: "desktop", filename: "local_fixture.md" },
  },
  capabilities: [
    { id: "file_read", toolName: "file_read" },
    { id: "file_write", toolName: "file_write" },
  ],
  acceptance: {
    evidenceRefs: ["artifact:local_fixture"],
    provenanceRequired: true,
  },
  createdFrom: {
    description:
      "Transform the local JSON fixture into Markdown and write it to Desktop.",
  },
};
