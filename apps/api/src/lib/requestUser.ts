import { AsyncLocalStorage } from "node:async_hooks";

/** Who is logged in for the current request (set by requireLogin). */
export interface RequestUser {
  id: number;
  email: string;
  name: string;
}

const storage = new AsyncLocalStorage<RequestUser>();

export function runAsUser<T>(user: RequestUser, fn: () => T): T {
  return storage.run(user, fn);
}

export function currentUser(): RequestUser | null {
  return storage.getStore() ?? null;
}
