export const conversationDisclosureScenarioDigests = {
  "S01-default-narrative": "sha256:812a9c61836bd4c33b5d8b518cfc3390b8e2db929ad3d78aea5beff68bd4a8d0",
  "S02-inline-expansion": "sha256:77db761fce99867af81da1cdae159c0fd6ba0106b5253825f4cdbddaf95d365b",
  "S03-evidence-handoff": "sha256:8040007dfb92f72b8b2e3a305cf2e705ce8a7ed80e7fd5c0907c06743cad125c",
  "S04-failure-attention": "sha256:9c7eb05998e2d24ecc2a53e27d8dfce91df3d7d5f84d54085f0dea50bcd37d00",
  "S05-approval-attention": "sha256:fc382536c2750c9ae7fc17b392e2847dc96f757f9a5da3076dd8766ab405eb33",
  "S06-pause-reload-recovery": "sha256:735d4a84adf2b87e2081d1a81638aaf9a96d79b5b6328f3c9cf6a6516d9a98ed",
  "S07-plan-progress": "sha256:93e611cabbd360e91c44b9ec2a70377013c1a8140c77a2d97e18fbcf3be5b7e0",
  "S08-scheduled-progress": "sha256:d6f3755be71fea9927b72ba5edef0f4a1a7b0e721accf24ac278843d53143bda",
  "S09-long-session": "sha256:391645bd0c600e15825713b417f169204e755588942cde863dd80d527b095ae8",
  "S10-accessibility": "sha256:3fdfc7cd9183c89b18b5cb2771543213dfe031e31abcf33f86c2e8d9a4b09065",
  "S11-secret-safety": "sha256:fb5a934c402bab785183e9942ecedb507b770458fd42a218f47ea61c0837b233",
  "S12-retry-attempt": "sha256:49d4fb731a204d7b797ede14668b357e45234789b55325523987a21b05d43ef7",
  "S13-legacy-coverage": "sha256:1da0ad6ff0d434ad92845f1cea5d528fd01a1737ad0f443d1c45ef43687cf53f",
  "S14-guided-input": "sha256:3c9874af0ecbbb0423379639f72878eaf8861332e3c49791c79eb05abfc98dfd",
  "S15-goal-acceptance": "sha256:bb3c64effbd049e402244e4e26203a037d7fb43fb4d509cb17077874a0a4e7af",
  "S16-plan-confirmation": "sha256:b629d2c39b858f620076e3b26976ba7261d6f4d04db51565df665f1ff1b3c432",
  "S17-cancel-interruption": "sha256:e06c224ecc01de33bc483eb90f0ef0c4367d475b5a4dd4d86c3d53bb5c92e52f",
  "S18-context-usage": "sha256:92d314124b29cb75fc76cfde7e01c1f0db84def2db643209a4b9fcfff2112514",
  "S19-unknown-coverage": "sha256:94bc7f1e34826c71a95c5e7b5482b1edfaadf5d3caa8a1487915bb9bdab4cd8b",
} as const;

export type ConversationDisclosureScenarioId =
  keyof typeof conversationDisclosureScenarioDigests;

export const conversationDisclosureScenarioIds =
  Object.freeze(Object.keys(
    conversationDisclosureScenarioDigests,
  ) as ConversationDisclosureScenarioId[]);

export const conversationDisclosureScenarioActionCounts:
  Readonly<Record<ConversationDisclosureScenarioId, number>> = Object.freeze({
    "S01-default-narrative": 2,
    "S02-inline-expansion": 3,
    "S03-evidence-handoff": 2,
    "S04-failure-attention": 2,
    "S05-approval-attention": 3,
    "S06-pause-reload-recovery": 3,
    "S07-plan-progress": 3,
    "S08-scheduled-progress": 3,
    "S09-long-session": 3,
    "S10-accessibility": 3,
    "S11-secret-safety": 3,
    "S12-retry-attempt": 3,
    "S13-legacy-coverage": 3,
    "S14-guided-input": 3,
    "S15-goal-acceptance": 3,
    "S16-plan-confirmation": 3,
    "S17-cancel-interruption": 3,
    "S18-context-usage": 3,
    "S19-unknown-coverage": 3,
  });

export const conversationDisclosureScenarioActions: Readonly<
  Record<ConversationDisclosureScenarioId, readonly string[]>
> = Object.freeze({
  "S01-default-narrative": ["send_task", "observe_compact_completion"],
  "S02-inline-expansion": [
    "expand_group_and_item",
    "append_stream_update",
    "collapse_group",
  ],
  "S03-evidence-handoff": ["open_exact_evidence", "reload_and_reopen_evidence"],
  "S04-failure-attention": ["observe_failure", "open_recovery_evidence"],
  "S05-approval-attention": [
    "observe_pending_approval",
    "reload_pending_approval",
    "resolve_once_and_reject_duplicate",
  ],
  "S06-pause-reload-recovery": [
    "reload_paused_continuation",
    "inspect_paused_authority",
    "consume_continuation_once",
  ],
  "S07-plan-progress": [
    "observe_persisted_plan_progress",
    "reload_during_plan",
    "review_final_plan_decision",
  ],
  "S08-scheduled-progress": [
    "observe_scheduled_stream",
    "navigate_scheduled_to_runs",
    "verify_shared_run_identity",
  ],
  "S09-long-session": [
    "load_bounded_tail",
    "page_older_evidence",
    "measure_streaming_bounds",
  ],
  "S10-accessibility": [
    "keyboard_expand_and_navigate",
    "inspect_accessible_state",
    "enable_reduced_motion",
  ],
  "S11-secret-safety": [
    "observe_safe_default",
    "open_authorized_redacted_evidence",
    "scan_persisted_and_visual_artifacts",
  ],
  "S12-retry-attempt": [
    "observe_failed_partial_attempt",
    "execute_retry",
    "reload_accepted_attempt",
  ],
  "S13-legacy-coverage": [
    "open_projected_legacy_session",
    "inspect_partial_coverage",
    "restart_in_legacy_mode",
  ],
  "S14-guided-input": [
    "reload_pending_guided_input",
    "submit_one_guided_response",
    "settle_guided_continuation_once",
  ],
  "S15-goal-acceptance": [
    "review_goal",
    "observe_completed_unverified",
    "resolve_acceptance_and_reload",
  ],
  "S16-plan-confirmation": [
    "reload_awaiting_confirmation",
    "confirm_plan_once",
    "inspect_blocked_plan",
  ],
  "S17-cancel-interruption": [
    "cancel_active_turn",
    "restart_with_pending_approval",
    "inspect_cold_start_recovery",
  ],
  "S18-context-usage": [
    "observe_precompression_usage",
    "trigger_context_compaction",
    "reload_cumulative_usage",
  ],
  "S19-unknown-coverage": [
    "open_optional_unknown",
    "open_required_unknown",
    "reload_both_coverage_scopes",
  ],
});

export type ConversationDisclosureScenarioActionReceipt = {
  index: number;
  action: string;
  executor:
    | "production_main"
    | "production_preload_ipc"
    | "production_renderer_dom"
    | "production_renderer_reload"
    | "production_restart";
  ok: true;
  evidenceIds: string[];
  observations: Record<string, string | number | boolean>;
};

export type ConversationDisclosureScenarioRequirementReceipt = {
  index: number;
  requirement: string;
  ok: true;
  evidenceIds: string[];
};

export type ConversationDisclosureScenarioIpcInvocation = {
  ordinal: number;
  channel: string;
  ok: boolean;
};

export type ConversationDisclosureScenarioReceipt = {
  schemaVersion: 1;
  kind: "conversation-disclosure-production-scenario";
  scenarioId: ConversationDisclosureScenarioId;
  scenarioDigest: string;
  executionId: string;
  processEpochs: string[];
  productionMain: true;
  productionPreload: true;
  demoDataUsed: false;
  expected: string[];
  evidenceRequirements: string[];
  actions: ConversationDisclosureScenarioActionReceipt[];
  requirements: ConversationDisclosureScenarioRequirementReceipt[];
  ipcInvocations: ConversationDisclosureScenarioIpcInvocation[];
  screenshotDigests: string[];
  status: "passed";
  digest: string;
};

export function isConversationDisclosureScenarioId(
  value: string,
): value is ConversationDisclosureScenarioId {
  return Object.hasOwn(conversationDisclosureScenarioDigests, value);
}
