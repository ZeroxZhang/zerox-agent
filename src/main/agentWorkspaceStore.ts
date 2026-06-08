import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentWorkspace,
  AgentWorkspaceCleanup,
  AgentWorkspaceGitMetadata,
  AgentWorkspaceKind,
} from "../shared/agentWorkspace";

type StoredAgentWorkspaces = {
  schemaVersion: 1;
  workspaces: AgentWorkspace[];
};

export type AgentWorkspaceInput = {
  name: string;
  rootPath: string;
  kind: AgentWorkspaceKind;
  cleanup: AgentWorkspaceCleanup;
  git?: AgentWorkspaceGitMetadata;
};

export type AgentWorkspaceStore = {
  get(id: string): Promise<AgentWorkspace | null>;
  list(): Promise<AgentWorkspace[]>;
  save(workspace: AgentWorkspace): Promise<AgentWorkspace>;
  create(input: AgentWorkspaceInput): Promise<AgentWorkspace>;
  touch(id: string): Promise<AgentWorkspace | null>;
  delete(id: string): Promise<boolean>;
};

export function createAgentWorkspaceStore(options: {
  configDir: string;
  createId?: () => string;
  now?: () => Date;
}): AgentWorkspaceStore {
  const workspacesPath = path.join(options.configDir, "agent-workspaces.json");
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  async function readStored(): Promise<StoredAgentWorkspaces> {
    try {
      const raw = await readFile(workspacesPath, "utf8");
      const stored = JSON.parse(raw) as StoredAgentWorkspaces;
      return {
        schemaVersion: 1,
        workspaces: Array.isArray(stored.workspaces) ? stored.workspaces : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, workspaces: [] };
      }

      throw error;
    }
  }

  async function writeStored(stored: StoredAgentWorkspaces) {
    await mkdir(options.configDir, { recursive: true });
    await writeFile(workspacesPath, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: "utf8",
    });
  }

  return {
    async get(id) {
      const stored = await readStored();
      return stored.workspaces.find((workspace) => workspace.id === id) ?? null;
    },

    async list() {
      const stored = await readStored();
      return [...stored.workspaces].sort(compareWorkspaceRecency);
    },

    async save(workspace) {
      const stored = await readStored();
      const index = stored.workspaces.findIndex((item) => item.id === workspace.id);
      const workspaces =
        index === -1
          ? [...stored.workspaces, workspace]
          : stored.workspaces.map((item) =>
              item.id === workspace.id ? workspace : item,
            );
      await writeStored({ schemaVersion: 1, workspaces });
      return workspace;
    },

    async create(input) {
      const timestamp = now().toISOString();
      const workspace: AgentWorkspace = {
        id: createId(),
        name: input.name,
        rootPath: input.rootPath,
        kind: input.kind,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastUsedAt: null,
        ...(input.git ? { git: input.git } : {}),
        cleanup: input.cleanup,
      };

      return this.save(workspace);
    },

    async touch(id) {
      const workspace = await this.get(id);
      if (!workspace) {
        return null;
      }

      const timestamp = now().toISOString();
      return this.save({
        ...workspace,
        updatedAt: timestamp,
        lastUsedAt: timestamp,
      });
    },

    async delete(id) {
      const stored = await readStored();
      const workspaces = stored.workspaces.filter((workspace) => workspace.id !== id);
      if (workspaces.length === stored.workspaces.length) {
        return false;
      }

      await writeStored({ schemaVersion: 1, workspaces });
      return true;
    },
  };
}

function compareWorkspaceRecency(
  left: AgentWorkspace,
  right: AgentWorkspace,
): number {
  return (
    timestamp(right.lastUsedAt ?? right.updatedAt) -
      timestamp(left.lastUsedAt ?? left.updatedAt) ||
    right.id.localeCompare(left.id)
  );
}

function timestamp(value: string): number {
  return new Date(value).getTime();
}
