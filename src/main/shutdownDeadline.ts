export async function settleShutdownWithDeadline(
  shutdown: Promise<unknown>,
  timeoutMs: number,
): Promise<"drained" | "failed" | "timed_out"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      shutdown.then(
        () => "drained" as const,
        () => "failed" as const,
      ),
      new Promise<"timed_out">((resolve) => {
        timer = setTimeout(() => resolve("timed_out"), Math.max(1, timeoutMs));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
