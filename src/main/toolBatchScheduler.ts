export type ToolSchedulingMode = "parallel" | "exclusive";

export type ToolBatchItem<T> = {
  value: T;
  mode: ToolSchedulingMode;
};

export type ToolBatchResult<T> =
  | {
      status: "fulfilled";
      index: number;
      value: T;
    }
  | {
      status: "rejected";
      index: number;
      reason: unknown;
    }
  | {
      status: "skipped";
      index: number;
      reason: "canceled" | "prior_failure" | "stopped";
    };

export async function scheduleToolBatch<TInput, TOutput>(
  items: readonly ToolBatchItem<TInput>[],
  options: {
    maxParallel: number;
    signal?: AbortSignal;
    execute(input: TInput, index: number): Promise<TOutput>;
    commit?(
      result: ToolBatchResult<TOutput>,
      index: number,
    ): void | boolean | Promise<void | boolean>;
    afterGroup?(input: {
      start: number;
      end: number;
      results: Array<ToolBatchResult<TOutput>>;
    }): void | boolean | Promise<void | boolean>;
  },
): Promise<Array<ToolBatchResult<TOutput>>> {
  const results = new Array<ToolBatchResult<TOutput> | undefined>(
    items.length,
  );
  const maxParallel = normalizeParallelism(options.maxParallel);
  let cursor = 0;

  while (cursor < items.length) {
    if (options.signal?.aborted) {
      markSkipped(
        results,
        cursor,
        items.length,
        "canceled",
      );
      break;
    }

    const item = items[cursor]!;
    if (item.mode === "exclusive") {
      results[cursor] = await executeOne(
        item.value,
        cursor,
        options.execute,
      );
      const shouldContinue = await commitGroup(
        results,
        cursor,
        cursor + 1,
        options,
      );
      cursor += 1;
      if (!shouldContinue) {
        markSkipped(results, cursor, items.length, "stopped");
        break;
      }
      if (results[cursor - 1]?.status === "rejected") {
        markSkipped(
          results,
          cursor,
          items.length,
          options.signal?.aborted ? "canceled" : "prior_failure",
        );
        break;
      }
      continue;
    }

    const groupStart = cursor;
    while (
      cursor < items.length &&
      items[cursor]?.mode === "parallel"
    ) {
      cursor += 1;
    }
    await executeParallelGroup({
      items,
      results,
      start: groupStart,
      end: cursor,
      maxParallel,
      signal: options.signal,
      execute: options.execute,
    });
    const shouldContinue = await commitGroup(
      results,
      groupStart,
      cursor,
      options,
    );
    if (!shouldContinue) {
      markSkipped(results, cursor, items.length, "stopped");
      break;
    }

    const groupRejected = results
      .slice(groupStart, cursor)
      .some((result) => result?.status === "rejected");
    if (groupRejected || options.signal?.aborted) {
      markSkipped(
        results,
        cursor,
        items.length,
        options.signal?.aborted ? "canceled" : "prior_failure",
      );
      break;
    }
  }

  for (let index = 0; index < results.length; index += 1) {
    results[index] ??= {
      status: "skipped",
      index,
      reason: options.signal?.aborted ? "canceled" : "prior_failure",
    };
  }
  return results as Array<ToolBatchResult<TOutput>>;
}

export type SerialToolPolicyAdmission = {
  run<T>(
    operation: (release: () => void) => Promise<T>,
    options?: { signal?: AbortSignal },
  ): Promise<T>;
};

export function createSerialToolPolicyAdmission(): SerialToolPolicyAdmission {
  let tail = Promise.resolve();

  return {
    async run(operation, options = {}) {
      let releaseTurn!: () => void;
      const turn = new Promise<void>((resolve) => {
        releaseTurn = resolve;
      });
      const predecessor = tail;
      tail = predecessor.catch(() => undefined).then(() => turn);
      await predecessor.catch(() => undefined);

      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        releaseTurn();
      };

      try {
        if (options.signal?.aborted) {
          throw abortReason(options.signal);
        }
        return await operation(release);
      } finally {
        release();
      }
    },
  };
}

async function executeParallelGroup<TInput, TOutput>(input: {
  items: readonly ToolBatchItem<TInput>[];
  results: Array<ToolBatchResult<TOutput> | undefined>;
  start: number;
  end: number;
  maxParallel: number;
  signal?: AbortSignal;
  execute(value: TInput, index: number): Promise<TOutput>;
}): Promise<void> {
  let nextIndex = input.start;
  let admissionClosed = false;
  const workerCount = Math.min(
    input.maxParallel,
    input.end - input.start,
  );

  const worker = async () => {
    for (;;) {
      if (admissionClosed || input.signal?.aborted) {
        return;
      }
      const index = nextIndex;
      if (index >= input.end) {
        return;
      }
      nextIndex += 1;
      const result = await executeOne(
        input.items[index]!.value,
        index,
        input.execute,
      );
      input.results[index] = result;
      if (result.status === "rejected") {
        admissionClosed = true;
      }
    }
  };

  await Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  );

  const reason = input.signal?.aborted ? "canceled" : "prior_failure";
  markSkipped(input.results, input.start, input.end, reason);
}

async function executeOne<TInput, TOutput>(
  value: TInput,
  index: number,
  execute: (value: TInput, index: number) => Promise<TOutput>,
): Promise<ToolBatchResult<TOutput>> {
  try {
    return {
      status: "fulfilled",
      index,
      value: await execute(value, index),
    };
  } catch (reason) {
    return {
      status: "rejected",
      index,
      reason,
    };
  }
}

function markSkipped<T>(
  results: Array<ToolBatchResult<T> | undefined>,
  start: number,
  end: number,
  reason: "canceled" | "prior_failure" | "stopped",
): void {
  for (let index = start; index < end; index += 1) {
    results[index] ??= {
      status: "skipped",
      index,
      reason,
    };
  }
}

async function commitGroup<TOutput>(
  results: Array<ToolBatchResult<TOutput> | undefined>,
  start: number,
  end: number,
  options: {
    commit?(
      result: ToolBatchResult<TOutput>,
      index: number,
    ): void | boolean | Promise<void | boolean>;
    afterGroup?(input: {
      start: number;
      end: number;
      results: Array<ToolBatchResult<TOutput>>;
    }): void | boolean | Promise<void | boolean>;
  },
): Promise<boolean> {
  let shouldContinue = true;
  const groupResults: Array<ToolBatchResult<TOutput>> = [];
  for (let index = start; index < end; index += 1) {
    const result = results[index];
    if (!result) {
      throw new Error(`Tool batch result ${index} was not settled.`);
    }
    groupResults.push(result);
    if (options.commit && (await options.commit(result, index)) === false) {
      shouldContinue = false;
    }
  }
  if (
    options.afterGroup &&
    (await options.afterGroup({ start, end, results: groupResults })) === false
  ) {
    shouldContinue = false;
  }
  return shouldContinue;
}

function normalizeParallelism(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Tool batch canceled.");
}
