export type PersistenceQueueDrainOptions = {
  close?: boolean;
};

export type FailureVisibleSerialQueue = {
  enqueue(operation: () => Promise<unknown>): Promise<void>;
  assertOpen(): void;
  drain(options?: PersistenceQueueDrainOptions): Promise<void>;
};

const noFailure = Symbol("no-failure");

export function createFailureVisibleSerialQueue(): FailureVisibleSerialQueue {
  let tail: Promise<void> = Promise.resolve();
  let firstFailure: unknown | typeof noFailure = noFailure;
  let closed = false;

  function assertOpen(): void {
    if (closed) {
      throw new Error("Persistence queue is closed.");
    }
  }

  return {
    enqueue(operation) {
      assertOpen();
      const admitted = tail.then(async () => {
        try {
          await operation();
        } catch (error) {
          if (firstFailure === noFailure) {
            firstFailure = error;
          }
        }
      });
      tail = admitted;
      return admitted;
    },

    assertOpen,

    async drain(options) {
      if (options?.close) {
        closed = true;
      }
      const admitted = tail;
      await admitted;
      if (firstFailure !== noFailure) {
        const failure = firstFailure;
        firstFailure = noFailure;
        throw failure;
      }
    },
  };
}
