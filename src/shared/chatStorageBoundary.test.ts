import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("production Chat storage boundary", () => {
  it("uses SQLite Chat storage independently of the legacy global default", () => {
    const container = read("src/main/container.ts");

    expect(container).toContain('backend: "sqlite"');
    expect(container).toContain("storage: sqlite");
    expect(container).toContain(
      "SQLite open failure is the only runtime degradation path.",
    );
    expect(container).toContain(
      'createChatSessionStore({ configDir, backend: "json" })',
    );
  });

  it("keeps the projection message-free and list reads projection rows only", () => {
    const repository = read(
      "src/main/storage/repositories/chatSessionEventRepository.ts",
    );
    const listMethod = repository.slice(
      repository.indexOf("    listProjections() {"),
      repository.indexOf("    getSession(sessionId) {"),
    );

    expect(repository).toContain(
      'export const CHAT_SESSION_PROJECTION_VERSION = 1',
    );
    expect(repository).toContain(
      'export type ChatSessionMetadata = Omit<ChatSessionRecord, "messages">',
    );
    expect(listMethod).toContain("FROM chat_session_projections");
    expect(listMethod).not.toContain("chat_messages");
  });

  it("persists mutation facts, projection watermark, and message rows transactionally", () => {
    const repository = read(
      "src/main/storage/repositories/chatSessionEventRepository.ts",
    );

    expect(repository).toContain('db.exec("BEGIN IMMEDIATE")');
    expect(repository).toContain("INSERT INTO chat_session_events");
    expect(repository).toContain("INSERT INTO chat_messages");
    expect(repository).toContain("upsertProjection(db, projection)");
    expect(repository).toContain("watermark: sequence");
  });

  it("keeps rollback export explicit and sourced from Chat projections", () => {
    const rollback = read("scripts/rollback-sqlite-to-json.mjs");

    expect(rollback).toContain("--confirmSqliteAuthoritative");
    expect(rollback).toContain(
      "createChatSessionEventRepository(storage)",
    );
    expect(rollback).toMatch(/repository\s*\.\s*listProjections\(\)/);
    expect(rollback).toMatch(/repository\.getSession/);
  });
});

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}
