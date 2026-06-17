import { describe, expect, it } from "vitest";
import {
  getToolCapability,
  getToolCapabilityRegistry,
  preferNativeToolForOperation,
} from "./agentToolCapabilities";

describe("agent tool capabilities", () => {
  it("describes native tools with batching, side-effect, and platform metadata", () => {
    expect(getToolCapability("file_list")).toMatchObject({
      name: "file_list",
      sideEffect: "local_read",
      supportsBatch: false,
      supportsRecursive: false,
      resultSizeRisk: "medium",
      platformSensitivity: "none",
    });
    expect(getToolCapability("shell_exec")).toMatchObject({
      name: "shell_exec",
      sideEffect: "destructive",
      platformSensitivity: "shell_specific",
      requiresConfirmation: true,
    });
  });

  it("keeps the registry keyed by tool name", () => {
    expect(getToolCapabilityRegistry().get("test_run")).toMatchObject({
      name: "test_run",
      preferredFor: ["code:test"],
    });
  });

  it("describes native batch file organizer capabilities", () => {
    expect(getToolCapability("file_inventory")).toMatchObject({
      name: "file_inventory",
      sideEffect: "local_read",
      supportsBatch: true,
      supportsRecursive: true,
      requiresConfirmation: false,
    });
    expect(getToolCapability("file_apply_moves")).toMatchObject({
      name: "file_apply_moves",
      sideEffect: "local_write",
      supportsBatch: true,
      requiresConfirmation: true,
      preferredFor: ["files:apply_moves"],
    });
    expect(getToolCapability("file_rollback_moves")).toMatchObject({
      name: "file_rollback_moves",
      sideEffect: "local_write",
      supportsBatch: true,
      requiresConfirmation: true,
      preferredFor: ["files:rollback_moves"],
    });
  });

  it("describes Chrome bookmark reading as a native browser capability", () => {
    expect(getToolCapability("chrome_bookmarks_read")).toMatchObject({
      name: "chrome_bookmarks_read",
      domain: "browser",
      sideEffect: "local_write",
      supportsBatch: true,
      supportsRecursive: true,
      requiresConfirmation: true,
      preferredFor: ["browser:chrome_bookmarks"],
    });
  });

  it("prefers native tools over shell for known operations", () => {
    expect(
      preferNativeToolForOperation({
        domain: "code",
        operation: "run npm test for the changed package",
        currentToolName: "shell_exec",
      }),
    ).toMatchObject({
      preferredToolName: "test_run",
      reason: "test_run is the native tool for code:test.",
    });
    expect(
      preferNativeToolForOperation({
        domain: "web",
        operation: "parse Chrome bookmarks JSON with python",
        currentToolName: "shell_exec",
      }),
    ).toMatchObject({
      preferredToolName: "chrome_bookmarks_read",
      reason: "chrome_bookmarks_read is the native tool for browser:chrome_bookmarks.",
    });
  });
});
