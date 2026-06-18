import { describe, expect, it } from "vitest";
import type { ChatClient, ChatCompletionRequest } from "./openAiCompatibleClient";
import type { Goal, SuccessCriterion } from "../shared/agentGoal";
import { compileAgentTaskContract } from "../shared/agentTaskContract";
import { createAgentGoalPlanner } from "./agentGoalPlanner";

const criterion: SuccessCriterion = {
  id: "criterion_done",
  description: "Goal-level outcome is accepted.",
  acceptanceChecks: [
    {
      id: "check_goal_file",
      kind: "file_exists",
      description: "Final report exists.",
      params: { path: "report.md" },
      requiresEvidence: false,
    },
  ],
};

const modelReviewCriterion: SuccessCriterion = {
  id: "criterion_goal_review",
  description: "Chrome bookmarks are summarized.",
  acceptanceChecks: [
    {
      id: "check_bookmarks_review",
      kind: "model_review",
      description: "Judge confirms bookmark summary.",
      params: {
        condition: "Chrome bookmarks are summarized.",
        evidenceRefs: ["artifact:goalEvidence"],
      },
      requiresEvidence: true,
    },
  ],
};

const deterministicArtifactCriterion: SuccessCriterion = {
  id: "criterion_deterministic_bookmark_artifacts",
  description: "Chrome bookmark artifacts exist with provenance.",
  acceptanceChecks: [
    {
      id: "check_bookmark_list_artifact",
      kind: "file_exists",
      description: "Complete Chrome bookmark list artifact exists.",
      params: {
        path: "bookmark_list.md",
        artifactRef: "artifact:bookmark_list",
        destination: { kind: "desktop", filename: "bookmark_list.md" },
        requireProvenance: true,
      },
      requiresEvidence: false,
    },
    {
      id: "check_goal_evidence_artifact",
      kind: "file_exists",
      description: "Goal evidence artifact exists.",
      params: {
        path: "goalEvidence.md",
        artifactRef: "artifact:goalEvidence",
        destination: { kind: "desktop", filename: "goalEvidence.md" },
        requireProvenance: true,
      },
      requiresEvidence: false,
    },
  ],
};

describe("agent goal planner", () => {
  it("decomposes a natural-language goal into acceptance-bearing milestones", async () => {
    const requests: ChatCompletionRequest[] = [];
    const planner = createAgentGoalPlanner({
      chatClient: createFakeChatClient([
        {
          milestones: [
            {
              id: "milestone_research",
              description: "Collect sources.",
              dependsOn: [],
              successCriteria: [criterion],
            },
            {
              id: "milestone_write",
              description: "Write the report.",
              dependsOn: ["milestone_research"],
              successCriteria: [criterion],
            },
          ],
        },
      ], requests),
      modelProfile: fakeModelProfile,
    });

    const milestones = await planner.plan("Prepare a local research report", {
      successCriteria: [criterion],
      availableTools: ["web_fetch_document", "markdown_report_write"],
      availableSkills: ["research-writer"],
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].messages[0]?.content).toContain(
      "Prepare a local research report",
    );
    expect(requests[0].messages[0]?.content).toContain("web_fetch_document");
    expect(milestones).toEqual([
      {
        id: "milestone_research",
        description: "Collect sources.",
        dependsOn: [],
        successCriteria: [criterion],
        state: "ready",
        runIds: [],
        attempts: 0,
      },
      {
        id: "milestone_write",
        description: "Write the report.",
        dependsOn: ["milestone_research"],
        successCriteria: [criterion],
        state: "pending",
        runIds: [],
        attempts: 0,
      },
    ]);
  });

  it("injects task strategy guidance into the planning prompt", async () => {
    const requests: ChatCompletionRequest[] = [];
    const planner = createAgentGoalPlanner({
      chatClient: createFakeChatClient([
        {
          milestones: [
            {
              id: "milestone_inventory",
              description: "Inventory the folder.",
              dependsOn: [],
              successCriteria: [criterion],
            },
          ],
        },
      ], requests),
      modelProfile: fakeModelProfile,
    });

    await planner.plan("整理 /Users/bytedance/Downloads 这个文件夹", {
      successCriteria: [criterion],
      availableTools: ["file_list", "shell_exec"],
      availableSkills: ["local-file-organizer"],
    });

    const prompt = requests[0].messages[0]?.content;
    expect(prompt).toContain("Task strategy frame:");
    expect(prompt).toContain('"domain":"files"');
    expect(prompt).toContain('"recommendedRuntime":"quick_action"');
    expect(prompt).toContain("/Users/bytedance/Downloads");
    expect(prompt).toContain(
      "Do not decompose small deterministic quick-action work into Goal Mode milestones.",
    );
    expect(prompt).toContain(
      "Do not create clarification-only milestones that merely ask the user what they meant.",
    );
  });

  it("creates a single native milestone for Chrome bookmark goals", async () => {
    const requests: ChatCompletionRequest[] = [];
    const planner = createAgentGoalPlanner({
      chatClient: createFakeChatClient([], requests),
      modelProfile: fakeModelProfile,
      maxPlanAttempts: 1,
    });

    const milestones = await planner.plan("看一下 Chrome 浏览器的书签", {
      successCriteria: [modelReviewCriterion],
      availableTools: ["chrome_bookmarks_read", "file_read", "tool_result_read"],
      availableSkills: [],
    });

    expect(requests).toHaveLength(0);
    expect(milestones).toEqual([
      {
        id: "extract_chrome_bookmarks",
        description:
          "Read Chrome bookmarks with chrome_bookmarks_read, present a concise preview, and write complete bookmark_list.md and goalEvidence.md artifacts.",
        dependsOn: [],
        successCriteria: [
          modelReviewCriterion,
          {
            id: "criterion_chrome_bookmark_artifacts",
            description: "Chrome bookmark artifacts are written.",
            acceptanceChecks: [
              {
                id: "check_bookmark_list_artifact",
                kind: "file_exists",
                description: "Complete Chrome bookmark list artifact exists.",
                params: { path: "bookmark_list.md" },
                requiresEvidence: false,
              },
              {
                id: "check_goal_evidence_artifact",
                kind: "file_exists",
                description: "Goal evidence artifact exists.",
                params: { path: "goalEvidence.md" },
                requiresEvidence: false,
              },
            ],
          },
        ],
        state: "ready",
        runIds: [],
        attempts: 0,
      },
    ]);
  });

  it("creates a single native milestone from a Chrome bookmark task contract without a model request", async () => {
    const requests: ChatCompletionRequest[] = [];
    const planner = createAgentGoalPlanner({
      chatClient: createFakeChatClient([], requests),
      modelProfile: fakeModelProfile,
      maxPlanAttempts: 1,
    });
    const taskContract = compileAgentTaskContract({
      description:
        "Get my Chrome bookmarks, group them, write a Markdown file to Desktop.",
      chatSessionId: "chat_1",
      originMessageId: "message_1",
    });

    const milestones = await planner.plan(
      "Use the supplied task contract rather than description heuristics.",
      {
        successCriteria: [modelReviewCriterion],
        availableTools: ["chrome_bookmarks_read", "file_read"],
        availableSkills: [],
        taskContract,
      },
    );

    expect(requests).toHaveLength(0);
    expect(milestones).toEqual([
      {
        id: "extract_chrome_bookmarks",
        description:
          "Read Chrome bookmarks with chrome_bookmarks_read, present a concise preview, and write complete bookmark_list.md and goalEvidence.md artifacts.",
        dependsOn: [],
        successCriteria: [
          modelReviewCriterion,
          {
            id: "criterion_chrome_bookmark_artifacts",
            description: "Chrome bookmark artifacts are written.",
            acceptanceChecks: [
              {
                id: "check_bookmark_list_artifact",
                kind: "file_exists",
                description: "Complete Chrome bookmark list artifact exists.",
                params: {
                  path: "bookmark_list.md",
                  artifactRef: "artifact:bookmark_list",
                  destination: { kind: "desktop", filename: "bookmark_list.md" },
                  requireProvenance: true,
                },
                requiresEvidence: false,
              },
              {
                id: "check_goal_evidence_artifact",
                kind: "file_exists",
                description: "Goal evidence artifact exists.",
                params: {
                  path: "goalEvidence.md",
                  artifactRef: "artifact:goalEvidence",
                  destination: { kind: "desktop", filename: "goalEvidence.md" },
                  requireProvenance: true,
                },
                requiresEvidence: false,
              },
            ],
          },
        ],
        state: "ready",
        runIds: [],
        attempts: 0,
      },
    ]);
  });

  it("accepts deterministic artifact criteria for Chrome bookmark task contracts", async () => {
    const requests: ChatCompletionRequest[] = [];
    const planner = createAgentGoalPlanner({
      chatClient: createFakeChatClient([], requests),
      modelProfile: fakeModelProfile,
      maxPlanAttempts: 1,
    });
    const taskContract = compileAgentTaskContract({
      description:
        "Get my Chrome bookmarks, group them, write a Markdown file to Desktop.",
      chatSessionId: "chat_1",
      originMessageId: "message_1",
    });

    const milestones = await planner.plan(
      "Use the supplied deterministic task contract.",
      {
        successCriteria: [deterministicArtifactCriterion],
        availableTools: ["chrome_bookmarks_read"],
        availableSkills: [],
        taskContract,
      },
    );

    expect(requests).toHaveLength(0);
    expect(milestones).toEqual([
      {
        id: "extract_chrome_bookmarks",
        description:
          "Read Chrome bookmarks with chrome_bookmarks_read, present a concise preview, and write complete bookmark_list.md and goalEvidence.md artifacts.",
        dependsOn: [],
        successCriteria: [deterministicArtifactCriterion],
        state: "ready",
        runIds: [],
        attempts: 0,
      },
    ]);
  });

  it("falls back to model planning when the task contract is unsupported", async () => {
    const requests: ChatCompletionRequest[] = [];
    const planner = createAgentGoalPlanner({
      chatClient: createFakeChatClient([
        {
          milestones: [
            {
              id: "milestone_model",
              description: "Use the model for unsupported contracts.",
              dependsOn: [],
              successCriteria: [criterion],
            },
          ],
        },
      ], requests),
      modelProfile: fakeModelProfile,
    });
    const unsupportedContract = {
      schemaVersion: 1,
      id: "task_contract_unsupported",
      taskKind: "local_data_to_artifact",
      mode: "deterministic",
      source: { type: "unsupported_source" },
      transform: { type: "grouped_markdown" },
      deliverable: {
        artifactId: "bookmark_list",
        artifactRef: "artifact:bookmark_list",
        mediaType: "text/markdown",
        destination: { kind: "desktop", filename: "bookmark_list.md" },
      },
      capabilities: [],
      acceptance: {
        evidenceRefs: ["artifact:bookmark_list", "artifact:goalEvidence"],
        provenanceRequired: true,
      },
      createdFrom: { description: "Unsupported deterministic work." },
    };

    const milestones = await planner.plan("Unsupported deterministic work.", {
      successCriteria: [criterion],
      availableTools: ["chrome_bookmarks_read"],
      availableSkills: [],
      taskContract: unsupportedContract,
    });

    expect(requests).toHaveLength(1);
    expect(milestones.map((milestone) => milestone.id)).toEqual([
      "milestone_model",
    ]);
  });

  it("falls back to model planning when a Chrome bookmark contract is missing acceptance", async () => {
    const requests: ChatCompletionRequest[] = [];
    const planner = createAgentGoalPlanner({
      chatClient: createFakeChatClient([
        {
          milestones: [
            {
              id: "milestone_model",
              description: "Use the model for malformed contracts.",
              dependsOn: [],
              successCriteria: [modelReviewCriterion],
            },
          ],
        },
      ], requests),
      modelProfile: fakeModelProfile,
    });
    const malformedContract = {
      schemaVersion: 1,
      id: "task_contract_malformed",
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
      createdFrom: { description: "Malformed deterministic bookmark work." },
    };

    const milestones = await planner.plan(
      "Malformed deterministic bookmark work.",
      {
        successCriteria: [modelReviewCriterion],
        availableTools: ["chrome_bookmarks_read"],
        availableSkills: [],
        taskContract: malformedContract,
      },
    );

    expect(requests).toHaveLength(1);
    expect(milestones.map((milestone) => milestone.id)).toEqual([
      "milestone_model",
    ]);
  });

  it("falls back to model planning when a Chrome bookmark contract has wrong evidence refs", async () => {
    const requests: ChatCompletionRequest[] = [];
    const planner = createAgentGoalPlanner({
      chatClient: createFakeChatClient([
        {
          milestones: [
            {
              id: "milestone_model",
              description: "Use the model for contracts with wrong evidence.",
              dependsOn: [],
              successCriteria: [modelReviewCriterion],
            },
          ],
        },
      ], requests),
      modelProfile: fakeModelProfile,
    });
    const malformedContract = {
      schemaVersion: 1,
      id: "task_contract_wrong_evidence",
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
        evidenceRefs: ["artifact:goalEvidence"],
        provenanceRequired: true,
      },
      createdFrom: {
        description: "Malformed deterministic bookmark work.",
      },
    };

    const milestones = await planner.plan(
      "Malformed deterministic bookmark work.",
      {
        successCriteria: [modelReviewCriterion],
        availableTools: ["chrome_bookmarks_read"],
        availableSkills: [],
        taskContract: malformedContract,
      },
    );

    expect(requests).toHaveLength(1);
    expect(milestones.map((milestone) => milestone.id)).toEqual([
      "milestone_model",
    ]);
  });

  it("re-prompts once when the model returns a milestone without acceptance checks", async () => {
    const requests: ChatCompletionRequest[] = [];
    const planner = createAgentGoalPlanner({
      chatClient: createFakeChatClient([
        {
          milestones: [
            {
              id: "milestone_invalid",
              description: "No checks.",
              dependsOn: [],
              successCriteria: [
                {
                  id: "criterion_empty",
                  description: "Missing checks.",
                  acceptanceChecks: [],
                },
              ],
            },
          ],
        },
        {
          milestones: [
            {
              id: "milestone_valid",
              description: "Has checks.",
              dependsOn: [],
              successCriteria: [criterion],
            },
          ],
        },
      ], requests),
      modelProfile: fakeModelProfile,
    });

    const milestones = await planner.plan("Recover from invalid planning", {
      successCriteria: [criterion],
      availableTools: ["test_run"],
      availableSkills: [],
    });

    expect(requests).toHaveLength(2);
    expect(requests[1].messages[0]?.content).toContain(
      "Previous plan was rejected",
    );
    expect(milestones.map((milestone) => milestone.id)).toEqual([
      "milestone_valid",
    ]);
  });

  it("extracts milestone JSON from fenced model responses", async () => {
    const planner = createAgentGoalPlanner({
      chatClient: createFakeChatClient([
        [
          "```json",
          JSON.stringify({
            milestones: [
              {
                id: "milestone_json",
                description: "Parse fenced JSON.",
                dependsOn: [],
                successCriteria: [criterion],
              },
            ],
          }),
          "```",
        ].join("\n"),
      ]),
      modelProfile: fakeModelProfile,
      maxPlanAttempts: 1,
    });

    await expect(
      planner.plan("Recover from markdown-wrapped JSON", {
        successCriteria: [criterion],
        availableTools: [],
        availableSkills: [],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "milestone_json",
        description: "Parse fenced JSON.",
      }),
    ]);
  });

  it("preserves accepted milestones while replanning remaining work", async () => {
    const goal = createGoal();
    const accepted = goal.milestones[0];
    const planner = createAgentGoalPlanner({
      chatClient: createFakeChatClient([
        {
          milestones: [
            {
              id: accepted.id,
              description: "Model tried to rewrite accepted work.",
              dependsOn: [],
              successCriteria: [criterion],
            },
            {
              id: "milestone_review",
              description: "Review and finalize.",
              dependsOn: [accepted.id],
              successCriteria: [criterion],
            },
          ],
        },
      ]),
      modelProfile: fakeModelProfile,
    });

    const replanned = await planner.replan(goal, "Acceptance failed.");

    expect(replanned).toEqual([
      accepted,
      {
        id: "milestone_review",
        description: "Review and finalize.",
        dependsOn: [accepted.id],
        successCriteria: [criterion],
        state: "pending",
        runIds: [],
        attempts: 0,
      },
    ]);
    expect(goal.planVersion).toBe(2);
    expect(goal.budgetUsage.replans).toBe(1);
  });

  it("falls back to a safe remaining milestone when replanning responses stay non-json", async () => {
    const goal = createGoal();
    const planner = createAgentGoalPlanner({
      chatClient: createFakeChatClient(["I cannot return JSON"]),
      modelProfile: fakeModelProfile,
      maxPlanAttempts: 1,
    });

    const replanned = await planner.replan(goal, "Goal evidence was incomplete.");

    expect(replanned).toEqual([
      goal.milestones[0],
      expect.objectContaining({
        id: "milestone_replan_2",
        description: "Goal evidence was incomplete.",
        state: "pending",
        runIds: [],
        attempts: 0,
      }),
    ]);
  });

  it("rejects dependency cycles deterministically", async () => {
    const planner = createAgentGoalPlanner({
      chatClient: createFakeChatClient([
        {
          milestones: [
            {
              id: "milestone_a",
              description: "A",
              dependsOn: ["milestone_b"],
              successCriteria: [criterion],
            },
            {
              id: "milestone_b",
              description: "B",
              dependsOn: ["milestone_a"],
              successCriteria: [criterion],
            },
          ],
        },
      ]),
      modelProfile: fakeModelProfile,
      maxPlanAttempts: 1,
    });

    await expect(
      planner.plan("Create a cyclic plan", {
        successCriteria: [criterion],
        availableTools: [],
        availableSkills: [],
      }),
    ).rejects.toThrow("Goal milestone dependencies must not contain cycles.");
  });
});

const fakeModelProfile = {
  baseUrl: "http://model.local",
  apiKey: "test-key",
  model: "test-model",
  temperature: 0.2,
  maxTokens: 2000,
};

function createGoal(): Goal {
  return {
    id: "goal_1",
    description: "Prepare report.",
    successCriteria: [criterion],
    milestones: [
      {
        id: "milestone_done",
        description: "Already accepted.",
        dependsOn: [],
        successCriteria: [criterion],
        state: "accepted",
        runIds: ["run_done"],
        attempts: 1,
        lastAcceptanceSummary: "Accepted.",
      },
      {
        id: "milestone_remaining",
        description: "Needs replanning.",
        dependsOn: ["milestone_done"],
        successCriteria: [criterion],
        state: "rejected",
        runIds: ["run_remaining"],
        attempts: 1,
      },
    ],
    status: "executing",
    budget: {
      maxIterations: 8,
      maxToolCalls: 24,
      maxWallClockMs: 600_000,
      maxReplans: 2,
    },
    budgetUsage: {
      iterations: 1,
      toolCalls: 4,
      wallClockMs: 1000,
      tokens: 200,
      replans: 0,
    },
    reviewPolicy: "review_final_only",
    planVersion: 1,
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
  };
}

function createFakeChatClient(
  responses: Array<Record<string, unknown> | string>,
  requests: ChatCompletionRequest[] = [],
): ChatClient {
  let index = 0;

  return {
    async complete(request) {
      requests.push(request);
      const response = responses[index++];
      if (!response) {
        throw new Error("Unexpected model request.");
      }
      return {
        content: typeof response === "string" ? response : JSON.stringify(response),
        toolCalls: [],
        finishReason: "stop",
      };
    },
  };
}
