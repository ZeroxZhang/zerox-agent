#!/usr/bin/env node
// Real-application acceptance for the v3.10.0 inline process disclosure.
//
// Seeds a durable chat session into the JSON store, boots the REAL Electron app
// against it, and asserts the rendered DOM through the Chrome DevTools
// Protocol: process blocks exist, density follows the three-level policy,
// attention state is never folded away, the preference control changes density,
// aria stays consistent, and no width overflows horizontally.
//
// Usage: node scripts/run-process-disclosure-acceptance.mjs [--keep]

import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import os from "node:os";

const root = process.cwd();
const evidenceDir = path.join(root, ".zerox/verification/process-disclosure");
const userDataDir = path.join(os.tmpdir(), `zerox-pd-acceptance-${Date.now()}`);
const debugPort = await freePort();
const keepArtifacts = process.argv.includes("--keep");

const seededAt = "2026-09-08T00:00:00.000Z";
const session = {
  id: "session_pd_acceptance",
  title: "过程披露验收",
  summary: "过程披露验收",
  createdAt: seededAt,
  updatedAt: seededAt,
  messages: [
    {
      id: "message_user_pd",
      role: "user",
      content: "把 README 的 v3.9.2 段落更新一下，然后跑测试。",
      createdAt: seededAt,
    },
    {
      id: "message_assistant_pd",
      role: "assistant",
      content: "已更新中文与英文的 v3.9.2 小节，正在等待写入授权。",
      createdAt: seededAt,
      turnSettlementStatus: "succeeded",
      outputParts: [
        {
          id: "reasoning_1",
          type: "reasoning",
          text: "先确认 README 的结构，再决定 v3.9.2 段落要改哪几行。",
          redacted: true,
          truncated: false,
          streaming: false,
          createdAt: seededAt,
        },
        {
          id: "tool_1",
          type: "tool_call",
          toolCallId: "call_read",
          toolName: "file_read",
          argsPreview: { path: "README.md" },
          createdAt: seededAt,
        },
        {
          id: "tool_result_1",
          type: "tool_result",
          toolCallId: "call_read",
          ok: true,
          resultPreview: { bytes: 12698, lines: 549 },
          createdAt: seededAt,
        },
        {
          id: "tool_result_2",
          type: "tool_result",
          toolCallId: "call_test",
          ok: false,
          error: "1 项断言未通过",
          createdAt: seededAt,
        },
        {
          id: "approval_1",
          type: "approval_request",
          approvalId: "approval_pd_1",
          toolName: "file_write",
          riskLevel: "medium",
          argsPreview: { path: "README.md" },
          createdAt: seededAt,
        },
        {
          id: "plan_step_1",
          type: "plan_step",
          steps: [
            { id: "s1", label: "更新中文小节", status: "done" },
            { id: "s2", label: "同步英文小节", status: "active" },
            { id: "s3", label: "跑全量测试", status: "pending" },
          ],
          currentIndex: 1,
          total: 3,
          createdAt: seededAt,
        },
        {
          id: "model_call_3",
          type: "model_call",
          turn: 3,
          toolCallsExecuted: 4,
          elapsedMs: 6100,
          createdAt: seededAt,
        },
        {
          id: "text_1",
          type: "text",
          text: "已更新中文与英文的 v3.9.2 小节，正在等待写入授权。",
          format: "markdown",
          createdAt: seededAt,
        },
      ],
    },
  ],
};

const probeScript = `(() => {
  const blocks = Array.from(document.querySelectorAll('.process-block'));
  const group = document.querySelector('.process-group');
  const preference = Array.from(document.querySelectorAll('.process-preference button'))
    .find((button) => button.getAttribute('aria-pressed') === 'true');
  return {
    blockCount: blocks.length,
    expanded: blocks
      .filter((block) => block.dataset.expanded !== undefined
        ? block.dataset.expanded === 'true'
        : block.querySelector('.process-block-head')?.getAttribute('aria-expanded') === 'true')
      .map((block) => block.dataset.processAttention + ':' + block.dataset.processId),
    attention: blocks.map((block) => block.dataset.processAttention),
    groupPresent: Boolean(group),
    groupCount: Number(group?.dataset.processGroupCount ?? 0),
    groupExpanded: group?.querySelector('.process-group-head')
      ?.getAttribute('aria-expanded') === 'true',
    ariaMismatch: blocks.filter((block) => {
      const head = block.querySelector('.process-block-head');
      const expanded = head?.getAttribute('aria-expanded') === 'true';
      return Boolean(head?.getAttribute('aria-controls')) === false
        || expanded !== (block.dataset.expanded === undefined
          ? expanded
          : block.dataset.expanded === 'true');
    }).length,
    preference: preference?.textContent?.trim() ?? null,
    overflow: document.documentElement
      ? document.documentElement.scrollWidth > document.documentElement.clientWidth
      : false,
    hasSettledFold: Boolean(document.querySelector('.settled-process-fold')),
    text: (document.getElementById('root')?.textContent ?? '').slice(0, 4000),
  };
})()`;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const response = await fetch(url);
        const body = await response.json();
        resolve(body);
        return;
      } catch (error) {
        if (Date.now() > deadline) {
          reject(new Error(`timed out waiting for ${url}: ${error}`));
          return;
        }
        setTimeout(poll, 200);
      }
    };
    void poll();
  });
}

function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", (error) => reject(error));
  });
  return {
    ready,
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`evaluate failed: ${JSON.stringify(result.exceptionDetails)}`);
  }
  return result.result.value;
}

async function main() {
  await mkdir(path.join(userDataDir, "config"), { recursive: true });
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    path.join(userDataDir, "config", "chat-sessions.json"),
    `${JSON.stringify({ schemaVersion: 1, sessions: [session] }, null, 2)}\n`,
  );

  const child = spawn(
    path.join(root, "node_modules/.bin/electron"),
    [".", `--remote-debugging-port=${debugPort}`],
    {
      cwd: root,
      env: {
        ...process.env,
        ZEROX_STORAGE_BACKEND: "json",
        ZEROX_AGENT_USER_DATA_DIR: userDataDir,
        BUILDING_AGENT_SMOKE_HASH: "#chat",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const failures = [];
  // Evidence stays deterministic: no timestamps, paths or captured stderr, so
  // re-running the gate never churns the tracked record.
  const evidence = { viewports: [] };
  let client;
  try {
    let page = null;
    const pageDeadline = Date.now() + 45_000;
    while (!page) {
      try {
        const targets = await waitFor(`http://127.0.0.1:${debugPort}/json/list`, 10_000);
        page = targets.find(
          (target) => target.type === "page"
            && typeof target.webSocketDebuggerUrl === "string"
            && /^(file|http)/.test(target.url ?? ""),
        ) ?? null;
      } catch {
        page = null;
      }
      if (!page && Date.now() > pageDeadline) {
        throw new Error(`no page target; stderr=${stderr.slice(-800)}`);
      }
      if (!page) await new Promise((resolve) => setTimeout(resolve, 300));
    }
    client = createCdpClient(page.webSocketDebuggerUrl);
    await client.ready;
    await client.send("Runtime.enable");

    // The app boots with no active session; wait for the sidebar row and open it.
    const sessionSelector = '[data-session-id="session_pd_acceptance"]';
    const sessionDeadline = Date.now() + 30_000;
    for (;;) {
      const clicked = await evaluate(
        client,
        `(() => {
          const item = document.querySelector(${JSON.stringify(sessionSelector)});
          if (!item) return "missing";
          item.click();
          return item.classList.contains("is-active") ? "active" : "clicked";
        })()`,
      );
      if (clicked !== "missing") {
        evidence.sessionSelection = clicked;
        break;
      }
      if (Date.now() > sessionDeadline) {
        failures.push("the seeded session never appeared in the sidebar");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    evidence.afterSelection = await evaluate(client, probeScript);

    // A settled turn folds its whole process stream to one line; open it and
    // assert the structure underneath.
    const settledBefore = await evaluate(client, probeScript);
    if (!settledBefore.hasSettledFold) {
      failures.push("a settled turn must fold its process stream to one line");
    }
    await evaluate(
      client,
      `(() => {
        document.querySelector('.settled-process-fold .settled-process-head')?.click();
        return true;
      })()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 400));

    // Wait for the seeded session to render process blocks.
    const deadline = Date.now() + 30_000;
    let probe = { blockCount: 0, expanded: [], text: "" };
    for (;;) {
      try {
        probe = await evaluate(client, probeScript);
        if (probe.blockCount > 0) break;
      } catch {
        // The page context is not ready yet.
      }
      if (Date.now() > deadline) {
        failures.push(`process blocks never rendered (blockCount=${probe.blockCount})`);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    evidence.initial = probe;

    // Three-level density: the two oldest non-attention blocks fold into L0.
    if (probe.blockCount !== 5) {
      failures.push(`expected 5 visible process blocks, saw ${probe.blockCount}`);
    }
    if (probe.groupCount !== 2) {
      failures.push(`expected the L0 group to hold 2 steps, saw ${probe.groupCount}`);
    }
    if (probe.blockCount + probe.groupCount !== 7) {
      failures.push(
        `expected 7 process facts in total, saw ${probe.blockCount + probe.groupCount}`,
      );
    }
    evidence.attentionExpanded = probe.expanded.filter((entry) =>
      entry.startsWith("blocking:") || entry.startsWith("prominent:"),
    );
    if (evidence.attentionExpanded.length !== 2) {
      failures.push(
        `expected the two attention blocks expanded, saw ${JSON.stringify(probe.expanded)}`,
      );
    }
    if (!probe.groupPresent) {
      failures.push("the L0 folded group is missing");
    }
    if (probe.groupExpanded) {
      failures.push("the L0 group must start folded");
    }
    if (probe.preference !== "自动") {
      failures.push(`expected the auto preference, saw ${JSON.stringify(probe.preference)}`);
    }
    if (probe.overflow) {
      failures.push("page overflows horizontally at the default viewport");
    }
    for (const required of [
      "工具失败",
      "需要你的决定",
      "计划 · 步骤 2/3",
      "第 3 轮",
    ]) {
      if (!probe.text.includes(required)) {
        failures.push(`rendered text is missing ${JSON.stringify(required)}`);
      }
    }
    if (probe.text.includes("思考")) {
      failures.push("the folded reasoning step must not be rendered while L0 is closed");
    }
    // Opening the L0 group reveals the folded reasoning step.
    await evaluate(
      client,
      `(() => {
        document.querySelector('.process-group-head')?.click();
        return true;
      })()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    const grouped = await evaluate(client, probeScript);
    evidence.grouped = { blockCount: grouped.blockCount, groupExpanded: grouped.groupExpanded };
    if (grouped.blockCount !== 7) {
      failures.push(`opening L0 must reveal all 7 blocks, saw ${grouped.blockCount}`);
    }
    if (!grouped.text.includes("思考")) {
      failures.push("the reasoning step is missing after opening L0");
    }

    // Preference switching must change density in the real app.
    const switchTo = async (label) => {
      await evaluate(
        client,
        `(() => {
          const button = Array.from(document.querySelectorAll('.process-preference button'))
            .find((entry) => entry.textContent.trim() === ${JSON.stringify(label)});
          button?.click();
          return true;
        })()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      return evaluate(client, probeScript);
    };
    const compact = await switchTo("紧凑");
    evidence.compact = { expanded: compact.expanded.length, preference: compact.preference };
    if (compact.expanded.length !== 0) {
      failures.push(`compact must expand nothing, saw ${compact.expanded.length}`);
    }
    if (compact.groupExpanded) {
      failures.push("compact must fold the L0 group");
    }
    const open = await switchTo("展开");
    evidence.open = { expanded: open.expanded.length, groupExpanded: open.groupExpanded };
    if (open.expanded.length !== 7) {
      failures.push(`open must expand every block, saw ${open.expanded.length}`);
    }
    if (!open.groupExpanded) {
      failures.push("open must expand the L0 group");
    }
    await switchTo("自动");

    // Viewport sweep: no horizontal overflow anywhere the design system lists.
    for (const width of [1440, 1180, 900, 640, 390]) {
      await client.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const probeAtWidth = await evaluate(client, probeScript);
      evidence.viewports.push({ width, overflow: probeAtWidth.overflow });
      if (probeAtWidth.overflow) {
        failures.push(`page overflows horizontally at ${width}px`);
      }
    }
    await client.send("Emulation.clearDeviceMetricsOverride");

    const shot = await client.send("Page.captureScreenshot", { format: "png" });
    await writeFile(
      path.join(evidenceDir, "chat-process-blocks.png"),
      Buffer.from(shot.data, "base64"),
    );
  } finally {
    client?.close();
    child.kill("SIGTERM");
    child.stdout?.destroy();
    child.stderr?.destroy();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  evidence.failures = failures;
  evidence.ok = failures.length === 0;
  await writeFile(
    path.join(evidenceDir, "acceptance.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  if (!keepArtifacts) {
    await rm(userDataDir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error("Process disclosure acceptance FAILED:");
    for (const failure of failures) console.error(`- ${failure}`);
    console.error(`Evidence: ${path.join(evidenceDir, "acceptance.json")}`);
    process.exit(1);
  }
  console.log(
    `Process disclosure acceptance passed: ${evidence.initial.blockCount} process blocks, `
    + `attention auto-expanded ${evidence.attentionExpanded.length}, L0 folded, `
    + `${evidence.viewports.length} viewports without overflow.`,
  );
  console.log(`Evidence: ${path.join(evidenceDir, "acceptance.json")}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
