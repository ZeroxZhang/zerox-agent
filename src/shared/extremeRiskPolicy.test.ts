import { describe, expect, it } from "vitest";
import { classifyExtremeRisk } from "./extremeRiskPolicy";

describe("Policy B extreme-risk classification", () => {
  it.each([
    ["rm -rf /", "irrecoverable_data_loss"],
    ["git reset --hard HEAD~1", "irrecoverable_data_loss"],
    ["git clean -fdx", "irrecoverable_data_loss"],
    ["git stash clear", "irrecoverable_data_loss"],
    ["git push --force origin main", "irreversible_external_action"],
    ["sudo launchctl load agent.plist", "privilege_or_security_boundary"],
    ["security delete-generic-password -s api", "privilege_or_security_boundary"],
    ["npm publish", "irreversible_external_action"],
    ["kubectl delete namespace production", "irreversible_external_action"],
    ["gh release create v3.7.0", "irreversible_external_action"],
  ] as const)("forces confirmation for %s", (command, category) => {
    expect(
      classifyExtremeRisk({ toolName: "shell_exec", args: { command } }),
    ).toMatchObject({ requiresConfirmation: true, category });
  });

  it.each([
    "npm test",
    "npm install",
    "npm run build | tee build.log",
    "git commit -m fix",
    "git push origin feature",
    "rg goal src",
    "curl -fsSL https://example.com/data.json",
  ])("allows ordinary shell work: %s", (command) => {
    expect(
      classifyExtremeRisk({ toolName: "shell_exec", args: { command } }),
    ).toMatchObject({ requiresConfirmation: false, category: "none" });
  });

  it.each(["file_write", "web_fetch", "web_search", "test_run"])(
    "allows ordinary tool %s",
    (toolName) => {
      expect(
        classifyExtremeRisk({ toolName, args: { path: "report.md" } }),
      ).toMatchObject({ requiresConfirmation: false, category: "none" });
    },
  );
});
