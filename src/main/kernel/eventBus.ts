import type { KernelEvent } from "../../shared/kernelContract";

export type KernelEventHandler = (event: KernelEvent) => void;

// v3.6.0: Maximum number of events retained in the history buffer (DATA-20).
const MAX_EVENT_HISTORY = 1000;

export class KernelEventBus {
  private readonly handlers = new Set<KernelEventHandler>();
  private readonly events: KernelEvent[] = [];

  publish(event: KernelEvent): void {
    // v3.6.0: Cap history to ring buffer; discard oldest when full (DATA-20, CONC-07).
    if (this.events.length >= MAX_EVENT_HISTORY) {
      this.events.shift();
    }
    this.events.push(event);

    for (const handler of [...this.handlers]) {
      try {
        handler(event);
      } catch {
        // A broken observer must not interrupt the kernel or other observers.
      }
    }
  }

  subscribe(handler: KernelEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  history(): KernelEvent[] {
    return [...this.events];
  }

  stream(filter: (event: KernelEvent) => boolean = () => true): AsyncIterable<KernelEvent> {
    const queue: KernelEvent[] = [];
    let isClosed = false;
    let resolveNext: ((result: IteratorResult<KernelEvent>) => void) | undefined;

    const unsubscribe = this.subscribe((event) => {
      if (!filter(event) || isClosed) {
        return;
      }

      if (resolveNext) {
        const resolve = resolveNext;
        resolveNext = undefined;
        resolve({ value: event, done: false });
        return;
      }

      queue.push(event);
    });

    return {
      [Symbol.asyncIterator](): AsyncIterator<KernelEvent> {
        return {
          next(): Promise<IteratorResult<KernelEvent>> {
            if (isClosed) {
              return Promise.resolve({ value: undefined, done: true });
            }

            const queued = queue.shift();
            if (queued) {
              return Promise.resolve({ value: queued, done: false });
            }

            return new Promise<IteratorResult<KernelEvent>>((resolve) => {
              resolveNext = resolve;
            });
          },

          return(): Promise<IteratorResult<KernelEvent>> {
            isClosed = true;
            unsubscribe();
            if (resolveNext) {
              const resolve = resolveNext;
              resolveNext = undefined;
              resolve({ value: undefined, done: true });
            }
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
  }
}
