import { randomUUID } from "node:crypto";
import {
  mkdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  Storage,
  StorageBackend,
} from "../../shared/storageContract";
import {
  createFailureVisibleSerialQueue,
  type PersistenceQueueDrainOptions,
} from "../failureVisibleSerialQueue";

export type AuthoritativeStoreBackend = {
  backend: StorageBackend;
  storage: Storage | null;
  assertWritable(): void;
  enqueueShadow(operation: () => Promise<unknown>): void;
  flushShadowWrites(options?: PersistenceQueueDrainOptions): Promise<void>;
};

export function createAuthoritativeStoreBackend(options: {
  backend?: StorageBackend;
  storage?: Storage;
  domain: string;
}): AuthoritativeStoreBackend {
  const backend = options.backend ?? "json";
  if (backend !== "json" && !options.storage) {
    throw new Error(
      `${options.domain} store requires SQLite storage for backend "${backend}".`,
    );
  }
  const shadowQueue =
    backend === "dual" ? createFailureVisibleSerialQueue() : null;

  return {
    backend,
    storage: options.storage ?? null,
    assertWritable() {
      shadowQueue?.assertOpen();
    },
    enqueueShadow(operation) {
      if (shadowQueue) {
        void shadowQueue.enqueue(operation);
      }
    },
    async flushShadowWrites(drainOptions) {
      await shadowQueue?.drain(drainOptions);
    },
  };
}

export async function writeStoreJsonAtomically(options: {
  directory: string;
  filePath: string;
  value: unknown;
}): Promise<void> {
  await mkdir(options.directory, { recursive: true });
  const temporary = path.join(
    options.directory,
    `.${path.basename(options.filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(
      temporary,
      `${JSON.stringify(options.value, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    await rename(temporary, options.filePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
