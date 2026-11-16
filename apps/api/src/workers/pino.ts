/**
 * Small stand-in for pino on Cloudflare Workers (wrangler.jsonc aliases
 * "pino" to this file). pino writes through Node streams and worker threads,
 * which Workers do not have; this writes one JSON line per message to the
 * console, which shows up in the Workers logs.
 */
type Level = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
const LEVELS: Record<Level, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

export interface WorkerLogger {
  level: string;
  trace(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  fatal(...args: unknown[]): void;
  child(bindings: Record<string, unknown>): WorkerLogger;
}

function serializeError(value: unknown): unknown {
  return value instanceof Error ? { type: value.name, message: value.message } : value;
}

function create(level: string, bindings: Record<string, unknown>): WorkerLogger {
  const min = LEVELS[level as Level] ?? LEVELS.info;
  const write = (name: Level) => (...args: unknown[]) => {
    if (LEVELS[name] < min) return;
    const [first, second] = args;
    const fields = first && typeof first === "object" && !(first instanceof Error)
      ? Object.fromEntries(Object.entries(first as Record<string, unknown>).map(([k, v]) => [k, serializeError(v)]))
      : first instanceof Error ? { err: serializeError(first) } : {};
    const msg = typeof first === "string" ? first : typeof second === "string" ? second : undefined;
    const line = JSON.stringify({ level: name, ...bindings, ...fields, ...(msg ? { msg } : {}) });
    if (LEVELS[name] >= LEVELS.error) console.error(line);
    else if (name === "warn") console.warn(line);
    else console.log(line);
  };
  return {
    level,
    trace: write("trace"),
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    fatal: write("fatal"),
    child: (more) => create(level, { ...bindings, ...more }),
  };
}

export default function pino(options: { level?: string } = {}): WorkerLogger {
  return create(options.level ?? "info", {});
}
