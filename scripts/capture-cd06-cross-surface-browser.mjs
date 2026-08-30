import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow } from "electron";

const root = process.cwd();
const outputDir = path.join(root, ".zerox/verification/conversation-disclosure");

async function settle(windowInstance) {
  await windowInstance.webContents.executeJavaScript(
    `new Promise((resolve) => requestAnimationFrame(
      () => requestAnimationFrame(() => setTimeout(resolve, 120)),
    ))`,
    true,
  );
}

async function inspect(windowInstance) {
  return windowInstance.webContents.executeJavaScript(
    `(() => {
      const disclosures = Array.from(
        document.querySelectorAll('.scheduled-run-disclosure'),
      );
      const ids = disclosures.map((node) => node.getAttribute('data-disclosure-id'));
      const failed = disclosures.find((node) => node.classList.contains('is-error'));
      return {
        taskCards: document.querySelectorAll('.scheduled-task-card').length,
        disclosureCount: disclosures.length,
        disclosureIds: ids,
        duplicateDisclosureIds: ids.length - new Set(ids).size,
        failedExpanded: failed instanceof HTMLDetailsElement ? failed.open : null,
        failedRoleText: failed?.textContent?.trim().slice(0, 160) ?? '',
        childRunProjected: ids.some((id) => id?.includes('demo_run_3')),
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
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  await windowInstance.loadFile(path.join(root, "dist/index.html"), {
    hash: "scheduled-tasks",
  });
  await settle(windowInstance);
  const desktop = await inspect(windowInstance);
  await writeFile(
    path.join(outputDir, "CD06-cross-surface-desktop.png"),
    (await windowInstance.webContents.capturePage()).toPNG(),
  );

  windowInstance.setBounds({ width: 390, height: 844 });
  await windowInstance.webContents.executeJavaScript(
    `document.querySelector('.scheduled-task-grid')?.scrollIntoView({ block: 'start' })`,
    true,
  );
  await settle(windowInstance);
  const narrow = await inspect(windowInstance);
  await writeFile(
    path.join(outputDir, "CD06-cross-surface-narrow.png"),
    (await windowInstance.webContents.capturePage()).toPNG(),
  );

  const accepted =
    desktop.taskCards >= 2
    && desktop.disclosureCount === desktop.taskCards
    && desktop.duplicateDisclosureIds === 0
    && desktop.failedExpanded === true
    && desktop.failedRoleText.includes("最近失败")
    && !desktop.childRunProjected
    && !desktop.horizontalOverflow
    && !narrow.horizontalOverflow;
  const artifact = {
    schemaVersion: 1,
    kind: "cd06-cross-surface-browser-acceptance",
    status: accepted ? "passed" : "failed",
    accepted,
    source: "production-build-electron-capture",
    desktop,
    narrow,
    screenshots: [
      "CD06-cross-surface-desktop.png",
      "CD06-cross-surface-narrow.png",
    ],
  };
  await writeFile(
    path.join(outputDir, "CD06-cross-surface-browser.json"),
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
