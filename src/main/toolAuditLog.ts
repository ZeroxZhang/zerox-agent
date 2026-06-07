import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ToolAuditEvent,
  ToolAuditEventInput,
} from "../shared/toolPermissions";

export type ToolAuditLog = {
  append(input: ToolAuditEventInput): Promise<ToolAuditEvent>;
  list(options?: { limit?: number }): Promise<ToolAuditEvent[]>;
};

export function createToolAuditLog(options: {
  configDir: string;
  createId?: () => string;
  now?: () => Date;
}): ToolAuditLog {
  const auditPath = path.join(options.configDir, "tool-audit.jsonl");
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  return {
    async append(input) {
      const event: ToolAuditEvent = {
        ...input,
        id: createId(),
        createdAt: now().toISOString(),
      };
      await mkdir(options.configDir, { recursive: true });
      await writeFile(auditPath, `${JSON.stringify(event)}\n`, {
        encoding: "utf8",
        flag: "a",
      });

      return event;
    },

    async list(listOptions) {
      const limit = listOptions?.limit ?? 50;

      try {
        const raw = await readFile(auditPath, { encoding: "utf8" });
        return raw
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as ToolAuditEvent)
          .reverse()
          .slice(0, limit);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }

        throw error;
      }
    },
  };
}
