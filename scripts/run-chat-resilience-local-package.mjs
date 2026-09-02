#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const packageRoot = path.join(
  root,
  "release-local/mac-arm64/Zerox Agent.app",
);
const executable = path.join(packageRoot, "Contents/MacOS/Zerox Agent");
const appAsar = path.join(packageRoot, "Contents/Resources/app.asar");
const outputDir = path.join(root, ".zerox/verification");
const receiptPath = path.join(
  outputDir,
  "chat-resilience-local-package.json",
);
const screenshotPath = path.join(
  outputDir,
  "chat-resilience-local-package.png",
);

const userDataDir = await mkdtemp(
  path.join(os.tmpdir(), "zerox-chat-resilience-"),
);
const provider = await startProviderFixture();
const debugPort = 43_000 + Math.floor(Math.random() * 5_000);
let appProcess;
let cdp;

try {
  await seedModelSettings(userDataDir, provider.baseUrl);
  appProcess = spawn(
    executable,
    ["--no-sandbox", `--remote-debugging-port=${debugPort}`],
    {
      cwd: root,
      env: {
        ...process.env,
        ZEROX_AGENT_USER_DATA_DIR: userDataDir,
        ZEROX_STORAGE_BACKEND: "sqlite",
        ZEROX_DISABLE_AUTO_UPDATE: "1",
        OPENAI_API_KEY: "local-fixture-key",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stderr = [];
  appProcess.stderr.on("data", (chunk) => {
    stderr.push(String(chunk).slice(-2_000));
    if (stderr.length > 12) stderr.shift();
  });

  const target = await waitForRendererTarget(debugPort, appProcess, stderr);
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await waitForComposer(cdp);

  const runResult = await evaluate(cdp, `
    (async () => {
      const result = await window.buildingAgent.sendChatMessage({
        sessionId: "local-package-output-limit",
        requestId: "local-package-output-limit-request",
        message: "请输出一段会跨越服务商单次长度上限的结果。"
      });
      const session = await window.buildingAgent.getChatSession(
        "local-package-output-limit"
      );
      return { result, session };
    })()
  `);

  const outputLimitAccepted = Boolean(
    runResult?.result?.ok
    && runResult?.result?.agentStatus?.state === "completed"
    && runResult?.result?.reply?.includes("第一段内容，")
    && runResult?.result?.reply?.includes("第二段自动续写完成。")
    && provider.modelCallCount() === 2
    && !runResult?.session?.activity?.statusEvents?.some(
      (event) =>
        event?.state === "paused"
        && event?.agentStatus?.reason === "provider_output_limit",
    ),
  );

  await evaluate(cdp, `
    (() => {
      const input = document.querySelector('[data-testid="agent-message-input"]');
      if (!(input instanceof HTMLTextAreaElement)) return false;
      const form = input.closest("form");
      window.__zeroxImeAcceptance = {
        formSubmitCount: 0,
        compositionEvents: [],
        keyEvents: []
      };
      form?.addEventListener("submit", () => {
        window.__zeroxImeAcceptance.formSubmitCount += 1;
      }, true);
      input.addEventListener("compositionstart", () => {
        window.__zeroxImeAcceptance.compositionEvents.push("start");
      });
      input.addEventListener("compositionend", () => {
        window.__zeroxImeAcceptance.compositionEvents.push("end");
      });
      input.addEventListener("keydown", (event) => {
        window.__zeroxImeAcceptance.keyEvents.push({
          key: event.key,
          keyCode: event.keyCode,
          isComposing: event.isComposing,
          trusted: event.isTrusted
        });
      }, true);
      input.focus();
      return document.activeElement === input;
    })()
  `);
  await cdp.send("Input.imeSetComposition", {
    text: "测试输入法",
    selectionStart: 5,
    selectionEnd: 5,
    replacementStart: 0,
    replacementEnd: 0,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  const imeObservation = await evaluate(cdp, `
    (() => ({
      ...window.__zeroxImeAcceptance,
      inputValue:
        document.querySelector('[data-testid="agent-message-input"]')?.value
        ?? "",
      inputFocused:
        document.activeElement
        === document.querySelector('[data-testid="agent-message-input"]')
    }))()
  `);
  const compositionEnter = imeObservation?.keyEvents?.find(
    (event) => event?.key === "Enter",
  );
  const imeAccepted = Boolean(
    imeObservation?.formSubmitCount === 0
    && imeObservation?.compositionEvents?.includes("start")
    && compositionEnter?.trusted === true
    && (
      compositionEnter?.isComposing === true
      || compositionEnter?.keyCode === 229
    )
    && imeObservation?.inputValue?.includes("测试输入法"),
  );

  const screenshot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  await mkdir(outputDir, { recursive: true });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const receipt = {
    schemaVersion: 1,
    kind: "chat-resilience-local-package-acceptance",
    status: outputLimitAccepted && imeAccepted ? "passed" : "failed",
    accepted: outputLimitAccepted && imeAccepted,
    package: {
      path: "release-local/mac-arm64/Zerox Agent.app",
      appAsarSha256: await sha256File(appAsar),
    },
    outputLimit: {
      accepted: outputLimitAccepted,
      modelCallCount: provider.modelCallCount(),
      resultOk: runResult?.result?.ok === true,
      terminalState: runResult?.result?.agentStatus?.state ?? null,
      combinedReplyObserved: Boolean(
        runResult?.result?.reply?.includes(
          "第一段内容，第二段自动续写完成。",
        ),
      ),
      providerPauseObserved: Boolean(
        runResult?.session?.activity?.statusEvents?.some(
          (event) =>
            event?.state === "paused"
            && event?.agentStatus?.reason === "provider_output_limit",
        ),
      ),
    },
    ime: {
      accepted: imeAccepted,
      formSubmitCount: imeObservation?.formSubmitCount ?? null,
      compositionEvents: imeObservation?.compositionEvents ?? [],
      enterEvent: compositionEnter ?? null,
      inputValueObserved: imeObservation?.inputValue ?? "",
      inputFocused: imeObservation?.inputFocused === true,
    },
    screenshot: ".zerox/verification/chat-resilience-local-package.png",
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
  if (!receipt.accepted) process.exitCode = 1;
} finally {
  cdp?.close();
  await terminate(appProcess);
  await provider.close();
  await rm(userDataDir, { recursive: true, force: true });
}

async function startProviderFixture() {
  let calls = 0;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) {
      response.writeHead(404).end();
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    calls += 1;
    const content = calls === 1
      ? "第一段内容，"
      : "第二段自动续写完成。";
    const finishReason = calls === 1 ? "length" : "stop";
    if (body.stream === true) {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      response.write(`data: ${JSON.stringify({
        id: `fixture-${calls}`,
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      })}\n\n`);
      response.write(`data: ${JSON.stringify({
        id: `fixture-${calls}`,
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
        usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
      })}\n\n`);
      response.end("data: [DONE]\n\n");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: `fixture-${calls}`,
      object: "chat.completion",
      choices: [{
        index: 0,
        message: { role: "assistant", content },
        finish_reason: finishReason,
      }],
      usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
    }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    modelCallCount: () => calls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function seedModelSettings(userDataPath, baseUrl) {
  const timestamp = "2026-08-31T10:00:00.000Z";
  const configDir = path.join(userDataPath, "config");
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, "model-settings.json"), `${JSON.stringify({
    schemaVersion: 2,
    connections: [{
      id: "connection_local_output_limit",
      name: "Local output-limit fixture",
      providerKind: "openai",
      values: { baseUrl },
      encryptedSecrets: {},
      credentialSource: "environment",
      verification: {
        status: "passed",
        checkedAt: timestamp,
        message: "Local deterministic fixture",
        connectionRevision: 1,
      },
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    connectionHistory: [],
    profiles: [{
      id: "profile_local_output_limit",
      name: "Local output-limit fixture",
      connectionId: "connection_local_output_limit",
      modelId: "local-output-limit-fixture",
      purpose: "chat",
      generation: {
        temperature: 0.2,
        maxTokens: 128,
        thinkingEnabled: false,
        thinkingBudgetTokens: 256,
      },
      verification: {
        status: "passed",
        checkedAt: timestamp,
        message: "Local deterministic fixture",
        connectionRevision: 1,
        profileRevision: 1,
      },
      custom: true,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    profileHistory: [],
    defaultChatProfileId: "profile_local_output_limit",
    defaultEmbeddingProfileId: null,
    hiddenRoutedModelIds: [],
    updatedAt: timestamp,
  }, null, 2)}\n`, { mode: 0o600 });
}

async function waitForRendererTarget(port, child, stderr) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(
        `Packaged app exited before renderer startup: ${stderr.join("")}`,
      );
    }
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`)
        .then((response) => response.json());
      const target = targets.find(
        (candidate) =>
          candidate.type === "page"
          && typeof candidate.webSocketDebuggerUrl === "string",
      );
      if (target) return target;
    } catch {
      // DevTools endpoint is not ready yet.
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for packaged renderer DevTools target.");
}

async function waitForComposer(client) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const ready = await evaluate(client, `Boolean(
      window.buildingAgent
      && document.querySelector('[data-testid="agent-message-input"]')
    )`).catch(() => false);
    if (ready) return;
    await delay(100);
  }
  throw new Error("Timed out waiting for the packaged Chat composer.");
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 1;
    socket.addEventListener("error", reject, { once: true });
    socket.addEventListener("open", () => {
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result);
      });
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          return new Promise((innerResolve, innerReject) => {
            pending.set(id, { resolve: innerResolve, reject: innerReject });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          socket.close();
        },
      });
    }, { once: true });
  });
}

async function evaluate(client, expression) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || "Renderer evaluation failed.");
  }
  return response.result?.value;
}

async function terminate(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(3_000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function sha256File(filePath) {
  return `sha256:${createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex")}`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
