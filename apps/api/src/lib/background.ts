import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Work that keeps running after the response has been sent (an article being
 * written, a website scan, ...).
 *
 * On a normal Node server the work simply continues in the background. On
 * Cloudflare Workers a request stops when its response is finished, so the
 * Worker entry (worker.ts) collects these tasks per request and only finishes
 * the response once they are done; the browser keeps waiting meanwhile.
 */
export interface BackgroundTasks {
  tasks: Promise<unknown>[];
  /** Objects that hold a connection and may only be used within this request. */
  shared?: Map<string, unknown>;
}

const collectors = new AsyncLocalStorage<BackgroundTasks>();

export function collectBackgroundTasks<T>(store: BackgroundTasks, fn: () => T): T {
  return collectors.run(store, fn);
}

export function runInBackground(task: () => Promise<unknown>, onError?: (error: unknown) => void): void {
  const running = task().catch((error: unknown) => {
    onError?.(error);
  });
  collectors.getStore()?.tasks.push(running);
}

/** Waits until every collected task has finished, including tasks started by other tasks. */
export async function waitForBackgroundTasks(store: BackgroundTasks): Promise<void> {
  let done = 0;
  while (done < store.tasks.length) {
    const pending = store.tasks.slice(done);
    done = store.tasks.length;
    await Promise.allSettled(pending);
  }
}

/**
 * On Workers: a map that lives as long as the current request, for objects
 * that hold a network connection (Workers do not allow using a connection
 * from another request). Elsewhere: null, so callers keep one global copy.
 */
export function requestCache(): Map<string, unknown> | null {
  const store = collectors.getStore();
  if (!store) return null;
  store.shared ??= new Map();
  return store.shared;
}
