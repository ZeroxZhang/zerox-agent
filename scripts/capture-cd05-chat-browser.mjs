import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow } from "electron";

const root = process.cwd();
const outputDir = path.join(
  root,
  ".zerox/verification/conversation-disclosure",
);

async function waitForPaint(windowInstance) {
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
      const disclosure = document.querySelector('[data-testid="conversation-disclosure"]');
      const operations = disclosure?.querySelector('.is-operations');
      const groupButton = operations?.querySelector(':scope > header > button');
      const rowIds = Array.from(
        disclosure?.querySelectorAll('[data-disclosure-id]') ?? [],
      ).map((element) => element.getAttribute('data-disclosure-id'));
      return {
        disclosureVisible: Boolean(disclosure),
        operationsExpanded: groupButton?.getAttribute('aria-expanded') ?? null,
        operationCount: Number(groupButton?.querySelector('span')?.textContent ?? 0),
        rowIds,
        duplicateRowCount: rowIds.length - new Set(rowIds).size,
        horizontalOverflow:
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
          > window.innerWidth + 2,
        activeElementLabel:
          document.activeElement?.getAttribute('aria-label')
          ?? document.activeElement?.textContent?.trim().slice(0, 80)
          ?? "",
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
    hash: "chat",
    query: { chatDisclosure: "projected" },
  });
  await waitForPaint(windowInstance);
  const legacyAbsentBeforeAction = !(await inspect(windowInstance))
    .disclosureVisible;

  await windowInstance.webContents.executeJavaScript(
    `(() => {
      document.querySelector('.home-suggestions button')?.click();
      document.querySelector('.composer')?.requestSubmit();
    })()`,
    true,
  );
  await waitForPaint(windowInstance);
  const compact = await inspect(windowInstance);
  await writeFile(
    path.join(outputDir, "CD05-chat-browser-compact.png"),
    (await windowInstance.webContents.capturePage()).toPNG(),
  );

  await windowInstance.webContents.executeJavaScript(
    `document.querySelector(
      '.conversation-disclosure-group.is-operations > header > button',
    )?.click()`,
    true,
  );
  await waitForPaint(windowInstance);
  const expanded = await inspect(windowInstance);
  await writeFile(
    path.join(outputDir, "CD05-chat-browser-expanded.png"),
    (await windowInstance.webContents.capturePage()).toPNG(),
  );

  await windowInstance.webContents.executeJavaScript(
    `(() => {
      const button = document.querySelector(
        '.conversation-disclosure-group.is-operations > header > button',
      );
      button?.focus();
      button?.click();
    })()`,
    true,
  );
  await waitForPaint(windowInstance);
  const collapsedAgain = await inspect(windowInstance);

  windowInstance.setBounds({ width: 390, height: 844 });
  await windowInstance.webContents.executeJavaScript(
    `(() => {
      const region = document.querySelector('.chat-scroll-region');
      const disclosure = document.querySelector(
        '[data-testid="conversation-disclosure"]',
      );
      disclosure?.scrollIntoView({ block: 'center' });
      if (region) region.scrollTop = disclosure?.offsetTop ?? region.scrollHeight;
    })()`,
    true,
  );
  await waitForPaint(windowInstance);
  const narrow = await inspect(windowInstance);
  await writeFile(
    path.join(outputDir, "CD05-chat-browser-narrow.png"),
    (await windowInstance.webContents.capturePage()).toPNG(),
  );

  const accepted =
    legacyAbsentBeforeAction
    && compact.disclosureVisible
    && compact.operationsExpanded === "false"
    && compact.operationCount >= 4
    && compact.duplicateRowCount === 0
    && expanded.operationsExpanded === "true"
    && expanded.duplicateRowCount === 0
    && collapsedAgain.operationsExpanded === "false"
    && collapsedAgain.activeElementLabel.includes("执行过程")
    && !compact.horizontalOverflow
    && !expanded.horizontalOverflow
    && !collapsedAgain.horizontalOverflow
    && !narrow.horizontalOverflow;
  const artifact = {
    schemaVersion: 1,
    kind: "cd05-chat-browser-acceptance",
    accepted,
    mode: "projected",
    defaultMode: "legacy",
    source: "production-build-electron-capture",
    viewportEvidence: {
      compact,
      expanded,
      collapsedAgain,
      narrow,
    },
    screenshots: [
      "CD05-chat-browser-compact.png",
      "CD05-chat-browser-expanded.png",
      "CD05-chat-browser-narrow.png",
    ],
  };
  await writeFile(
    path.join(outputDir, "CD05-chat-browser.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
  console.log(JSON.stringify(artifact, null, 2));
  windowInstance.close();
  app.quit();
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
