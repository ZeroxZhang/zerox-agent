/**
 * Pure, closed-world governance validator for the conversation-disclosure
 * continuation. The caller owns all file capture and evidence hashing. This
 * module deliberately performs no I/O and treats `featureList.features` as the
 * externally captured projection governed by `closedWorld.featureIds`.
 */

import {
  CONTINUATION_V9_FEATURE_ID,
  CONTINUATION_V9_REJECTED_OUTPUT_ABSENT_PATHS,
  CONTINUATION_V9_SUCCESSOR_FEATURE_ID,
  CONTINUATION_V9_SUCCESSOR_WORKSTREAM_ID,
  CONTINUATION_V9_WORKSTREAM_ID,
  canonicalJsonV9,
  hashCanonicalV9,
  stableProgramRootDefinitionV9,
} from "./conversation-disclosure-continuation-contract-v9.mjs";

export const GOVERNANCE_V9_INPUT_KIND =
  "conversation-disclosure-program-governance-v9-input";
export const GOVERNANCE_V9_RESULT_KIND =
  "conversation-disclosure-program-governance-v9-result";

const REQUIRED_FINDINGS = Object.freeze(
  Array.from({ length: 13 }, (_, index) => `D${index + 1}`),
);
const REQUIRED_SCENARIO_CATEGORIES = Object.freeze([
  "default",
  "expanded",
  "evidence",
  "failure",
  "approval",
  "recovery",
  "plan",
  "scheduled",
  "long_session",
  "accessibility",
  "secret_safety",
  "retry",
  "legacy",
  "guided_input",
  "goal_acceptance",
  "plan_confirmation",
  "cancel",
  "context_usage",
  "unknown_coverage",
]);
const REQUIRED_REVIEW_LANES = Object.freeze(["contract", "runtime", "governance"]);
const REQUIRED_CHARACTERIZATION_IDS = Object.freeze(
  Array.from({ length: 13 }, (_, index) =>
    [
      "C01-global-request-claim",
      "C02-attempt-control",
      "C03-assistant-receipt-order",
      "C04-message-first-repair",
      "C05-required-settlement",
      "C06-ordinary-queue-drain",
      "C07-workspace-lifecycle",
      "C08-event-first-repair",
      "C09-approval-durability",
      "C10-approval-recovery",
      "C11-distinct-causal-identities",
      "C12-single-live-answer",
      "C13-safe-compatibility",
    ][index]
  ),
);
const REQUIRED_VERIFICATION_IDS = Object.freeze([
  "focused",
  "test_type_coverage",
  "full_verify",
  "production_smoke",
  "governance",
]);
const REQUIRED_EXECUTABLE_CLOSURE_PATHS = Object.freeze([
  "package.json",
  "scripts/check-harness-state.mjs",
  "scripts/check-conversation-disclosure-program.mjs",
]);
const CANONICAL_CD03_ARTIFACT =
  ".zerox/verification/conversation-disclosure/CD03-causal-shadow.json";
const CANONICAL_ACCEPTANCE_MANIFEST =
  ".zerox/verification/conversation-disclosure/CD09-real-app-acceptance.json";
const P107A_WORKSTREAM_ID = CONTINUATION_V9_WORKSTREAM_ID;
const P107A_FEATURE_ID = CONTINUATION_V9_FEATURE_ID;
const P108_WORKSTREAM_ID = CONTINUATION_V9_SUCCESSOR_WORKSTREAM_ID;
const P108_FEATURE_ID = CONTINUATION_V9_SUCCESSOR_FEATURE_ID;
export const P107A_V9_COMPLETION_ARTIFACTS = Object.freeze([
  ".zerox/decisions/CD03A-successor-evolution-trust-head.md",
  ".zerox/decisions/CD03A-round3-recovery-trust-head.md",
  ".zerox/verification/conversation-disclosure/CD03A-successor-evolution-policy.json",
  ".zerox/verification/conversation-disclosure/CD03A-round1-review-snapshot.json",
  ".zerox/verification/conversation-disclosure/CD03A-round1-contract-review.json",
  ".zerox/verification/conversation-disclosure/CD03A-round1-runtime-review.json",
  ".zerox/verification/conversation-disclosure/CD03A-round1-governance-review.json",
  ".zerox/verification/conversation-disclosure/CD03A-round2-baseline-archive.json",
  ".zerox/verification/conversation-disclosure/CD03A-round2-successor-evolution-policy.json",
  ".zerox/verification/conversation-disclosure/CD03A-round2-prefreeze-rejection.json",
  ".zerox/verification/conversation-disclosure/CD03A-round3-baseline-archive.json",
  ".zerox/verification/conversation-disclosure/CD03A-round3-successor-evolution-policy.json",
  ".zerox/verification/conversation-disclosure/CD03A-round3-review-snapshot.json",
  ".zerox/verification/conversation-disclosure/CD03A-round3-contract-review.json",
  ".zerox/verification/conversation-disclosure/CD03A-round3-runtime-review.json",
  ".zerox/verification/conversation-disclosure/CD03A-round3-governance-review.json",
  ".zerox/decisions/CD03A-round4-recovery-trust-head.md",
  "HANDOFF-v3.9.2-conversation-disclosure.md",
  ".zerox/verification/conversation-disclosure/CD03A-round3-review-rejection.json",
  ".zerox/verification/conversation-disclosure/CD03A-round4-baseline-archive.json",
  ".zerox/verification/conversation-disclosure/CD03A-round4-successor-evolution-policy.json",
  ".zerox/verification/conversation-disclosure/CD03A-round4-review-snapshot.json",
  ".zerox/verification/conversation-disclosure/CD03A-round4-governance-review.json",
  ".zerox/decisions/CD03A-round5-final-evidence-trust-head.md",
  "HANDOFF-v3.9.2-conversation-disclosure-round5.md",
  ".zerox/verification/conversation-disclosure/CD03A-round4-review-rejection.json",
  ".zerox/verification/conversation-disclosure/CD03A-round5-baseline-archive.json",
  ".zerox/verification/conversation-disclosure/CD03A-round5-successor-evolution-policy.json",
  ".zerox/verification/conversation-disclosure/CD03A-round5-review-snapshot.json",
  ".zerox/verification/conversation-disclosure/CD03A-round5-governance-review.json",
  ".zerox/decisions/CD03A-round6-review-integrity-trust-head.md",
  "HANDOFF-v3.9.2-conversation-disclosure-round6.md",
  ".zerox/verification/conversation-disclosure/CD03A-round5-review-rejection.json",
  ".zerox/verification/conversation-disclosure/CD03A-round6-baseline-archive.json",
  ".zerox/verification/conversation-disclosure/CD03A-round6-successor-evolution-policy.json",
  ".zerox/verification/conversation-disclosure/CD03A-round6-review-snapshot.json",
  ".zerox/verification/conversation-disclosure/CD03A-round6-governance-review.json",
  ".zerox/decisions/CD03A-round7-closure-authority-trust-head.md",
  "HANDOFF-v3.9.2-conversation-disclosure-round7.md",
  ".zerox/verification/conversation-disclosure/CD03A-round6-review-rejection.json",
  ".zerox/verification/conversation-disclosure/CD03A-round7-baseline-archive.json",
  ".zerox/verification/conversation-disclosure/CD03A-round7-successor-evolution-policy.json",
  ".zerox/verification/conversation-disclosure/CD03A-round7-review-snapshot.json",
  ".zerox/verification/conversation-disclosure/CD03A-round7-runtime-review.json",
  ".zerox/verification/conversation-disclosure/CD03A-round7-governance-review.json",
  ".zerox/decisions/CD03A-round8-runtime-publication-trust-head.md",
  "HANDOFF-v3.9.2-conversation-disclosure-round8.md",
  ".zerox/verification/conversation-disclosure/CD03A-round7-review-rejection.json",
  ".zerox/verification/conversation-disclosure/CD03A-round8-baseline-archive.json",
  ".zerox/verification/conversation-disclosure/CD03A-round8-successor-evolution-policy.json",
  ".zerox/verification/conversation-disclosure/CD03A-round8-review-snapshot.json",
  ".zerox/verification/conversation-disclosure/CD03A-round8-runtime-review.json",
  ".zerox/verification/conversation-disclosure/CD03A-round8-governance-review.json",
  ".zerox/decisions/CD03A-round9-descriptor-transaction-trust-head.md",
  "HANDOFF-v3.9.2-conversation-disclosure-round9.md",
  ".zerox/verification/conversation-disclosure/CD03A-round8-review-rejection.json",
  ".zerox/verification/conversation-disclosure/CD03A-round9-baseline-archive.json",
  ".zerox/verification/conversation-disclosure/CD03A-round9-successor-evolution-policy.json",
  ".zerox/verification/conversation-disclosure/CD03A-round9-review-snapshot.json",
  ".zerox/verification/conversation-disclosure/CD03A-round9-contract-review.json",
  ".zerox/verification/conversation-disclosure/CD03A-round9-runtime-review.json",
  ".zerox/verification/conversation-disclosure/CD03A-round9-governance-review.json",
  ".zerox/verification/conversation-disclosure/CD03A-round9-closure-manifest.json",
  ".zerox/verification/conversation-disclosure/CD03A-round9-external-attestation.json",
]);

const MANDATORY_FINDING_OWNERS = Object.freeze({
  D1: "CD02",
  D2: "CD03",
  D3: "CD03",
  D4: "CD02",
  D5: "CD04",
  D6: "CD03",
  D7: "CD04",
  D8: "CD05",
  D9: "CD03",
  D10: "CD04",
  D11: "CD06",
  D12: "CD04",
  D13: "CD02",
});

export const PROGRAM_GOVERNANCE_V9_RULE_LEDGER = Object.freeze([
  Object.freeze({ id: "CDG4-001-input-contract", title: "Closed input and rule schema" }),
  Object.freeze({ id: "CDG4-010-program-shape", title: "Program identity and top-level shape" }),
  Object.freeze({ id: "CDG4-011-program-root-contract", title: "Frozen stable Program root" }),
  Object.freeze({ id: "CDG4-020-root-findings", title: "Exact D1-D13 root finding set" }),
  Object.freeze({ id: "CDG4-030-deferrals", title: "Deferred boundary declarations" }),
  Object.freeze({ id: "CDG4-040-scenario-schema", title: "Scenario identity and field schema" }),
  Object.freeze({ id: "CDG4-041-scenario-categories", title: "Exact scenario category vocabulary" }),
  Object.freeze({ id: "CDG4-042-scenario-coverage", title: "Scenario references and total coverage" }),
  Object.freeze({ id: "CDG4-050-workstream-schema", title: "Workstream and Feature identity schema" }),
  Object.freeze({ id: "CDG4-051-closed-roster", title: "Externally anchored exact roster" }),
  Object.freeze({ id: "CDG4-052-dependency-graph", title: "Dependency existence, order, and acyclicity" }),
  Object.freeze({ id: "CDG4-053-state-boundary", title: "Monotonic workstream state boundary" }),
  Object.freeze({ id: "CDG4-054-completion-artifacts", title: "Exact satisfiable P107A completion artifacts" }),
  Object.freeze({ id: "CDG4-060-finding-owners", title: "Finding coverage and mandatory owners" }),
  Object.freeze({ id: "CDG4-070-implementation-gates", title: "Implementation and post-gate suffix" }),
  Object.freeze({ id: "CDG4-080-feature-status", title: "Feature registration and unfinished limit" }),
  Object.freeze({ id: "CDG4-081-active-next", title: "Active and next Feature pointers" }),
  Object.freeze({ id: "CDG4-090-p107a-p108-lifecycle", title: "P107A to P108 continuation lifecycle" }),
  Object.freeze({ id: "CDG4-100-cd03-evidence-refs", title: "Completed CD03 evidence reference shape" }),
]);

export const PROGRAM_GOVERNANCE_V9_RULE_IDS = Object.freeze(
  PROGRAM_GOVERNANCE_V9_RULE_LEDGER.map((rule) => rule.id),
);

export function validateConversationDisclosureProgramGovernanceV9(input) {
  const issues = new Map(PROGRAM_GOVERNANCE_V9_RULE_IDS.map((id) => [id, []]));
  const add = (id, message) => issues.get(id).push(message);
  const run = (id, validator) => {
    try {
      validator();
    } catch (error) {
      add(id, `validator failed closed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const value = plainObject(input) ? input : {};
  const program = plainObject(value.program) ? value.program : {};
  const featureList = plainObject(value.featureList) ? value.featureList : {};
  const features = Array.isArray(featureList.features) ? featureList.features : [];
  const roster = plainObject(value.closedWorld) ? value.closedWorld : {};
  const lifecycle = plainObject(value.lifecycleProfile) ? value.lifecycleProfile : {};
  const cd03Evidence = plainObject(value.parentEvidence) ? value.parentEvidence : {};
  const workstreamList = Array.isArray(program.workstreams) ? program.workstreams : [];
  const scenarioList = Array.isArray(program.scenarioMatrix) ? program.scenarioMatrix : [];
  const workstreams = uniqueMap(workstreamList, "id");
  const featureMap = uniqueMap(features, "id");
  const scenarios = uniqueMap(scenarioList, "id");

  run("CDG4-001-input-contract", () => {
    const expectedKeys = [
      "closedWorld",
      "featureList",
      "lifecycleProfile",
      "parentEvidence",
      "program",
    ];
    if (!plainObject(input)) add("CDG4-001-input-contract", "input must be an object");
    if (!sameOrderedStrings(Object.keys(value).sort(), expectedKeys)) {
      add("CDG4-001-input-contract", "input keys must exactly match the v9 contract");
    }
    if (!sameOrderedStrings(Object.keys(roster).sort(), [
      "programRootDefinition",
      "programRootDefinitionDigest",
      "ruleIds",
      "schemaVersion",
      "workstreamIds",
    ]) || roster.schemaVersion !== 9) {
      add("CDG4-001-input-contract", "unknown closed-world governance schema");
    }
    if (!sameOrderedStrings(roster.ruleIds, PROGRAM_GOVERNANCE_V9_RULE_IDS)) {
      add("CDG4-001-input-contract", "closedWorld.ruleIds must exactly match the known v9 ledger");
    }
    if (!plainObject(value.program) || !plainObject(value.featureList)
      || !Array.isArray(value.featureList?.features) || !plainObject(value.closedWorld)
      || !plainObject(value.lifecycleProfile) || !plainObject(value.parentEvidence)) {
      add("CDG4-001-input-contract", "program, featureList, closedWorld, lifecycleProfile, and parentEvidence are required");
    }
  });

  run("CDG4-010-program-shape", () => {
    if (program.schemaVersion !== 1) add("CDG4-010-program-shape", "program schemaVersion must be 1");
    if (!nonEmpty(program.programId)) add("CDG4-010-program-shape", "programId is required");
    if (program.status !== "active" && program.status !== "completed") {
      add("CDG4-010-program-shape", "program status is invalid");
    }
    if (program.maxActiveFeatures !== 1) add("CDG4-010-program-shape", "maxActiveFeatures must remain 1");
    if (!stringArray(program.invariants) || program.invariants.length < 5) {
      add("CDG4-010-program-shape", "at least five invariants are required");
    }
    if (!stringArray(program.nonGoals) || program.nonGoals.length < 3) {
      add("CDG4-010-program-shape", "at least three nonGoals are required");
    }
    if (!Array.isArray(program.deferrals) || program.deferrals.length === 0
      || workstreamList.length === 0 || scenarioList.length === 0) {
      add("CDG4-010-program-shape", "deferrals, workstreams, and scenarioMatrix are required");
    }
    for (const [field, candidate] of [
      ["sourceReview", program.sourceReview],
      ["operatingGuide", program.operatingGuide],
      ["architectureDecision", program.architectureDecision],
    ]) {
      if (!repositoryPath(candidate)) add("CDG4-010-program-shape", `${field} must be repository-relative`);
    }
    if (program.acceptanceManifest !== CANONICAL_ACCEPTANCE_MANIFEST) {
      add("CDG4-010-program-shape", "acceptanceManifest is not canonical");
    }
  });

  run("CDG4-011-program-root-contract", () => {
    if (!plainObject(roster.programRootDefinition)
      || !sha256Digest(roster.programRootDefinitionDigest)
      || roster.programRootDefinitionDigest
        !== hashCanonicalV9(roster.programRootDefinition)) {
      add("CDG4-011-program-root-contract", "frozen Program root binding is invalid");
      return;
    }
    const liveDefinition = stableProgramRootDefinitionV9(program);
    if (canonicalJsonV9(liveDefinition)
        !== canonicalJsonV9(roster.programRootDefinition)
      || hashCanonicalV9(liveDefinition) !== roster.programRootDefinitionDigest) {
      add(
        "CDG4-011-program-root-contract",
        "live stable Program root differs from the independently frozen definition",
      );
    }
  });

  run("CDG4-020-root-findings", () => {
    if (!exactStringSet(program.rootFindings, REQUIRED_FINDINGS)) {
      add("CDG4-020-root-findings", "rootFindings must be the exact unique D1-D13 set");
    }
  });

  run("CDG4-030-deferrals", () => {
    const ids = new Set();
    for (const [index, deferral] of asArray(program.deferrals).entries()) {
      if (!nonEmpty(deferral?.id) || ids.has(deferral?.id)) {
        add("CDG4-030-deferrals", `deferrals[${index}] has a missing or duplicate id`);
      }
      ids.add(deferral?.id);
      if (deferral?.status !== "kept_deferred" || !nonEmpty(deferral?.trigger)
        || !nonEmpty(deferral?.prohibitedCurrentAction)) {
        add("CDG4-030-deferrals", `deferrals[${index}] does not preserve the deferred boundary`);
      }
    }
  });

  run("CDG4-040-scenario-schema", () => {
    const ids = new Set();
    for (const [index, scenario] of scenarioList.entries()) {
      if (!nonEmpty(scenario?.id) || ids.has(scenario?.id)) {
        add("CDG4-040-scenario-schema", `scenarioMatrix[${index}] has a missing or duplicate id`);
      }
      ids.add(scenario?.id);
      if (!nonEmpty(scenario?.title) || !nonEmpty(scenario?.surface)
        || !nonEmpty(scenario?.fixture) || !nonEmpty(scenario?.setup)
        || !["browser", "hybrid"].includes(scenario?.executor)
        || !stringArray(scenario?.actions) || !stringArray(scenario?.expected)
        || !stringArray(scenario?.evidenceRequirements)
        || !Array.isArray(scenario?.acceptanceEvidence)) {
        add("CDG4-040-scenario-schema", `scenarioMatrix[${index}] has invalid fields`);
      }
    }
  });

  run("CDG4-041-scenario-categories", () => {
    const present = new Set();
    for (const scenario of scenarioList) {
      if (!REQUIRED_SCENARIO_CATEGORIES.includes(scenario?.category)) {
        add("CDG4-041-scenario-categories", `unknown scenario category ${String(scenario?.category)}`);
      } else {
        present.add(scenario.category);
      }
    }
    for (const category of REQUIRED_SCENARIO_CATEGORIES) {
      if (!present.has(category)) add("CDG4-041-scenario-categories", `missing scenario category ${category}`);
    }
  });

  run("CDG4-042-scenario-coverage", () => {
    const referenced = new Set();
    for (const workstream of workstreamList) {
      if (!stringArray(workstream?.acceptanceScenarioIds)) {
        add("CDG4-042-scenario-coverage", `${String(workstream?.id)} acceptanceScenarioIds are invalid`);
        continue;
      }
      for (const scenarioId of workstream.acceptanceScenarioIds) {
        referenced.add(scenarioId);
        if (!scenarios.has(scenarioId)) {
          add("CDG4-042-scenario-coverage", `${String(workstream?.id)} references unknown scenario ${scenarioId}`);
        }
      }
    }
    for (const scenario of scenarioList) {
      if (nonEmpty(scenario?.id) && !referenced.has(scenario.id)) {
        add("CDG4-042-scenario-coverage", `scenario ${scenario.id} is unreferenced`);
      }
    }
  });

  run("CDG4-050-workstream-schema", () => {
    const ids = new Set();
    const featureIds = new Set();
    for (const [index, workstream] of workstreamList.entries()) {
      if (!nonEmpty(workstream?.id) || ids.has(workstream?.id)) {
        add("CDG4-050-workstream-schema", `workstreams[${index}] has a missing or duplicate id`);
      }
      ids.add(workstream?.id);
      if (!nonEmpty(workstream?.featureId) || featureIds.has(workstream?.featureId)) {
        add("CDG4-050-workstream-schema", `workstreams[${index}] has a missing or duplicate featureId`);
      }
      featureIds.add(workstream?.featureId);
      if (!["planned", "in_progress", "completed"].includes(workstream?.state)
        || !stringArray(workstream?.findings)
        || workstream.findings.some((finding) => !REQUIRED_FINDINGS.includes(finding))
        || !Array.isArray(workstream?.dependsOn)
        || typeof workstream?.architectureDecisionRequired !== "boolean"
        || (workstream.architectureDecisionRequired && !repositoryPath(workstream.architectureDecision))
        || !repositoryPathArray(workstream?.completionArtifacts)
        || !nonEmpty(workstream?.rollback)
        || !stringArray(workstream?.verification)) {
        add("CDG4-050-workstream-schema", `workstreams[${index}] has invalid governance fields`);
      }
    }
  });

  run("CDG4-051-closed-roster", () => {
    if (!plainObject(roster)
      || !sameOrderedStrings(roster.workstreamIds, workstreamList.map((item) => item?.id))
      || !sameOrderedStrings(lifecycle.featureIds, features.map((item) => item?.id))) {
      add("CDG4-051-closed-roster", "live workstream/Feature roster differs from the anchored exact roster");
    }
    if (!uniqueStrings(roster.workstreamIds) || !uniqueStrings(lifecycle.featureIds)) {
      add("CDG4-051-closed-roster", "exact roster ids must be unique non-empty strings");
    }
  });

  run("CDG4-052-dependency-graph", () => {
    for (const workstream of workstreamList) {
      for (const dependency of asArray(workstream?.dependsOn)) {
        if (!workstreams.has(dependency)) {
          add("CDG4-052-dependency-graph", `${String(workstream?.id)} depends on unknown ${String(dependency)}`);
        }
      }
    }
    for (const cycle of dependencyCycles(workstreams)) {
      add("CDG4-052-dependency-graph", `dependency cycle: ${cycle.join(" -> ")}`);
    }
    if (workstreamList.length > 0 && asArray(workstreamList[0]?.dependsOn).length > 0) {
      add("CDG4-052-dependency-graph", "first workstream must be the dependency root");
    }
    for (let index = 1; index < workstreamList.length; index += 1) {
      const current = workstreamList[index];
      const previous = workstreamList[index - 1];
      if (!dependsTransitively(current?.id, previous?.id, workstreams)) {
        add("CDG4-052-dependency-graph", `${String(current?.id)} bypasses preceding ${String(previous?.id)}`);
      }
    }
  });

  run("CDG4-053-state-boundary", () => {
    let activeSeen = false;
    let plannedSeen = false;
    for (const workstream of workstreamList) {
      if (workstream?.state === "completed" && (activeSeen || plannedSeen)) {
        add("CDG4-053-state-boundary", `completed ${String(workstream?.id)} follows unfinished work`);
      } else if (workstream?.state === "in_progress") {
        if (activeSeen || plannedSeen) add("CDG4-053-state-boundary", `active ${String(workstream?.id)} is outside the state boundary`);
        activeSeen = true;
      } else if (workstream?.state === "planned") {
        plannedSeen = true;
      }
      if (workstream?.state !== "planned") {
        for (const dependency of asArray(workstream?.dependsOn)) {
          if (workstreams.get(dependency)?.state !== "completed") {
            add("CDG4-053-state-boundary", `${String(workstream?.id)} starts before ${dependency} completes`);
          }
        }
      }
    }
  });

  run("CDG4-054-completion-artifacts", () => {
    const completionArtifacts =
      workstreams.get(P107A_WORKSTREAM_ID)?.completionArtifacts;
    if (!sameOrderedStrings(
      completionArtifacts,
      P107A_V9_COMPLETION_ARTIFACTS,
    )) {
      add(
        "CDG4-054-completion-artifacts",
        "P107A completionArtifacts must match the exact satisfiable Round9 closure set",
      );
    }
    const forbidden = new Set(CONTINUATION_V9_REJECTED_OUTPUT_ABSENT_PATHS);
    if (asArray(completionArtifacts).some((entry) => forbidden.has(entry))) {
      add(
        "CDG4-054-completion-artifacts",
        "P107A completionArtifacts cannot require a rejected output",
      );
    }
  });

  run("CDG4-060-finding-owners", () => {
    const covered = new Set(workstreamList.flatMap((item) => asArray(item?.findings)));
    for (const finding of REQUIRED_FINDINGS) {
      if (!covered.has(finding)) add("CDG4-060-finding-owners", `program does not cover ${finding}`);
      const owner = workstreams.get(MANDATORY_FINDING_OWNERS[finding]);
      if (!asArray(owner?.findings).includes(finding)) {
        add("CDG4-060-finding-owners", `${MANDATORY_FINDING_OWNERS[finding]} must own ${finding}`);
      }
    }
  });

  run("CDG4-070-implementation-gates", () => {
    const implementationIndex = workstreamList.findIndex(
      (item) => item?.id === program.implementationCompletionWorkstreamId,
    );
    if (implementationIndex < 1 || implementationIndex >= workstreamList.length - 1) {
      add("CDG4-070-implementation-gates", "implementationCompletionWorkstreamId is outside the valid boundary");
      return;
    }
    const expectedGates = workstreamList.slice(implementationIndex + 1).map((item) => item.id);
    if (!sameOrderedStrings(program.postImplementationGates, expectedGates)) {
      add("CDG4-070-implementation-gates", "postImplementationGates must equal the ordered suffix");
    }
    const implementationFindings = new Set(
      workstreamList.slice(1, implementationIndex + 1).flatMap((item) => asArray(item?.findings)),
    );
    for (const finding of REQUIRED_FINDINGS) {
      if (!implementationFindings.has(finding)) {
        add("CDG4-070-implementation-gates", `implementation workstreams do not own ${finding}`);
      }
    }
  });

  run("CDG4-080-feature-status", () => {
    const seen = new Set();
    for (const feature of features) {
      if (!nonEmpty(feature?.id) || seen.has(feature?.id)) {
        add("CDG4-080-feature-status", "Feature ids must be unique non-empty strings");
      }
      seen.add(feature?.id);
      if (feature?.status !== "done" && feature?.status !== "in_progress") {
        add("CDG4-080-feature-status", `Feature ${String(feature?.id)} has an invalid status`);
      }
    }
    for (const workstream of workstreamList) {
      const feature = featureMap.get(workstream?.featureId);
      if (workstream?.state === "completed" && feature?.status !== "done") {
        add("CDG4-080-feature-status", `completed ${String(workstream?.id)} requires a done Feature`);
      }
      if (workstream?.state === "in_progress" && feature?.status !== "in_progress") {
        add("CDG4-080-feature-status", `active ${String(workstream?.id)} requires an in_progress Feature`);
      }
      if (workstream?.state === "planned" && feature) {
        add("CDG4-080-feature-status", `planned ${String(workstream?.id)} must not be registered`);
      }
    }
    if (features.filter((feature) => feature?.status !== "done").length > program.maxActiveFeatures) {
      add("CDG4-080-feature-status", "unfinished Feature count exceeds maxActiveFeatures");
    }
  });

  run("CDG4-081-active-next", () => {
    const activeWorkstreams = workstreamList.filter((item) => item?.state === "in_progress");
    if (activeWorkstreams.length > program.maxActiveFeatures) {
      add("CDG4-081-active-next", "active workstream count exceeds maxActiveFeatures");
    }
    if (program.status === "active") {
      if (program.activeFeatureId === null) {
        if (activeWorkstreams.length > 0) add("CDG4-081-active-next", "idle program contains active work");
        const next = workstreamList.find((item) => item?.featureId === program.nextFeatureId);
        if (next?.state !== "planned") add("CDG4-081-active-next", "idle nextFeatureId must identify planned work");
      } else {
        const active = workstreamList.find((item) => item?.featureId === program.activeFeatureId);
        if (active?.state !== "in_progress") add("CDG4-081-active-next", "activeFeatureId does not identify active work");
        if (program.nextFeatureId !== program.activeFeatureId) {
          add("CDG4-081-active-next", "nextFeatureId must equal activeFeatureId while active");
        }
      }
    } else if (program.activeFeatureId !== null || program.nextFeatureId !== null
      || workstreamList.some((item) => item?.state !== "completed")) {
      add("CDG4-081-active-next", "completed program must clear pointers and complete every workstream");
    }
  });

  run("CDG4-090-p107a-p108-lifecycle", () => {
    const expectedKeys = [
      "featureIds",
      "p107aFeatureId",
      "p107aWorkstreamId",
      "p108FeatureId",
      "p108WorkstreamId",
      "phase",
    ];
    if (!sameOrderedStrings(Object.keys(lifecycle).sort(), expectedKeys)
      || lifecycle.p107aWorkstreamId !== P107A_WORKSTREAM_ID
      || lifecycle.p107aFeatureId !== P107A_FEATURE_ID
      || lifecycle.p108WorkstreamId !== P108_WORKSTREAM_ID
      || lifecycle.p108FeatureId !== P108_FEATURE_ID) {
      add("CDG4-090-p107a-p108-lifecycle", "P107A/P108 lifecycle identity is not exact");
      return;
    }
    const p107aWorkstream = workstreams.get(P107A_WORKSTREAM_ID);
    const p108Workstream = workstreams.get(P108_WORKSTREAM_ID);
    const p107aFeature = featureMap.get(P107A_FEATURE_ID);
    const p108Feature = featureMap.get(P108_FEATURE_ID);
    if (lifecycle.phase === "review_pre" || lifecycle.phase === "review_post") {
      if (p107aWorkstream?.state !== "in_progress" || p107aFeature?.status !== "in_progress"
        || p108Workstream?.state !== "planned" || p108Feature !== undefined
        || program.activeFeatureId !== P107A_FEATURE_ID
        || program.nextFeatureId !== P107A_FEATURE_ID) {
        add("CDG4-090-p107a-p108-lifecycle", `${lifecycle.phase} state tuple is invalid`);
      }
    } else if (lifecycle.phase === "anchored_planned") {
      if (p107aWorkstream?.state !== "completed" || p107aFeature?.status !== "done"
        || p108Workstream?.state !== "planned" || p108Feature !== undefined
        || program.activeFeatureId !== null || program.nextFeatureId !== P108_FEATURE_ID) {
        add("CDG4-090-p107a-p108-lifecycle", "anchored_planned state tuple is invalid");
      }
    } else if (lifecycle.phase === "authorized_active") {
      if (p107aWorkstream?.state !== "completed" || p107aFeature?.status !== "done"
        || p108Workstream?.state !== "in_progress" || p108Feature?.status !== "in_progress"
        || program.activeFeatureId !== P108_FEATURE_ID
        || program.nextFeatureId !== P108_FEATURE_ID) {
        add("CDG4-090-p107a-p108-lifecycle", "authorized_active state tuple is invalid");
      }
    } else if (lifecycle.phase === "completed_pending_delta") {
      add(
        "CDG4-090-p107a-p108-lifecycle",
        "P108 completion requires an independently reviewed next-version delta trust head",
      );
    } else {
      add("CDG4-090-p107a-p108-lifecycle", "unknown continuation lifecycle phase");
    }
  });

  run("CDG4-100-cd03-evidence-refs", () => {
    const cd03 = workstreams.get("CD03");
    const contract = cd03?.completionContract;
    if (cd03?.state !== "completed" || !plainObject(contract)
      || contract.schemaVersion !== 1 || contract.kind !== "reviewed_shadow"
      || contract.primaryArtifact !== CANONICAL_CD03_ARTIFACT
      || contract.minimumIndependentPasses < 3
      || !exactStringSet(contract.requiredReviewLanes, REQUIRED_REVIEW_LANES)
      || !exactStringSet(contract.requiredCharacterizationIds, REQUIRED_CHARACTERIZATION_IDS)
      || !exactStringSet(contract.requiredVerificationIds, REQUIRED_VERIFICATION_IDS)
      || !exactStringSet(contract.requiredExecutableClosurePaths, REQUIRED_EXECUTABLE_CLOSURE_PATHS)
      || !plainObject(contract.requiredSafety)
      || Object.values(contract.requiredSafety).some((entry) => typeof entry !== "boolean")
      || !asArray(cd03?.completionArtifacts).includes(CANONICAL_CD03_ARTIFACT)) {
      add("CDG4-100-cd03-evidence-refs", "CD03 completionContract reference shape is invalid");
    }
    const artifact = cd03Evidence.artifact;
    const manifest = cd03Evidence.closureManifest;
    const anchor = cd03Evidence.externalAnchor;
    const evidenceReceipts = asArray(cd03Evidence.receipts);
    const externalAttestation = cd03Evidence.externalAttestation;
    const review = artifact?.independentReview;
    if (!plainObject(artifact) || artifact.schemaVersion !== 1
      || artifact.artifactId !== "CD03-causal-shadow" || artifact.status !== "accepted"
      || artifact.programId !== program.programId || artifact.featureId !== cd03?.featureId
      || !plainObject(review)
      || !sameOrderedStrings(Object.keys(review).sort(), ["closureManifestPath", "history", "round", "status"])
      || review.status !== "passed" || !Number.isInteger(review.round) || review.round < 1
      || !repositoryPath(review.closureManifestPath) || !Array.isArray(review.history)) {
      add("CDG4-100-cd03-evidence-refs", "accepted CD03 artifact review reference is invalid");
    }
    const receipts = asArray(manifest?.reviewReceipts);
    if (!plainObject(manifest) || manifest.schemaVersion !== 1
      || manifest.kind !== "conversation-disclosure-closure-manifest"
      || manifest.status !== "externally_attested" || manifest.programId !== program.programId
      || manifest.workstreamId !== "CD03" || manifest.featureId !== cd03?.featureId
      || manifest.round !== review?.round || review?.closureManifestPath !== cd03Evidence.closureManifestPath
      || !repositoryPath(cd03Evidence.closureManifestPath)
      || !repositoryPath(manifest.snapshot?.path) || !sha256Digest(manifest.snapshot?.digest)
      || !exactStringSet(receipts.map((entry) => entry?.lane), REQUIRED_REVIEW_LANES)
      || receipts.some((entry) => !repositoryPath(entry?.path) || !sha256Digest(entry?.canonicalDigest))
      || !repositoryPath(manifest.externalAttestation?.path)
      || !sha256Digest(manifest.externalAttestation?.canonicalDigest)) {
      add("CDG4-100-cd03-evidence-refs", "CD03 closure manifest reference shape is invalid");
    }
    const anchorReceipts = asArray(anchor?.reviewReceipts);
    if (!plainObject(anchor) || !sha256Digest(anchor.digest)
      || anchor.attestationDigest !== manifest?.externalAttestation?.canonicalDigest
      || anchor.snapshotDigest !== manifest?.snapshot?.digest
      || !exactStringSet(anchorReceipts.map((entry) => entry?.lane), REQUIRED_REVIEW_LANES)
      || !exactStringSet(evidenceReceipts.map((entry) => entry?.lane), REQUIRED_REVIEW_LANES)) {
      add("CDG4-100-cd03-evidence-refs", "CD03 external anchor reference shape is invalid");
    }
    for (const manifestReceipt of receipts) {
      const anchorReceipt = anchorReceipts.find((entry) => entry?.lane === manifestReceipt?.lane);
      const evidenceReceipt = evidenceReceipts.find((entry) => entry?.lane === manifestReceipt?.lane);
      if (anchorReceipt?.canonicalDigest !== manifestReceipt?.canonicalDigest
        || !sha256Digest(anchorReceipt?.challenge)
        || evidenceReceipt?.challenge !== anchorReceipt?.challenge
        || evidenceReceipt?.snapshotDigest !== manifest?.snapshot?.digest
        || evidenceReceipt?.verdict !== "passed") {
        add("CDG4-100-cd03-evidence-refs", `CD03 ${String(manifestReceipt?.lane)} receipt reference is invalid`);
      }
    }
    const attestationReceipts = asArray(externalAttestation?.reviewReceiptDigests);
    if (!plainObject(externalAttestation)
      || externalAttestation.status !== "passed"
      || externalAttestation.digest !== manifest?.externalAttestation?.canonicalDigest
      || externalAttestation.snapshotDigest !== manifest?.snapshot?.digest
      || !exactStringSet(attestationReceipts.map((entry) => entry?.lane), REQUIRED_REVIEW_LANES)
      || attestationReceipts.some((entry) => {
        const manifestReceipt = receipts.find((candidate) => candidate?.lane === entry?.lane);
        return entry?.canonicalDigest !== manifestReceipt?.canonicalDigest;
      })) {
      add("CDG4-100-cd03-evidence-refs", "CD03 external attestation reference shape is invalid");
    }
  });

  const ruleResults = PROGRAM_GOVERNANCE_V9_RULE_LEDGER.map((rule) => {
    const errors = Object.freeze([...issues.get(rule.id)]);
    return Object.freeze({
      id: rule.id,
      status: errors.length === 0 ? "passed" : "failed",
      message: errors.length === 0 ? rule.title : errors.join("; "),
    });
  });
  return Object.freeze({
    schemaVersion: 9,
    kind: GOVERNANCE_V9_RESULT_KIND,
    status: ruleResults.every((rule) => rule.status === "passed") ? "passed" : "failed",
    ruleResults: Object.freeze(ruleResults),
    errors: Object.freeze(ruleResults
      .filter((rule) => rule.status === "failed")
      .map((rule) => `${rule.id}: ${rule.message}`)),
  });
}

export function createProgramRootBindingV9(program) {
  const programRootDefinition = stableProgramRootDefinitionV9(program);
  return {
    programRootDefinition,
    programRootDefinitionDigest: hashCanonicalV9(programRootDefinition),
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmpty);
}

function repositoryPath(value) {
  return nonEmpty(value) && !value.startsWith("/") && !value.includes("\\")
    && value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

function repositoryPathArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(repositoryPath);
}

function uniqueStrings(value) {
  return Array.isArray(value) && value.every(nonEmpty) && new Set(value).size === value.length;
}

function exactStringSet(actual, expected) {
  return uniqueStrings(actual) && actual.length === expected.length
    && expected.every((entry) => actual.includes(entry));
}

function sameOrderedStrings(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length
    && actual.every((entry, index) => entry === expected[index]);
}

function sha256Digest(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function uniqueMap(values, key) {
  const output = new Map();
  for (const value of values) {
    if (nonEmpty(value?.[key]) && !output.has(value[key])) output.set(value[key], value);
  }
  return output;
}

function dependencyCycles(workstreams) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const visit = (id, chain) => {
    if (visiting.has(id)) {
      cycles.push([...chain.slice(chain.indexOf(id)), id]);
      return;
    }
    if (visited.has(id) || !workstreams.has(id)) return;
    visiting.add(id);
    const node = workstreams.get(id);
    for (const dependency of asArray(node?.dependsOn)) visit(dependency, [...chain, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of workstreams.keys()) visit(id, []);
  return cycles;
}

function dependsTransitively(sourceId, targetId, workstreams, seen = new Set()) {
  if (!nonEmpty(sourceId) || !nonEmpty(targetId) || seen.has(sourceId)) return false;
  seen.add(sourceId);
  const dependencies = asArray(workstreams.get(sourceId)?.dependsOn);
  return dependencies.includes(targetId)
    || dependencies.some((dependency) => dependsTransitively(dependency, targetId, workstreams, seen));
}
