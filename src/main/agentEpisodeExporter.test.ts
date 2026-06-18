import { describe, expect, it } from "vitest";
import { createAgentEpisodePackage } from "./agentEpisodeExporter";

describe("createAgentEpisodePackage", () => {
  it("packages run, checkpoint, trajectory, learning, and verification evidence", () => {
    const episode = createAgentEpisodePackage({
      run: {
        id: "run_1",
        taskId: "task_1",
        taskName: "Export evidence",
        skillName: "local-file-organizer",
        status: "succeeded",
        summary: "done",
        events: [],
        startedAt: "2026-06-09T00:00:00.000Z",
        finishedAt: "2026-06-09T00:00:00.000Z",
      },
      checkpoint: { runId: "run_1", status: "succeeded" } as never,
      trajectory: [
        {
          id: "event_1",
          runId: "run_1",
          type: "final_summary",
          sequence: 1,
          payload: { status: "succeeded" },
          redaction: {
            containsApiKey: false,
            containsFileContent: false,
            containsUserText: false,
          },
          createdAt: "2026-06-09T00:00:00.000Z",
        },
        {
          id: "event_2",
          runId: "run_1",
          type: "workspace_escape_denied",
          sequence: 2,
          payload: {
            toolName: "file_write",
            path: "/tmp/outside/report.md",
            reason: "path outside workspace",
          },
          redaction: {
            containsApiKey: false,
            containsFileContent: false,
            containsUserText: false,
          },
          createdAt: "2026-06-09T00:00:01.000Z",
        },
        {
          id: "event_3",
          runId: "run_1",
          type: "artifact_created",
          sequence: 3,
          payload: {
            artifactId: "bookmark_list",
            artifactRef: "artifact:bookmark_list",
            provenanceRef: "provenance:bookmark_list",
          },
          redaction: {
            containsApiKey: false,
            containsFileContent: false,
            containsUserText: false,
          },
          createdAt: "2026-06-09T00:00:02.000Z",
        },
      ],
      learningCandidates: [],
      verification: { passed: true, checks: ["final_summary"] },
      exportedAt: "2026-06-09T00:00:00.000Z",
    });

    expect(Object.keys(episode.files).sort()).toEqual([
      "checkpoint.json",
      "eval-candidate.json",
      "learning-candidates.json",
      "metadata.json",
      "run-graph.json",
      "run.json",
      "trajectory.jsonl",
      "verification.json",
    ]);
    expect(episode.files["trajectory.jsonl"]).toContain("\"final_summary\"");
    expect(episode.files["run-graph.json"]).toContain(
      "\"id\": \"gate:workspace_sandbox:event_2\"",
    );
    expect(episode.files["run-graph.json"]).toContain(
      "\"ref\": \"provenance:bookmark_list\"",
    );
    expect(episode.files["eval-candidate.json"]).toContain(
      "\"status\": \"pending_review\"",
    );
    expect(episode.files["metadata.json"]).toContain("\"fileCount\": 8");
  });
});
