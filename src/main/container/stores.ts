import { PermissionRule, KernelRunStatus } from "../../shared/kernelContract";
import type { AppContainerOptions } from "../container";
import { createScheduledTaskStore } from "../taskStore";
import { createToolAuditLog } from "../toolAuditLog";
import { createModelConnectionService } from "../modelConnectionService";
import { createAgentValidationStore } from "../agentValidationStore";
export type StoresRuntime = {
  configDir: string;
  skillsDir: string;
  appMeta: unknown;
  options: AppContainerOptions;
  storage: () => Storage | null;
  storageBackend: () => "json" | "sqlite" | "dual";
  activeSqliteStorage: () => Storage | null;
  kernelRules: { value: PermissionRule[] };
  scheduledTaskStore: () => ReturnType<typeof createScheduledTaskStore>;
  toolAuditLog: () => ReturnType<typeof createToolAuditLog>;
  modelConnectionService: () => ReturnType<typeof createModelConnectionService>;
  agentValidationStore: () => ReturnType<typeof createAgentValidationStore>;
  modelSettingsStore: () => ModelSettingsStore;
  createToolExecutor: () => ReturnType<typeof createAgentToolExecutor>;
  processSandboxProvider: () => ReturnType<typeof createProcessSandboxProvider>;
  taskRuns: () => ReturnType<typeof createTaskRunRuntime>;
  planOps: () => ReturnType<typeof createPlanOpsRuntime>;
  emitGoalProgressEvent: (event: GoalProgressEvent) => void;
  disclosure: {
    loadConversationDisclosureReadSet: (scope: ConversationDisclosureScope, signal?: AbortSignal) => Promise<ConversationDisclosureAdapterReadSet>;
    authorizeConversationEvidenceTarget: (input: { target: ConversationEvidenceTarget; trustedContext: TrustedConversationEvidenceContext }) => boolean | Promise<boolean>;
    resolveConversationEvidence: (input: { target: ConversationEvidenceTarget; position: number; limit: number; expectedAuthorityRevision?: string | undefined; trustedContext: TrustedConversationEvidenceContext }) => Promise<ConversationEvidenceBackendResult>;
  };
};

import { createTaskRunRuntime } from "./taskRuns";
import { createPlanOpsRuntime } from "./planOps";
import { createDisclosureRuntime } from "./disclosure";
import { createChatSessionsRuntime } from "./chatSessions";
import {
  prepareInterruptedGoalForResume,
  milestoneDefinitionHash,
  defaultSelectedSkillInputValues,
  buildGoalSuccessCriteriaFromPlan,
  planStatusForExecutionGoal,
  formatAgentRunSessionStatus,
  formatAgentRunSessionPrompt,
  formatScheduledTaskRunResult,
  formatScheduledTaskRunPrompt,
  toolEvidenceCandidatesConflict,
  toolEvidenceSemanticFingerprint,
  toolEvidenceIdentityFingerprint,
  toolEvidenceCandidateFingerprint,
  evidenceTargetRunId,
  approvalReferencesRun,
  kernelObservationStatus,
  toolInvocationFromTrajectoryEvent,
  toolCandidatesConflict,
  toolInvocationFromWorkspaceEvent,
  causalRecordReferencesRun,
  reconcileIrreversibleGoalProgressEvent,
  isLivePlanReference,
} from "./helpers";
import { app, BrowserWindow, safeStorage } from "electron";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { createAgentExecutionStore, type AgentExecutionStore } from "../agentExecutionStore";
import { createAgentTrajectoryStore, type AgentTrajectoryStore } from "../agentTrajectoryStore";
import { createAgentLearningStore } from "../agentLearningStore";
import { createAgentLearningService } from "../agentLearningService";
import { createAgentEvalCandidateStore } from "../agentEvalCandidateStore";
import { createAgentEvalCandidateService } from "../agentEvalCandidateService";
import { createAgentWorkspaceStore } from "../agentWorkspaceStore";
import { createWorkspaceRunStore } from "../workspaceRunStore";
import { reconcileInterruptedToolApprovals } from "../interruptedToolApprovalReconciler";
import { WorkspaceRunEvent } from "../../shared/workspaceRunLedger";
import { createConversationCausalStore, type ConversationCausalStore } from "../conversationCausalStore";
import { createConversationDisclosureMaterializer, type ConversationDisclosureMaterializer } from "../conversationDisclosureMaterializer";
import { ConversationContextObservation, ConversationGoalLedgerRead, ConversationUsageObservation } from "../conversationDisclosureAdapters";
import { createConversationEvidenceResolver, type ConversationEvidenceBackendResult, type TrustedConversationEvidenceContext } from "../conversationEvidenceResolver";
import { createAgentGoalStore, type AgentGoalStore } from "../agentGoalStore";
import { createAgentGoalController } from "../agentGoalController";
import { createAgentGoalAcceptance, createBuiltinGoalAcceptanceValidators } from "../agentGoalAcceptance";
import { createAgentGoalValidatorRegistry, type AcceptanceValidator } from "../agentGoalValidatorRegistry";
import { createAgentGoalContext } from "../agentGoalContext";
import { createAgentGoalPlanner } from "../agentGoalPlanner";
import { createGoalRuntimeEngine } from "../goalRuntimeEngine";
import { resolveGoalExecutionModelBinding, selectPlanExecutionModelBinding, selectRuntimeDirectProfileId } from "../goalExecutionModel";
import { createAuthorizedGoalAcceptanceToolExecutor } from "../agentGoalAcceptanceToolExecutor";
import { applyGoalOutputRootsToRunContext } from "../goalOutputRoots";
import { createGoalChatService, type GoalChatService } from "../goalChatService";
import { createAgentGoalTranslator } from "../agentGoalTranslator";
import { createGoalDraftService } from "../goalDraftService";
import { createAgentWorkspaceService, type AgentWorkspaceService, type CreateGitWorktreeWorkspaceInput } from "../agentWorkspaceService";
import { createMultiAgentSessionStore } from "../multiAgentSessionStore";
import { createMultiAgentCoordinator } from "../multiAgentCoordinator";
import { createAgentEvalFixtures } from "../eval/agentEvalFixtures";
import { createCombinedAgentEvalFixtures, createPromotedAgentEvalFixtureStore } from "../eval/agentPromotedEvalFixtures";
import { runAgentEvals } from "../eval/agentEvalRunner";
import { createAgentRunStore, type AgentRunStore } from "../agentRunStore";
import { createAgentRunnerService, AgentModelProfile } from "../agentRunnerService";
import { runAgentLoop } from "../agentLoop";
import { createAgentBootstrapService } from "../agentBootstrapService";
import { createAgentToolExecutor } from "../agentToolExecutor";
import { createChatService } from "../chatService";
import { createChatSessionStore, type ChatSessionStore } from "../chatSessionStore";
import { createElectronSecretVault, createModelSettingsStore, type ModelSettingsStore } from "../modelSettingsStore";
import { providerSupportsEmbeddings } from "../providers/providerRegistry";
import { createMemoryStore, type MemoryEmbeddingService, type MemoryStore } from "../memoryStore";
import { createMemoryProfileStore } from "../memoryProfileStore";
import { createHistoryIndexStore } from "../historyIndexStore";
import { createMemoryIngestionService } from "../memoryIngestionService";
import { createToolResultOffloadStore, issueToolResultRefReadCapability, type ToolResultOffloadReadScope } from "../toolResultOffloadStore";
import { createOpenAiCompatibleClient, createOpenAiCompatibleEmbeddingClient, type ChatClient, type StreamingChatClient } from "../openAiCompatibleClient";
import { discoverSkills, collectSkillMcpConfigs, readTrustedSkillMcpAllowlist, shouldAutoInitializeSkillMcp } from "../skillRegistry";
import { McpClient } from "../mcpClient";
import { createSkillMcpClient } from "../skillMcpClient";
import { createMaxMode } from "../providers/maxMode";
import { createTaskSchedulerService } from "../taskSchedulerService";
import { getDefaultTaskPermissionPolicy } from "../../shared/toolPermissions";
import { KernelEventBus } from "../kernel/eventBus";
import { createProductionKernelDriver } from "../kernel/productionKernelDriver";
import { productionKernelCovers } from "../kernel/productionKernelScope";
import { createToolRuntime } from "../toolRuntime";
import { registerReadCodeTool } from "../readCodeTool";
import { requireStorageBackendAvailability, resolveStorageBackend } from "../storage/backendResolver";
import { bootstrapSqliteDomainAuthority } from "../storage/domainAuthorityBootstrap";
import { createProvider, resolveProviderBaseUrl } from "../providers/providerFactory";
import { createSettingsBackedChatClient } from "../providers/providerChatClient";
import { createModelRouter } from "../providers/modelRouter";
import { createPlanStore, PlanVersionConflictError } from "../planStore";
import { createPlanArtifactWriter } from "../planArtifactWriter";
import { createPlanDebateOrchestrator } from "../planDebateOrchestrator";
import { createPlanInvestigatorService } from "../planInvestigatorService";
import { createPlanQualityReport, derivePlanCriterionBindings } from "../plannerKernel";
import { resolveSkillInput } from "../skillExecutionService";
import { verifyPlanEvidence } from "../planEvidenceVerifier";
import {
  isPlanConfirmable,
  type AdoptGoalPlanInput,
  type AdoptGoalPlanResult,
  type ConfirmPlanInput,
  type ConfirmPlanResult,
  type CreateRuntimeGoalPlanResult,
  type GoalAmendmentOperationResult,
  type PlanArtifact,
  type PlanningStageKind,
  type PlanRecord,
  type PlanStatus,
  type ProposeGoalAmendmentInput,
} from "../../shared/planMode";
import {
  isGoalContractSnapshot,
  type GoalContractRef,
  type GoalContractSnapshot,
  type GoalPlanHistoryEntry,
  type GoalPlanRef,
} from "../../shared/goalPlanContract";
import { createGoalContractRef } from "../goalPlanContractService";
import { validatePlanMilestoneGraph } from "../../shared/planValidation";
import { toNormalized } from "../providers/normalize";
import { analyzeShell } from "../tools/shell/shellAnalyzer";
import { createToolWorker } from "../tools/toolWorker";
import { getToolWorkerOptions } from "../tools/toolWorkerOptions";
import { resolveCompactionFlag, selectCompactionStrategy } from "../kernel/compactionStrategy";
import { createContextManager } from "../contextManager";
import { replayContextSurface } from "../contextSurface";
import { createActorRuntime } from "../actors/actorRuntime";
import { createCheckpointWriterOrchestrator } from "../actors/checkpointWriterOrchestrator";
import { runCheckpointWriterActor } from "../actors/checkpointWriterActor";
import { createWorkflowActorHostHook, createWorkflowRuntime } from "../workflow/workflowRuntime";
import { registerDeepResearchWorkflow } from "../workflow/deepResearchWorkflow";
import { registerActorTool } from "../actors/actorTool";
import { readFeatureFlags } from "../../shared/featureFlags";
import { createCheckpointRepository } from "../storage/repositories/checkpointRepository";
import { createRunRepository, createTrajectoryRepository } from "../storage/repositories/runRepository";
import { createMemoryRepository } from "../storage/repositories/memoryRepository";
import { createSessionRepository } from "../storage/repositories/sessionRepository";
import { createSelfImprovementService } from "../actors/selfImprovementService";
import { createProcessSandboxProvider } from "../processSandbox";
import { runProductionStorageSmokeProbe } from "../productionSmokeStorage";
import { Storage } from "../../shared/storageContract";
import { createToolAuthorizationService, type ToolUserApprovalResult, type ToolUserApprovalRequest, type ToolUserApprovalRequestOptions } from "../toolAuthorizationService";
import { getAppMeta } from "../../shared/appMeta";
import { getNavigationSections } from "../../shared/navigation";
import {
  projectGoalStatusForInteraction,
  upgradeGoalAcceptanceProtocol,
  type Goal,
  type GoalBudget,
  type GoalSelectedSkill,
  type SuccessCriterion,
} from "../../shared/agentGoal";
import { verifySelectedSkillAuthority } from "../selectedSkillAuthority";
import { GoalReviewPolicy } from "../../shared/agentGoalReview";
import { compileAgentTaskContract } from "../../shared/agentTaskContract";
import { GoalDraftConfirmResult, GoalDraftDiscardResult, GoalDraft, GoalDraftEdit } from "../../shared/goalTranslation";
import {
  ChatSessionGoalSummary,
  ChatSessionListItem,
  ChatSessionOperationResult,
  ChatSessionRecord,
  ChatSessionTranscriptPage,
  ChatSessionTranscriptPageOptions,
  GoalProgressEvent,
} from "../../shared/chat";
import { getActiveGoalSummary, getRecoveryGoalSummary, isLiveGoalStatus } from "../../shared/chatSessionWork";
import { projectChatSessionTokenUsage } from "../chatSessionUsage";
import {
  AgentRunRevisionConflictError,
  resolveAgentRunExecutionRevision,
  type AgentRunAdmissionCandidate,
  type AgentRunEvent,
  type AgentRunRecord,
  type AgentRunStatus,
  type CancelScheduledTaskRunResult,
  type OpenAgentRunSessionResult,
  type PauseAgentRunResult,
  type RunScheduledTaskResult,
} from "../../shared/agentRuns";
import { createConversationRequestFingerprint, type ConversationCausalRecord, type ConversationAgentRunOwnerFact, type ToolApprovalIntent } from "../../shared/conversationCausalSpine";
import { describeSchedule, type ScheduledTask } from "../../shared/scheduledTasks";
import { isTerminalExecutionStatus, type AgentExecutionCheckpoint } from "../../shared/agentExecution";
import { createDefaultMemoryEvalCases, runMemoryEvals as evaluateMemory, type MemoryEvalReport } from "../../shared/memoryEval";
import { AgentEvalReport } from "../../shared/agentEval";
import { buildDesktopRuntimeInfo, type DesktopRuntimeInfo } from "../../shared/desktopRuntime";
import {
  extractToolResultRef,
  isSafeToolResultRef,
  summarizeToolResultContent,
  type ReadToolResultRefOptions,
  type ReadToolResultRefResult,
} from "../../shared/toolResultRefs";
import { projectChatSessionForTranscript } from "../../shared/chatSessionProjection";
import { ConversationDisclosureScope, ConversationEvidenceTarget } from "../../shared/conversationDisclosure";
import { ToolInvocationRecord } from "../../shared/toolInvocationLedger";

import { acceptanceContextNeedsModel, createModelProfileEmbeddingService } from "../container";
import type { ConversationDisclosureAdapterReadSet } from "../conversationDisclosureAdapters";
export function createStoresRuntime(rt: StoresRuntime) {
  const configDir = rt.configDir;
  const skillsDir = rt.skillsDir;
  const appMeta = rt.appMeta;
  const options = rt.options;
  const storage = rt.storage;
  const storageBackend = rt.storageBackend;
  const activeSqliteStorage = rt.activeSqliteStorage;
  const disclosure = rt.disclosure;
const scheduledTaskStore = rt.scheduledTaskStore;
const toolAuditLog = rt.toolAuditLog;
const modelConnectionService = rt.modelConnectionService;
const agentValidationStore = rt.agentValidationStore;
const emitGoalProgressEvent = rt.emitGoalProgressEvent;

const lazyStore = new Map<string, unknown>();

function lazy<T>(key: string, factory: () => T): T {
  if (!lazyStore.has(key)) {
    lazyStore.set(key, factory());
  }
  return lazyStore.get(key) as T;
}

function createToolExecutor() {
  return rt.createToolExecutor();
}

function processSandboxProvider() {
  return rt.processSandboxProvider();
}

  function toolAuthorizationService() {
    return lazy("toolAuthorizationService", () =>
      createToolAuthorizationService({
        taskStore: scheduledTaskStore(),
        auditLog: toolAuditLog(),
        permissionRules: () => rt.kernelRules.value,
        requestUserApproval: options.requestToolApproval,
        ...(options.policyDenyOverrideEnabled
          ? { policyDenyOverrideEnabled: options.policyDenyOverrideEnabled }
          : {}),
      }),
    );
  }

  function kernelEventBus() {
    return lazy("kernelEventBus", () => new KernelEventBus());
  }

  function productionKernelDriver(
    mode: "scheduled_task" | "chat" | "goal" = "scheduled_task",
  ) {
    if (!productionKernelCovers(
      readFeatureFlags().ZEROX_PRODUCTION_KERNEL,
      mode,
    )) {
      return undefined;
    }
    return lazy("productionKernelDriver", () =>
      createProductionKernelDriver({
        bus: kernelEventBus(),
      }),
    );
  }

  function chatProductionKernelDriver() {
    return productionKernelDriver("chat");
  }

  function goalProductionKernelDriver() {
    return productionKernelDriver("goal");
  }


  function agentRunStore() {
    return lazy("agentRunStore", () =>
      createAgentRunStore({ configDir, backend: storageBackend(), storage: activeSqliteStorage() ?? undefined }),
    );
  }

  function agentExecutionStore() {
    return lazy("agentExecutionStore", () =>
      createAgentExecutionStore({
        configDir,
        backend: storageBackend(),
        storage: activeSqliteStorage() ?? undefined,
      }),
    );
  }

  function agentTrajectoryStore() {
    return lazy("agentTrajectoryStore", () =>
      createAgentTrajectoryStore({ configDir, backend: storageBackend(), storage: activeSqliteStorage() ?? undefined }),
    );
  }

  function agentGoalStore() {
    return lazy("agentGoalStore", () =>
      createAgentGoalStore({
        configDir,
        backend: storageBackend(),
        storage: activeSqliteStorage() ?? undefined,
      }),
    );
  }

  function agentWorkspaceStore() {
    return lazy("agentWorkspaceStore", () =>
      createAgentWorkspaceStore({
        configDir,
        backend: storageBackend(),
        storage: activeSqliteStorage() ?? undefined,
      }),
    );
  }

  function workspaceRunStore() {
    return lazy("workspaceRunStore", () => createWorkspaceRunStore({ configDir }));
  }

  function conversationCausalStore() {
    return options.conversationCausalStore
      ?? lazy("conversationCausalStore", () =>
        createConversationCausalStore({ configDir }),
      );
  }

  function conversationDisclosureMaterializer() {
    return lazy("conversationDisclosureMaterializer", () =>
      createConversationDisclosureMaterializer({
        load: disclosure.loadConversationDisclosureReadSet,
      }));
  }

  function conversationEvidenceResolver() {
    return lazy("conversationEvidenceResolver", () =>
      createConversationEvidenceResolver({
        getCurrentSnapshot: async (scope) =>
          (await conversationDisclosureMaterializer().refresh(scope)).snapshot,
        canResolve: disclosure.authorizeConversationEvidenceTarget,
        backend: {
          resolve: disclosure.resolveConversationEvidence,
        },
      }));
  }

  function agentWorkspaceService() {
    return lazy("agentWorkspaceService", () =>
      createAgentWorkspaceService({
        workspaceStore: agentWorkspaceStore(),
        workspaceRoot: path.join(app.getPath("userData"), "workspaces"),
        consumeToolAuthorizationReceipt: (input) =>
          toolAuditLog().consumeAuthorizationReceipt(input),
      }),
    );
  }

  async function requestGitWorktreeAgentWorkspace(
    input: CreateGitWorktreeWorkspaceInput,
  ) {
    const canonicalInput = {
      name: input.name,
      repositoryRoot: path.resolve(input.repositoryRoot),
      branch: input.branch,
    };
    let createdWorkspace: Awaited<
      ReturnType<AgentWorkspaceService["createGitWorktreeWorkspace"]>
    > | null = null;
    const worktreeRuntime = createToolRuntime({
      authorizationService: toolAuthorizationService(),
      toolExecutor: {
        async execute(request, executionOptions) {
          const receipt = executionOptions?.authorizationReceipt;
          if (!receipt) {
            return {
              ok: false as const,
              error: "Git worktree dispatch is missing its authorization receipt.",
            };
          }
          createdWorkspace = await agentWorkspaceService().createGitWorktreeWorkspace({
            name: String(request.args.name ?? ""),
            repositoryRoot: String(request.args.repositoryRoot ?? ""),
            branch: String(request.args.branch ?? ""),
            approval: {
              kind: "tool_authorization_receipt",
              auditEventId: receipt.auditEventId,
            },
          });
          return {
            ok: true as const,
            result: { workspaceId: createdWorkspace.id },
          };
        },
      },
    });
    const outcome = await worktreeRuntime.execute({
      taskId: "agent_workspaces",
      request: {
        toolName: "git_worktree_add",
        args: {
          name: canonicalInput.name,
          repositoryRoot: canonicalInput.repositoryRoot,
          branch: canonicalInput.branch,
        },
      },
      authorizationOptions: {
        runtimeTask: {
          name: "Create Git worktree workspace",
          permissions: getDefaultTaskPermissionPolicy(),
          policyLabel: "Git worktree creation authority",
        },
      },
    });

    if (!outcome.result.ok) {
      throw new Error(outcome.result.error);
    }
    if (!createdWorkspace) {
      throw new Error("Git worktree dispatch completed without a workspace result.");
    }
    return createdWorkspace;
  }

  function multiAgentSessionStore() {
    return lazy("multiAgentSessionStore", () =>
      createMultiAgentSessionStore({
        configDir,
        backend: storageBackend(),
        storage: activeSqliteStorage() ?? undefined,
      }),
    );
  }

  function planStore() {
    return lazy("planStore", () =>
      createPlanStore({
        configDir,
        ...(activeSqliteStorage()
          ? { storage: activeSqliteStorage()! }
          : {}),
      }),
    );
  }

  function planArtifactWriter() {
    return lazy("planArtifactWriter", () => createPlanArtifactWriter());
  }

  function planDebateOrchestrator() {
    return lazy("planDebateOrchestrator", () =>
      createPlanDebateOrchestrator({
        planStore: planStore(),
        artifactWriter: planArtifactWriter(),
        modelRouter: modelRouter(),
        investigator: createPlanInvestigatorService({
          toolExecutor: createToolExecutor(),
          toolAuthorizationService: toolAuthorizationService(),
          discoverSkills: () => discoverSkills({ skillsDir, forceRefresh: true }),
        }),
        discoverSkills: () => discoverSkills({ skillsDir, forceRefresh: true }),
        availableToolNames: () =>
          createToolExecutor()
            .getRegistry()
            .getDefinitions()
            .map((definition) => definition.function.name),
        availableAcceptanceKinds: () =>
          agentGoalValidatorRegistry().listKinds(),
        enableDirectReview: true,
        processSandbox: processSandboxProvider(),
      }),
    );
  }

  function memoryProfileStore() {
    return lazy("memoryProfileStore", () =>
      createMemoryProfileStore({ configDir, backend: storageBackend(), storage: activeSqliteStorage() ?? undefined }),
    );
  }

  function toolResultOffloadStore() {
    return lazy("toolResultOffloadStore", () => createToolResultOffloadStore({ configDir }));
  }

  function agentLearningStore() {
    return lazy("agentLearningStore", () =>
      createAgentLearningStore({
        configDir,
        backend: storageBackend(),
        storage: activeSqliteStorage() ?? undefined,
      }),
    );
  }

  function agentEvalCandidateStore() {
    return lazy("agentEvalCandidateStore", () =>
      createAgentEvalCandidateStore({
        configDir,
        backend: storageBackend(),
        storage: activeSqliteStorage() ?? undefined,
      }),
    );
  }

  function promotedAgentEvalFixtureStore() {
    return lazy("promotedAgentEvalFixtureStore", () =>
      createPromotedAgentEvalFixtureStore({
        configDir,
        backend: storageBackend(),
        storage: activeSqliteStorage() ?? undefined,
      }),
    );
  }

  function chatSessionStore() {
    return lazy("chatSessionStore", () => {
      const sqlite = storage();
      if (sqlite) {
        return createChatSessionStore({
          configDir,
          backend: "sqlite",
          storage: sqlite,
        });
      }
      // SQLite open failure is the only runtime degradation path. The legacy
      // JSON store remains available without pretending parity succeeded.
      return createChatSessionStore({ configDir, backend: "json" });
    });
  }

  function memoryStore() {
    return lazy("memoryStore", () =>
      createMemoryStore({
        configDir,
        backend: storageBackend(),
        storage: activeSqliteStorage() ?? undefined,
        embeddingService: createModelProfileEmbeddingService({
          modelSettingsStore: rt.modelSettingsStore(),
        }),
      }),
    );
  }

  function historyIndexStore() {
    return lazy("historyIndexStore", () =>
      createHistoryIndexStore({
        filePath: path.join(configDir, "raw-history.jsonl"),
      }),
    );
  }

  function agentLearningService() {
    return lazy("agentLearningService", () =>
      createAgentLearningService({
        learningStore: agentLearningStore(),
        memoryStore: memoryStore(),
      }),
    );
  }

  function agentEvalCandidateService() {
    return lazy("agentEvalCandidateService", () =>
      createAgentEvalCandidateService({
        runStore: agentRunStore(),
        trajectoryStore: agentTrajectoryStore(),
        candidateStore: agentEvalCandidateStore(),
        promotedFixtureStore: promotedAgentEvalFixtureStore(),
      }),
    );
  }

  function multiAgentCoordinator() {
    return lazy("multiAgentCoordinator", () =>
      createMultiAgentCoordinator({
        sessionStore: multiAgentSessionStore(),
        trajectoryStore: agentTrajectoryStore(),
      }),
    );
  }

  function taskSchedulerService() {
    return lazy("taskSchedulerService", () =>
      createTaskSchedulerService({
        taskStore: scheduledTaskStore(),
        runScheduledTask: (taskId: string) => rt.taskRuns().runAgentTask(taskId),
        async listActiveTaskIds() {
          return new Set(
            (await agentExecutionStore().listActive()).map(
              (checkpoint) => checkpoint.taskId,
            ),
          );
        },
      }),
    );
  }

  async function getModelProfile() {
    if (options.modelProfileOverride) {
      return structuredClone(options.modelProfileOverride);
    }
    const resolved = await rt.modelSettingsStore().resolveProfile();
    return toRuntimeModelProfile(resolved);
  }

  function toRuntimeModelProfile(
    resolved: Awaited<ReturnType<ModelSettingsStore["resolveProfile"]>>,
  ) {
    const apiKey =
      resolved.secrets.apiKey ??
      resolved.secrets.bedrockApiKey ??
      resolved.secrets.vertexApiKey ??
      "";
    const baseUrl = resolveProviderBaseUrl(
      resolved.binding.providerKind,
      resolved.connectionValues,
    );

    return {
      baseUrl: baseUrl ?? "",
      apiKey,
      model: resolved.binding.modelId,
      providerId: resolved.binding.providerKind,
      profile: resolved.binding.profileId,
      temperature: resolved.binding.generation.temperature,
      maxTokens: resolved.binding.generation.maxTokens,
      ...(resolved.binding.contextWindow
        ? { contextWindow: resolved.binding.contextWindow }
        : {}),
      ...(resolved.binding.contextWindowSource
        ? { contextWindowSource: { ...resolved.binding.contextWindowSource } }
        : {}),
      thinking: resolved.binding.generation.thinkingEnabled
        ? {
            type: "enabled" as const,
            budgetTokens:
              resolved.binding.generation.thinkingBudgetTokens,
          }
        : { type: "disabled" as const },
      modelCapabilities: { ...resolved.binding.capabilities },
    };
  }

  async function resolveGoalModelSettings(goal: Goal) {
    const binding = await resolveGoalExecutionModelBinding(
      goal,
      (planId) => planStore().get(planId),
    );
    return binding
      ? rt.modelSettingsStore().resolveBinding(binding)
      : rt.modelSettingsStore().resolveProfile();
  }

  async function getGoalModelProfile(goal: Goal) {
    if (options.modelProfileOverride) {
      return structuredClone(options.modelProfileOverride);
    }
    return toRuntimeModelProfile(await resolveGoalModelSettings(goal));
  }

  function goalChatClient(goal: Goal) {
    if (options.chatClientOverride) return options.chatClientOverride;
    return createSettingsBackedChatClient({
      loadSettings: () => rt.modelSettingsStore().load(),
      getApiKey: () => rt.modelSettingsStore().getApiKey(),
      resolveProfile: () => resolveGoalModelSettings(goal),
      fallback: createOpenAiCompatibleClient(),
    });
  }

  async function getGoalProvider(goal: Goal) {
    const resolved = await resolveGoalModelSettings(goal);
    const apiKey =
      resolved.secrets.apiKey ??
      resolved.secrets.bedrockApiKey ??
      resolved.secrets.vertexApiKey ??
      "";
    return createProvider({
      providerKind: resolved.binding.providerKind,
      apiKey,
      chatModel: resolved.binding.modelId,
      baseUrl: resolveProviderBaseUrl(
        resolved.binding.providerKind,
        resolved.connectionValues,
      ),
      connectionValues: resolved.connectionValues,
      secrets: resolved.secrets,
      thinkingEnabled: resolved.binding.generation.thinkingEnabled,
      thinkingBudgetTokens:
        resolved.binding.generation.thinkingBudgetTokens,
    });
  }

  // P3 provider abstraction. Returns the LLMProvider for the current model
  // settings (dispatched by `providerId`, default `openai-compatible`). P5
  // (checkpoint-writer fork agent) and P8 (streaming/max-mode) consume this.
  // Existing ChatClient consumers are unchanged (gradual migration via the
  // ProviderChatClient adapter — zero regression).
  function chatClient() {
    if (options.chatClientOverride) return options.chatClientOverride;
    // Settings-backed: openai-compatible (default) routes to the raw client
    // (byte-identical to legacy); anthropic/gemini route to a native provider.
    return lazy("chatClient", () =>
      createSettingsBackedChatClient({
        loadSettings: () => rt.modelSettingsStore().load(),
        getApiKey: () => rt.modelSettingsStore().getApiKey(),
        resolveProfile: () => rt.modelSettingsStore().resolveProfile(),
        fallback: createOpenAiCompatibleClient(),
      }),
    );
  }

  async function getProvider() {
    const resolved = await rt.modelSettingsStore().resolveProfile();
    const apiKey =
      resolved.secrets.apiKey ??
      resolved.secrets.bedrockApiKey ??
      resolved.secrets.vertexApiKey ??
      "";
    return createProvider({
      providerKind: resolved.binding.providerKind,
      apiKey,
      chatModel: resolved.binding.modelId,
      baseUrl: resolveProviderBaseUrl(
        resolved.binding.providerKind,
        resolved.connectionValues,
      ),
      connectionValues: resolved.connectionValues,
      secrets: resolved.secrets,
      thinkingEnabled: resolved.binding.generation.thinkingEnabled,
      thinkingBudgetTokens:
        resolved.binding.generation.thinkingBudgetTokens,
    });
  }

  function modelRouter() {
    return lazy("modelRouter", () =>
      createModelRouter({
        modelSettingsStore: rt.modelSettingsStore(),
        fallback: createOpenAiCompatibleClient(),
      }),
    );
  }

  // P4 shell analyzer + tool worker. Exposed for P5 (checkpoint-writer fork
  // agent) and P6 (actor isolation) to consume. ZEROX_TOOL_WORKER controls the
  // isolation mode while keeping explicit in-process mode available for
  // development and focused tests.
  function shellAnalyzer() {
    return { analyze: analyzeShell };
  }

  function toolWorker() {
    return lazy("toolWorker", () => {
      const opts = getToolWorkerOptions();
      return createToolWorker({ mode: opts.worker });
    });
  }

  // P2 context rebuild. Repositories + compaction strategy selector are exposed
  // for the runtime loops to consume (activation cutover lands with P5, when
  // markdown checkpoints exist; default `auto` degrades to summarize = current
  // behavior, so wiring is zero-regression).
  function checkpointRepository() {
    return lazy("checkpointRepository", () => {
      const s = activeSqliteStorage();
      return s ? createCheckpointRepository(s) : null;
    });
  }

  function memoryRepository() {
    return lazy("memoryRepository", () => {
      const s = activeSqliteStorage();
      return s ? createMemoryRepository(s) : null;
    });
  }

  function compactionStrategy() {
    return lazy("compactionStrategy", () => {
      const flag = resolveCompactionFlag();
      const orchestrator = checkpointWriterOrchestrator();
      return selectCompactionStrategy(flag, {
        contextManager: createContextManager(),
        ...(checkpointRepository() ? { checkpointRepository: checkpointRepository()! } : {}),
        ...(memoryRepository() ? { memoryRepository: memoryRepository()! } : {}),
        // P5: trigger the fork-agent checkpoint writer before a rebuild so a
        // fresh markdown checkpoint exists. Adapter converts ChatMessage[] →
        // NormalizedMessage[] for the orchestrator.
        ...(orchestrator
          ? {
              checkpointWriter: {
                async maybeWriteCheckpoint(input: { parentRunId: string; parentMessages: import("../openAiCompatibleClient").ChatMessage[] }) {
                  return orchestrator.maybeWriteCheckpoint({
                    parentRunId: input.parentRunId,
                    parentMessages: toNormalized(input.parentMessages),
                  });
                },
              },
            }
          : {}),
      });
    });
  }

  // P5 actor runtime + checkpoint-writer orchestrator. Exposed for P6 (actor
  // model extends this v0) and P8 (max-mode replay via actor). The fork-agent
  // writer is wired but not yet triggered from the runtime loops (activation
  // cutover is incremental; default flag `p5-fork` is honored when triggered).
  function runRepository() {
    return lazy("runRepository", () => {
      const s = activeSqliteStorage();
      return s ? createRunRepository(s) : null;
    });
  }

  function actorRuntime() {
    return lazy("actorRuntime", () =>
      createActorRuntime({
        ...(activeSqliteStorage() ? { storage: activeSqliteStorage()! } : {}),
        deps: {
          runActor: async (input, forkContext, cancel) => {
            const s = activeSqliteStorage();
            if (!s) return { status: "error", summary: "no storage", filesTouched: [] };
            return runCheckpointWriterActor(input, forkContext, cancel, {
              runRepository: createRunRepository(s),
              checkpointRepository: createCheckpointRepository(s),
            });
          },
        },
      }),
    );
  }

  function checkpointWriterOrchestrator() {
    return lazy("checkpointWriterOrchestrator", () => {
      const s = activeSqliteStorage();
      if (!s) return null;
      return createCheckpointWriterOrchestrator({
        storage: s,
        runRepository: createRunRepository(s),
        checkpointRepository: createCheckpointRepository(s),
      });
    });
  }

  // P6 workflow runtime. The built-in workflow is retained for explicit
  // experiments, but network host hooks fail closed until they share the normal
  // permission and outbound-policy path. The tool is therefore not registered.
  function workflowRuntime() {
    return lazy("workflowRuntime", () => {
      if (readFeatureFlags().ZEROX_WORKFLOW_RUNTIME !== "on") {
        throw new Error(
          "Workflow runtime is disabled until permissioned network hooks are configured.",
        );
      }
      const spawnActor = createWorkflowActorHostHook(actorRuntime());
      const rt = createWorkflowRuntime({
        spawnActor,
        async webfetch() {
          throw new Error("Workflow webfetch is unavailable until permission wiring is configured.");
        },
        async websearch() {
          throw new Error("Workflow websearch is unavailable until permission wiring is configured.");
        },
      });
      registerDeepResearchWorkflow(rt.register.bind(rt));
      return rt;
    });
  }

  // P7: self-improvement scheduler (dream + distill). Default OFF
  // (ZEROX_SELF_IMPROVEMENT=off) — background LLM cost; users opt in. Wired
  // alongside the memory-maintenance timer; runNow() supports /dream /distill.
  function sessionRepository() {
    return lazy("sessionRepository", () => {
      const s = activeSqliteStorage();
      return s ? createSessionRepository(s) : null;
    });
  }

  function selfImprovementService() {
    return lazy("selfImprovementService", () => {
      const flags = readFeatureFlags();
      if (
        flags.ZEROX_SELF_IMPROVEMENT !== "on" ||
        flags.ZEROX_WORKFLOW_RUNTIME !== "on"
      ) {
        return null;
      }
      const s = activeSqliteStorage();
      if (!s) return null;
      return createSelfImprovementService({
        storage: s,
        memoryRepository: createMemoryRepository(s),
        runRepository: createRunRepository(s),
        trajectoryRepository: createTrajectoryRepository(s),
        sessionRepository: createSessionRepository(s),
        workflowRuntime: workflowRuntime(),
        skillsDir,
      });
    });
  }

  function agentBootstrapService() {
    return lazy("agentBootstrapService", () =>
      createAgentBootstrapService({
        modelSettingsStore: rt.modelSettingsStore(),
        taskStore: scheduledTaskStore(),
        discoverSkills: () => discoverSkills({ skillsDir, forceRefresh: true }),
        testModelConnection: () => modelConnectionService().testConnection(),
        runScheduledTask: (taskId: string) =>
          rt.taskRuns().runAgentTask(taskId, { writeChatTranscript: false }),
        validationStore: agentValidationStore(),
      }),
    );
  }

  function agentRunnerService() {
    return lazy("agentRunnerService", () => {
      const maxModeActorRuntime = activeSqliteStorage() ? actorRuntime() : undefined;
      return createAgentRunnerService({
        taskStore: scheduledTaskStore(),
        runStore: agentRunStore(),
        resolveSkill: async (skillName: string) => {
          const result = await discoverSkills({ skillsDir, forceRefresh: true });
          return (
            result.skills.find((skill) => skill.manifest.name === skillName) ?? null
          );
        },
        chatClient: chatClient(),
        getModelProfile,
        toolAuthorizationService: toolAuthorizationService(),
        toolExecutor: createToolExecutor(),
        executionStore: agentExecutionStore(),
        workspaceService: agentWorkspaceService(),
        trajectoryStore: agentTrajectoryStore(),
        learningStore: agentLearningStore(),
        memoryStore: memoryStore(),
        toolResultOffloadStore: toolResultOffloadStore(),
        compactionStrategy: compactionStrategy(),
        // P8: max-mode (best-of-N) — opt-in via ZEROX_MAX_MODE. runStep
        // resolves the provider lazily on first call (getProvider is async).
        maxMode: {
          async runStep(req, opts) {
            const provider = await getProvider();
            return createMaxMode(provider).runStep(req, opts);
          },
        },
        ...(maxModeActorRuntime
          ? { actorRuntimeForMaxMode: maxModeActorRuntime }
          : {}),
        runAgentLoop,
        ...(productionKernelDriver()
          ? {
              productionKernelDriver:
                productionKernelDriver()!,
            }
          : {}),
      });
    });
  }

  function agentGoalValidatorRegistry() {
    return lazy("agentGoalValidatorRegistry", () =>
      createAgentGoalValidatorRegistry({
        validators: [
          ...createBuiltinGoalAcceptanceValidators(),
          ...(options.acceptanceValidators ?? []),
        ],
      }),
    );
  }

  function agentGoalAcceptance() {
    return lazy("agentGoalAcceptance", () =>
      createAgentGoalAcceptance({ registry: agentGoalValidatorRegistry() }),
    );
  }

  function agentGoalController() {
    return lazy("agentGoalController", () => {
      const toolExecutor = createToolExecutor();
      let sequence = 0;
      const nextGoalTrajectorySequence = () => {
        sequence += 1;
        return sequence;
      };

      return createAgentGoalController({
        goalStore: agentGoalStore(),
        runtimeEngine: createGoalRuntimeEngine({
          workspaceService: agentWorkspaceService(),
          chatClient: chatClient(),
          getChatClient: goalChatClient,
          getModelProfile: getGoalModelProfile,
          toolExecutor,
          toolAuthorizationService: toolAuthorizationService(),
          runStore: agentRunStore(),
          trajectoryStore: agentTrajectoryStore(),
          toolResultOffloadStore: toolResultOffloadStore(),
          goalContext: createAgentGoalContext({
            trajectoryStore: {
              append(runId, event, appendOptions) {
                const store = agentTrajectoryStore();
                return store.appendNext
                  ? store.appendNext(runId, event, appendOptions)
                  : store.append(runId, event, appendOptions);
              },
            },
            createId: () => `goal_context_${randomUUID()}`,
            now: () => new Date().toISOString(),
          }),
          createId: () => `goal_run_${randomUUID()}`,
          nextSequence: nextGoalTrajectorySequence,
          now: () => new Date().toISOString(),
          onProgress: emitGoalProgressEvent,
          ...(goalProductionKernelDriver()
            ? {
                productionKernelDriver:
                  goalProductionKernelDriver()!,
              }
            : {}),
          maxMode: {
            async runStep(req, opts) {
              const provider = await getProvider();
              return createMaxMode(provider).runStep(req, opts);
            },
          },
          getMaxMode: async (goal) =>
            createMaxMode(await getGoalProvider(goal)),
          resolveSelectedSkill: async (goal) => {
            const skillAuthority = verifySelectedSkillAuthority({
              selectedSkill: goal.selectedSkill,
              discoveredSkills: (
                await discoverSkills({ skillsDir, forceRefresh: true })
              ).skills,
            });
            if (!skillAuthority.ok) {
              throw new Error(
                skillAuthority.reason === "missing"
                  ? "Goal 绑定的 Skill 已不存在，请重新规划。"
                  : "Goal 绑定的 Skill 快照已漂移，请重新规划。",
              );
            }
            if (skillAuthority.selectedSkill) {
              const runContext = await agentWorkspaceService().resolveRunContext({
                workspaceId: goal.workspaceId,
                ...(goal.chatSessionId
                  ? { sessionId: goal.chatSessionId }
                  : {}),
              });
              const inputResolution = resolveSkillInput({
                skill: skillAuthority.selectedSkill,
                values: goal.selectedSkillInputValues,
                runContext,
              });
              if (inputResolution.status !== "complete") {
                throw new Error(
                  "Goal 绑定的 Skill 输入缺失或已失效，请重新规划。",
                );
              }
            }
            return skillAuthority.selectedSkill;
          },
          onEvent(event) {
            for (const window of BrowserWindow.getAllWindows()) {
              if (!window.isDestroyed()) {
                window.webContents.send("goal:milestoneRunEvent", event);
              }
            }
          },
        }),
        acceptance: agentGoalAcceptance(),
        onProgress: emitGoalProgressEvent,
        onActiveGoalChange: options.setGoalActive,
        planner: {
          async replan(goal, reason) {
            return createAgentGoalPlanner({
              chatClient: goalChatClient(goal),
              modelProfile: await getGoalModelProfile(goal),
            }).replan(goal, reason);
          },
        },
        trajectoryStore: agentTrajectoryStore(),
        createAcceptanceContext: async (goal, milestone, runResult) => {
          const modelProfile = acceptanceContextNeedsModel(goal, milestone)
            ? await getGoalModelProfile(goal)
            : undefined;
          const runContext = applyGoalOutputRootsToRunContext(
            await agentWorkspaceService().resolveRunContext({
              workspaceId: goal.workspaceId,
              ...(goal.chatSessionId ? { sessionId: goal.chatSessionId } : {}),
            }),
            goal,
          );
          const acceptedMilestones = goal.milestones
            .filter(
              (candidate) =>
                candidate.state === "accepted" || candidate.state === "skipped",
            )
            .map((candidate) => ({
              id: candidate.id,
              description: candidate.description,
              state: candidate.state,
              summary:
                candidate.lastAcceptanceSummary ?? candidate.lastRunSummary ?? null,
              runIds: candidate.runIds,
            }));
          const currentMilestone = milestone
            ? {
                id: milestone.id,
                description: milestone.description,
                state: milestone.state,
                status: milestone.lastRunStatus ?? null,
                summary: milestone.lastRunSummary ?? null,
                acceptanceSummary: milestone.lastAcceptanceSummary ?? null,
                runIds: milestone.runIds,
              }
            : null;
          return {
            runId: milestone?.runIds.at(-1) ?? goal.id,
            goalId: goal.id,
            ...(milestone ? { milestoneId: milestone.id } : {}),
            workspacePath: runContext.workspaceRoot,
            extraReadRoots: runContext.sandbox.extraReadRoots,
            extraWriteRoots: runContext.sandbox.extraWriteRoots,
            toolExecutor: createAuthorizedGoalAcceptanceToolExecutor({
              taskId: `goal_acceptance:${goal.id}:${milestone?.id ?? "final"}`,
              goal,
              runContext,
              toolExecutor,
              toolAuthorizationService: toolAuthorizationService(),
            }),
            trajectoryStore: {
              append(runId, event, appendOptions) {
                const store = agentTrajectoryStore();
                return store.appendNext
                  ? store.appendNext(runId, event, appendOptions)
                  : store.append(runId, event, appendOptions);
              },
            },
            ...(modelProfile
              ? {
                  chatClient: goalChatClient(goal),
                  modelProfile,
                }
              : {}),
            transcriptMessages:
              runResult?.transcriptMessages ??
              goal.runtimeCheckpoint?.transcriptMessages,
            artifacts: {
              goalEvidence: {
                condition: goal.description,
                status: goal.status,
                currentMilestone,
                acceptedMilestones,
                progress: {
                  acceptedCount: acceptedMilestones.length,
                  totalCount: goal.milestones.length,
                  allMilestonesAccepted:
                    goal.milestones.length > 0 &&
                    acceptedMilestones.length === goal.milestones.length,
                },
              },
              milestoneProgress: {
                hasRun: Boolean(
                  milestone?.runIds.length &&
                    (milestone.lastRunStatus ?? "succeeded") === "succeeded",
                ),
                runCount: milestone?.runIds.length ?? 0,
                status: milestone?.lastRunStatus ?? null,
                summary: milestone?.lastRunSummary ?? null,
              },
              goalProgress: {
                acceptedCount: goal.milestones.filter(
                  (candidate) =>
                    candidate.state === "accepted" || candidate.state === "skipped",
                ).length,
                totalCount: goal.milestones.length,
                allMilestonesAccepted:
                  goal.milestones.length > 0 &&
                  goal.milestones.every(
                    (candidate) =>
                      candidate.state === "accepted" || candidate.state === "skipped",
                  ),
              },
            },
          };
        },
        createId: () => `goal_event_${randomUUID()}`,
        nextSequence: nextGoalTrajectorySequence,
        now: () => new Date().toISOString(),
      });
    });
  }

  function goalChatService() {
    return lazy("goalChatService", () =>
      createGoalChatService({
        controller: agentGoalController(),
        goalStore: agentGoalStore(),
        planner: {
          async plan(description, planOptions) {
            const availableTools = dedupeStrings([
              ...planOptions.availableTools,
              ...getAvailableToolNames(),
            ]);
            return createAgentGoalPlanner({
              chatClient: chatClient(),
              modelProfile: await getModelProfile(),
            }).plan(description, {
              ...planOptions,
              availableTools,
            });
          },
          async replan(goal, reason) {
            return createAgentGoalPlanner({
              chatClient: chatClient(),
              modelProfile: await getModelProfile(),
            }).replan(goal, reason);
          },
        },
        getAvailableTools: getAvailableToolNames,
        onProgress: emitGoalProgressEvent,
        onDiagnostic(event) {
          console.warn(`[goal:${event.phase}] ${event.message}`, event.error);
        },
      }),
    );
  }

  function agentGoalTranslator() {
    return lazy("agentGoalTranslator", () =>
      createAgentGoalTranslator({
        chatClient: chatClient(),
        getModelProfile,
        onDiagnostic(event) {
          console.warn(`[goal:translation] ${event.message}`, event.error);
        },
      }),
    );
  }

  function goalDraftService() {
    return lazy("goalDraftService", () =>
      createGoalDraftService({
        translator: agentGoalTranslator(),
      }),
    );
  }

  function getAvailableToolNames(): string[] {
    return createToolExecutor()
      .getRegistry()
      .getDefinitions()
      .map((definition) => definition.function.name);
  }

  function dedupeStrings(values: string[]): string[] {
    return [...new Set(values)];
  }

  function chatService() {
    return lazy("chatService", () =>
      createChatService({
        chatClient: chatClient(),
        getModelProfile,
        memoryStore: memoryStore(),
        memoryProfileStore: memoryProfileStore(),
        chatSessionStore: chatSessionStore(),
        goalService: goalChatService(),
        goalDraftService: goalDraftService(),
        planService: planDebateOrchestrator(),
        proposeGoalAmendment: rt.planOps().proposeGoalObjectiveAmendment,
        runtimeReplanGoal: rt.planOps().createRuntimeGoalPlan,
        taskStore: scheduledTaskStore(),
        runScheduledTask: (taskId: string, taskRunOptions) =>
          rt.taskRuns().runAgentTask(taskId, {
            ...taskRunOptions,
            writeChatTranscript: false,
          }),
        discoverSkills: () => discoverSkills({ skillsDir, forceRefresh: true }),
        workspaceService: agentWorkspaceService(),
        toolExecutor: createToolExecutor(),
        toolAuthorizationService: toolAuthorizationService(),
        trajectoryStore: agentTrajectoryStore(),
        workspaceRunStore: workspaceRunStore(),
        conversationCausalStore: conversationCausalStore(),
        historyIndexStore: historyIndexStore(),
        toolResultOffloadStore: toolResultOffloadStore(),
        compactionStrategy: compactionStrategy(),
        ...(chatProductionKernelDriver()
          ? {
              productionKernelDriver:
                chatProductionKernelDriver()!,
            }
          : {}),
        maxMode: {
          async runStep(req, opts) {
            const provider = await getProvider();
            return createMaxMode(provider).runStep(req, opts);
          },
        },
      }),
    );
  }

  function memoryIngestionService() {
    return lazy("memoryIngestionService", () =>
      createMemoryIngestionService({
        configDir,
        historyIndexStore: historyIndexStore(),
        memoryStore: memoryStore(),
        chatSessionStore: chatSessionStore(),
        chatClient: chatClient(),
        getModelProfile,
      }),
    );
  }

  let runtimeShuttingDown = false;
  let mcpInitializationPromise: Promise<void> | null = null;
  let mcpInitializationTail: Promise<void> = Promise.resolve();

  return {
    toolAuthorizationService,
    kernelEventBus,
    productionKernelDriver,
    chatProductionKernelDriver,
    goalProductionKernelDriver,
    agentRunStore,
    agentExecutionStore,
    agentTrajectoryStore,
    agentGoalStore,
    agentWorkspaceStore,
    workspaceRunStore,
    conversationCausalStore,
    conversationDisclosureMaterializer,
    conversationEvidenceResolver,
    agentWorkspaceService,
    requestGitWorktreeAgentWorkspace,
    multiAgentSessionStore,
    planStore,
    planArtifactWriter,
    planDebateOrchestrator,
    memoryProfileStore,
    toolResultOffloadStore,
    agentLearningStore,
    agentEvalCandidateStore,
    promotedAgentEvalFixtureStore,
    chatSessionStore,
    memoryStore,
    historyIndexStore,
    agentLearningService,
    agentEvalCandidateService,
    multiAgentCoordinator,
    taskSchedulerService,
    getModelProfile,
    toRuntimeModelProfile,
    resolveGoalModelSettings,
    getGoalModelProfile,
    goalChatClient,
    getGoalProvider,
    chatClient,
    getProvider,
    modelRouter,
    shellAnalyzer,
    toolWorker,
    checkpointRepository,
    memoryRepository,
    compactionStrategy,
    runRepository,
    actorRuntime,
    checkpointWriterOrchestrator,
    workflowRuntime,
    sessionRepository,
    selfImprovementService,
    agentBootstrapService,
    agentRunnerService,
    agentGoalValidatorRegistry,
    agentGoalAcceptance,
    agentGoalController,
    goalChatService,
    agentGoalTranslator,
    goalDraftService,
    getAvailableToolNames,
    dedupeStrings,
    chatService,
    memoryIngestionService,
  };
}
