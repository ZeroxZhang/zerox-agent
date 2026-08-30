import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow } from "electron";

const root = process.cwd();
const outputDir = path.join(root, ".zerox/verification/conversation-disclosure");

async function settle(windowInstance) {
  await windowInstance.webContents.executeJavaScript(
    "new Promise((resolve) => setTimeout(resolve, 180))",
    true,
  );
}

async function openInspector(windowInstance) {
  await windowInstance.webContents.executeJavaScript(
    `(() => {
      const disclosure = document.querySelector('.task-record-technical-details');
      if (disclosure instanceof HTMLDetailsElement && !disclosure.open) {
        disclosure.querySelector('summary')?.click();
      }
    })()`,
    true,
  );
  await settle(windowInstance);
}

async function inspect(windowInstance) {
  return windowInstance.webContents.executeJavaScript(
    `(() => {
      const panel = document.querySelector('[data-evidence-run-id]');
      const events = Array.from(document.querySelectorAll('.trajectory-event'));
      const preview = document.querySelector('.trajectory-panel .payload-preview');
      return {
        runId: panel?.getAttribute('data-evidence-run-id') ?? null,
        eventCount: events.length,
        labels: events.map((event) => event.textContent?.trim() ?? ''),
        selectedLabel:
          document.querySelector('.trajectory-event.is-selected')?.textContent?.trim()
          ?? null,
        previewContainsSecret: preview?.textContent?.includes('preview-secret') ?? false,
        previewContainsRedaction: preview?.textContent?.includes('[redacted]') ?? false,
        horizontalOverflow:
          Math.max(document.body.scrollWidth, document.documentElement.scrollWidth)
          > window.innerWidth + 2,
      };
    })()`,
    true,
  );
}

async function main() {
  await app.whenReady();
  await mkdir(outputDir, { recursive: true });
  const windowInstance = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  await windowInstance.loadFile(path.join(root, "dist/index.html"), {
    hash: "runs",
  });
  await settle(windowInstance);
  await openInspector(windowInstance);
  const initial = await inspect(windowInstance);
  await windowInstance.webContents.executeJavaScript(
    "document.querySelectorAll('.trajectory-event')[1]?.click()",
    true,
  );
  await settle(windowInstance);
  const selected = await inspect(windowInstance);
  windowInstance.reload();
  await settle(windowInstance);
  await openInspector(windowInstance);
  const reloaded = await inspect(windowInstance);
  await writeFile(
    path.join(outputDir, "CD07-inspector-desktop.png"),
    (await windowInstance.webContents.capturePage()).toPNG(),
  );

  const accepted =
    Boolean(initial.runId)
    && initial.runId === selected.runId
    && selected.runId === reloaded.runId
    && initial.eventCount === 2
    && initial.previewContainsRedaction
    && !initial.previewContainsSecret
    && initial.labels.some((label) => label.includes("其他证据"))
    && selected.selectedLabel?.includes("其他证据")
    && reloaded.selectedLabel === selected.selectedLabel
    && !reloaded.horizontalOverflow;
  const artifact = {
    schemaVersion: 1,
    kind: "cd07-inspector-browser-acceptance",
    status: accepted ? "passed" : "failed",
    accepted,
    source: "production-build-electron-capture",
    initial,
    selected,
    reloaded,
    screenshots: ["CD07-inspector-desktop.png"],
  };
  await writeFile(
    path.join(outputDir, "CD07-inspector-browser.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
  console.log(JSON.stringify(artifact, null, 2));
  windowInstance.close();
  app.quit();
  if (!accepted) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
