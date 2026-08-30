import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const runnerPath = path.join(
  process.cwd(),
  "scripts/verify-conversation-disclosure-continuation-v9.mjs",
);
const source = readFileSync(runnerPath, "utf8");

describe("conversation disclosure continuation runner v9", () => {
  test("is self-contained and rejects unpinned execution", async () => {
    expect(source).not.toMatch(/from ["']\.\//);
    await expect(execFileAsync(process.execPath, [runnerPath], {
      env: { PATH: process.env.PATH },
    })).rejects.toMatchObject({
      stderr: expect.stringContaining("missing required runner v9 option"),
    });
  });

  test("uses one forward-only transaction path for fresh, recovery, and replay", () => {
    expect(source).toContain("convergePreparedTransaction(fresh");
    expect(source).toContain("convergePreparedTransaction(prepared");
    expect(source).toContain("convergePreparedTransaction(completedJournal");
    expect(source).not.toContain("rollback");
    expect(source).toContain("completedMarkerPathFor");
  });

  test("rejects preload state and binds V9 assurance fields", () => {
    expect(source).toContain("rejectPreloadEnvironment()");
    expect(source).toContain("ZEROX_CD03A_RUNNER_V9_TEST_FAULT");
    expect(source).toContain('identityAssurance: "not-signed"');
    expect(source).toContain(
      'reviewAssurance: "caller-attested-not-signed"',
    );
    expect(source).toContain("callerDispatchSet: manifest.callerDispatchSet");
    expect(source).not.toContain("platform-signed");
    expect(source).not.toContain("cryptographically-proven-independent");
  });

  test("hard-roots all six classes and the rejected Round8 subject", () => {
    expect(source).toContain('"rejected_output_absent"');
    expect(source).toContain("ROUND8_POLICY_ROOT");
    expect(source).toContain("ROUND8_SNAPSHOT_ROOT");
    expect(source).toContain("ROUND8_RECEIPT_ROOTS");
    expect(source).toContain("ROUND8_FINDING_SET_DIGEST");
  });

  test("uses V9 round constants and atomic no-replace for absent publications", () => {
    expect(source).toContain("policy.round !== 9");
    expect(source).toContain("snapshot.round !== 9");
    expect(source).toContain("manifest.round !== 9");
    expect(source).toContain("archive.round !== 9");
    expect(source).toContain("rejection.rejectedRound !== 8");
    expect(source).toContain("receipt.round !== 9");
    expect(source).toContain("def atomic_noreplace(source, destination):");
    expect(source).toContain("atomic_noreplace(temp, target)");
    expect(source).not.toContain(
      'if original == "absent":\n    os.rename(temp, target',
    );
    expect(source).toContain("atomic_exchange(temp, target)");
    expect(source).toContain("target original identity is stale");
    expect(source).toContain("finalizePreparedJournal(");
    expect(source).toContain(
      "completed marker inode does not match its filename binding",
    );
  });
});
