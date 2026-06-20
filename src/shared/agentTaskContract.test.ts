import { describe, expect, it } from "vitest";
import {
  compileAgentTaskContract,
  type AgentTaskContract,
} from "./agentTaskContract";

describe("agent task contract compiler", () => {
  it("detects Chrome bookmark Markdown delivery to Desktop from Chinese", () => {
    const contract = compileAgentTaskContract({
      description:
        "先去获取我 Chrome 浏览器的书签，按照类型分类，然后整理成一份 markdown 格式的文件，然后放在我的桌面上。",
      chatSessionId: "chat_1",
      originMessageId: "message_1",
    });

    expect(contract).toMatchObject({
      schemaVersion: 1,
      taskKind: "local_data_to_artifact",
      mode: "deterministic",
      source: { type: "chrome_bookmarks" },
      transform: { type: "grouped_markdown" },
      deliverable: {
        artifactId: "bookmark_list",
        artifactRef: "artifact:bookmark_list",
        mediaType: "text/markdown",
        destination: { kind: "desktop", filename: "bookmark_list.md" },
      },
      capabilities: [
        { id: "chrome_bookmarks_read", toolName: "chrome_bookmarks_read" },
      ],
      acceptance: {
        evidenceRefs: ["artifact:bookmark_list", "artifact:goalEvidence"],
        provenanceRequired: true,
      },
      createdFrom: {
        description:
          "先去获取我 Chrome 浏览器的书签，按照类型分类，然后整理成一份 markdown 格式的文件，然后放在我的桌面上。",
        chatSessionId: "chat_1",
        originMessageId: "message_1",
      },
    });
    expect(contract?.id).toMatch(/^task_contract_chrome_bookmarks_/);
  });

  it("detects Chrome bookmark Markdown delivery to Desktop from English", () => {
    const contract = compileAgentTaskContract({
      description:
        "Get my Chrome bookmarks, group them, write a Markdown file to Desktop.",
    });

    expect(contract).toMatchObject({
      taskKind: "local_data_to_artifact",
      mode: "deterministic",
      source: { type: "chrome_bookmarks" },
      transform: { type: "grouped_markdown" },
      deliverable: {
        artifactId: "bookmark_list",
        artifactRef: "artifact:bookmark_list",
        destination: { kind: "desktop", filename: "bookmark_list.md" },
      },
      capabilities: [
        { id: "chrome_bookmarks_read", toolName: "chrome_bookmarks_read" },
      ],
      acceptance: {
        evidenceRefs: ["artifact:bookmark_list", "artifact:goalEvidence"],
        provenanceRequired: true,
      },
    });
  });

  it("returns undefined for open-ended research goals", () => {
    expect(
      compileAgentTaskContract({
        description: "Research interesting trends in AI agents.",
      }),
    ).toBeUndefined();
  });

  it("returns undefined for Chinese bookmark Markdown export without grouping", () => {
    expect(
      compileAgentTaskContract({
        description: "获取 Chrome 书签，整理成 markdown 文件，放到桌面。",
      }),
    ).toBeUndefined();
  });

  it("creates stable ids for the same chat message and description", () => {
    const first = compileAgentTaskContract({
      description:
        "Get my Chrome bookmarks, group them, write a Markdown file to Desktop.",
      chatSessionId: "chat_1",
      originMessageId: "message_1",
    });
    const second = compileAgentTaskContract({
      description:
        "Get my Chrome bookmarks, group them, write a Markdown file to Desktop.",
      chatSessionId: "chat_1",
      originMessageId: "message_1",
    });

    expect(first?.id).toBe(second?.id);
  });

  it("creates distinct ids for distinct chat message inputs", () => {
    const first = compileAgentTaskContract({
      description:
        "Get my Chrome bookmarks, group them, write a Markdown file to Desktop.",
      chatSessionId: "chat_1",
      originMessageId: "message_1",
    });
    const second = compileAgentTaskContract({
      description:
        "Get my Chrome bookmarks, group them, write a Markdown file to Desktop.",
      chatSessionId: "chat_2",
      originMessageId: "message_2",
    });

    expect(first?.id).not.toBe(second?.id);
  });

  it("types JSON fixture to Markdown as a deterministic local artifact contract", () => {
    const contract: AgentTaskContract = {
      schemaVersion: 1,
      id: "task_contract_json_fixture_demo",
      taskKind: "local_data_to_artifact",
      mode: "deterministic",
      source: {
        type: "json_file",
        path: "/Users/demo/project/input/bookmarks.json",
      },
      transform: { type: "json_markdown" },
      deliverable: {
        artifactId: "local_fixture",
        artifactRef: "artifact:local_fixture",
        mediaType: "text/markdown",
        destination: { kind: "desktop", filename: "local_fixture.md" },
      },
      capabilities: [
        { id: "file_read", toolName: "file_read" },
        { id: "file_write", toolName: "file_write" },
      ],
      acceptance: {
        evidenceRefs: ["artifact:local_fixture"],
        provenanceRequired: true,
      },
      createdFrom: {
        description:
          "Transform the local JSON fixture into Markdown and write it to Desktop.",
      },
    };

    expect(contract).toMatchObject({
      source: { type: "json_file" },
      transform: { type: "json_markdown" },
      capabilities: [
        { id: "file_read", toolName: "file_read" },
        { id: "file_write", toolName: "file_write" },
      ],
    });
  });
});
