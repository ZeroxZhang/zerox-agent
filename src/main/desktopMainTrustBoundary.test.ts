import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Electron main trust boundary wiring", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/main/main.ts"),
    "utf8",
  );

  it("binds trusted renderer loading, navigation denial, and IPC sender checks", () => {
    expect(source).toContain("resolveTrustedRendererSource({");
    expect(source).toContain("isPackaged: app.isPackaged");
    expect(source).toContain("installRendererTrustPolicy(windowInstance)");
    expect(source).toContain(
      'webContents.setWindowOpenHandler(() => ({ action: "deny" }))',
    );
    expect(source).toContain('"will-navigate"');
    expect(source).toContain('"will-redirect"');
    expect(source).toContain("event.sender !== windowInstance.webContents");
    expect(source).toContain(
      "isTrustedRendererLocation(location, rendererSource)",
    );
    expect(source).toContain("isTrustedSender: isTrustedRendererIpcEvent");
  });

  it("recreates a crashed renderer only within the bounded recovery policy", () => {
    expect(source).toContain('"render-process-gone"');
    expect(source).toContain("rendererCrashRecovery.recordCrash()");
    expect(source).toContain("if (!decision.recover)");
    expect(source).toContain("app.quit()");
    expect(source).toContain("createMainWindow()");
  });
});
