import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentWorkspace,
  AgentWorkspaceInput,
} from "../shared/agentWorkspace";
import type {
  Storage,
  StorageBackend,
  WorkspaceRepository,
} from "../shared/storageContract";
import type { PersistenceQueueDrainOptions } from "./failureVisibleSerialQueue";
import {
  createAuthoritativeStoreBackend,
  writeStoreJsonAtomically,
} from "./storage/authoritativeStore";
import { createWorkspaceRepository } from "./storage/repositories";

export type { AgentWorkspaceInput } from "../shared/agentWorkspace";

type StoredAgentWorkspaces = {
  schemaVersion: 1;
  workspaces: AgentWorkspace[];
};

export type AgentWorkspaceStore = {
  get(id: string): Promise<AgentWorkspace | null>;
  list(): Promise<AgentWorkspace[]>;
  save(workspace: AgentWorkspace): Promise<AgentWorkspace>;
  create(input: AgentWorkspaceInput): Promise<AgentWorkspace>;
  touch(id: string): Promise<AgentWorkspace | null>;
  delete(id: string): Promise<boolean>;
  flushShadowWrites(options?: PersistenceQueueDrainOptions): Promise<void>;
};

export function createAgentWorkspaceStore(options: {
  configDir: string;
  createId?: () => string;
  now?: () => Date;
  backend?: StorageBackend;
  storage?: Storage;
}): AgentWorkspaceStore {
  const workspacesPath = path.join(options.configDir, "agent-workspaces.json");
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const authoritativeBackend = createAuthoritativeStoreBackend({
    backend: options.backend,
    storage: options.storage,
    domain: "Agent workspace",
  });
  const repository: WorkspaceRepository | null = authoritativeBackend.storage
    ? createWorkspaceRepository(authoritativeBackend.storage)
    : null;

  async function readStored(): Promise<StoredAgentWorkspaces> {
    if (authoritativeBackend.backend !== "json") {
      return {
        schemaVersion: 1,
        workspaces: repository!.list(),
      };
    }

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
    await writeStoreJsonAtomically({
      directory: options.configDir,
      filePath: workspacesPath,
      value: stored,
    });
  }

  function enqueueWorkspaceSnapshot(): void {
    authoritativeBackend.enqueueShadow(() =>
      writeStoreJsonAtomically({
        directory: options.configDir,
        filePath: workspacesPath,
        value: {
          schemaVersion: 1,
          workspaces: repository!.list(),
        } satisfies StoredAgentWorkspaces,
      }),
    );
  }

  async function saveWorkspace(
    workspace: AgentWorkspace,
  ): Promise<AgentWorkspace> {
    if (authoritativeBackend.backend !== "json") {
      authoritativeBackend.assertWritable();
      const saved = repository!.save(workspace);
      enqueueWorkspaceSnapshot();
      return saved;
    }

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
  }

  return {
    async get(id) {
      if (authoritativeBackend.backend !== "json") {
        return repository!.get(id);
      }
      const stored = await readStored();
      return stored.workspaces.find((workspace) => workspace.id === id) ?? null;
    },

    async list() {
      if (authoritativeBackend.backend !== "json") {
        return repository!.list();
      }
      const stored = await readStored();
      return [...stored.workspaces].sort(compareWorkspaceRecency);
    },

    async save(workspace) {
      return saveWorkspace(workspace);
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

      return saveWorkspace(workspace);
    },

    async touch(id) {
      const workspace = authoritativeBackend.backend === "json"
        ? (await readStored()).workspaces.find((item) => item.id === id) ?? null
        : repository!.get(id);
      if (!workspace) {
        return null;
      }

      const timestamp = now().toISOString();
      return saveWorkspace({
        ...workspace,
        updatedAt: timestamp,
        lastUsedAt: timestamp,
      });
    },

    async delete(id) {
      if (authoritativeBackend.backend !== "json") {
        authoritativeBackend.assertWritable();
        const deleted = repository!.delete(id);
        if (deleted) {
          enqueueWorkspaceSnapshot();
        }
        return deleted;
      }

      const stored = await readStored();
      const workspaces = stored.workspaces.filter((workspace) => workspace.id !== id);
      if (workspaces.length === stored.workspaces.length) {
        return false;
      }

      await writeStored({ schemaVersion: 1, workspaces });
      return true;
    },

    async flushShadowWrites(flushOptions) {
      await authoritativeBackend.flushShadowWrites(flushOptions);
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
