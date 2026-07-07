import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow } from "electron";

const projectRoot = process.cwd();
const distIndexPath = path.join(projectRoot, "dist", "index.html");
const outputDir = path.join(
  projectRoot,
  "docs",
  "design",
  "zerox-agent-3-2-2-qa",
);

const views = [
  {
    fileName: "01-chat-desktop.png",
    hash: "chat",
    height: 900,
    name: "Chat desktop",
    width: 1440,
  },
  {
    fileName: "02-runs-desktop.png",
    hash: "runs",
    height: 900,
    name: "Runs desktop",
    width: 1440,
  },
  {
    fileName: "03-settings-desktop.png",
    hash: "model-settings",
    height: 900,
    name: "Settings desktop",
    width: 1440,
  },
  {
    fileName: "04-chat-narrow.png",
    hash: "chat",
    height: 844,
    name: "Chat narrow",
    width: 390,
  },
  {
    fileName: "05-settings-narrow.png",
    hash: "model-settings",
    height: 844,
    name: "Settings narrow",
    width: 390,
  },
];

function waitForLoad(windowInstance) {
  return new Promise((resolve, reject) => {
    windowInstance.webContents.once("did-finish-load", resolve);
    windowInstance.webContents.once(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL) => {
        reject(
          new Error(
            `Load failed (${errorCode}): ${errorDescription} ${validatedURL}`,
          ),
        );
      },
    );
  });
}

function waitForPaint(windowInstance) {
  return windowInstance.webContents.executeJavaScript(
    `new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => window.setTimeout(resolve, 120));
      });
    })`,
    true,
  );
}

function collectMetrics(windowInstance) {
  return windowInstance.webContents.executeJavaScript(
    `(() => {
      const root = document.documentElement;
      const body = document.body;
      const shell = document.querySelector(".app-shell");
      const activeNav = document.querySelector(".nav-item.is-active");
      const settingsShell = document.querySelector(".settings-section-shell");
      const styles = getComputedStyle(root);
      const clipped = Array.from(document.querySelectorAll("*"))
        .filter((element) => element instanceof HTMLElement)
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.right > window.innerWidth + 2;
        })
        .slice(0, 12)
        .map((element) => ({
          className: element.className,
          tagName: element.tagName,
          text: element.textContent?.trim().slice(0, 80) ?? "",
          right: Math.round(element.getBoundingClientRect().right),
        }));

      return {
        activeNavLabel: activeNav?.textContent?.trim() ?? "",
        appShellRendered: Boolean(shell),
        bodyScrollWidth: body.scrollWidth,
        clippedElementSamples: clipped,
        colorAppBg: styles.getPropertyValue("--color-app-bg").trim(),
        colorSurfacePrimary: styles.getPropertyValue("--color-surface-primary").trim(),
        colorActionPrimary: styles.getPropertyValue("--color-action-primary").trim(),
        hash: window.location.hash,
        hasPageHorizontalOverflow: Math.max(root.scrollWidth, body.scrollWidth) > window.innerWidth + 2,
        height: window.innerHeight,
        mainText: body.innerText.replace(/\\s+/g, " ").trim().slice(0, 600),
        rootScrollHeight: root.scrollHeight,
        rootScrollWidth: root.scrollWidth,
        settingsShellRendered: Boolean(settingsShell),
        width: window.innerWidth,
      };
    })()`,
    true,
  );
}

async function captureView(view) {
  const windowInstance = new BrowserWindow({
    height: view.height,
    show: false,
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    width: view.width,
  });

  await mkdir(outputDir, { recursive: true });
  const loadPromise = waitForLoad(windowInstance);
  await windowInstance.loadFile(distIndexPath, { hash: view.hash });
  await loadPromise;
  await waitForPaint(windowInstance);

  const image = await windowInstance.webContents.capturePage();
  const metrics = await collectMetrics(windowInstance);
  await writeFile(path.join(outputDir, view.fileName), image.toPNG());
  windowInstance.close();
  return { ...view, metrics };
}

async function main() {
  await app.whenReady();
  const results = [];
  for (const view of views) {
    results.push(await captureView(view));
  }

  const metricsPath = path.join(outputDir, "capture-metrics.json");
  await writeFile(
    metricsPath,
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        source: "scripts/capture-visual-qa.mjs",
        views: results,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`Captured ${results.length} visual QA views in ${outputDir}`);
  app.quit();
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
