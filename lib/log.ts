/** Structured JSON logging. Never pass secret values in fields. */
type Level = "debug" | "info" | "warn" | "error";

export interface LogFields {
  run_id?: string;
  repo?: string;
  step?: string;
  duration_ms?: number;
  [key: string]: unknown;
}

function emit(level: Level, msg: string, fields: LogFields = {}) {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, f?: LogFields) => emit("debug", msg, f),
  info: (msg: string, f?: LogFields) => emit("info", msg, f),
  warn: (msg: string, f?: LogFields) => emit("warn", msg, f),
  error: (msg: string, f?: LogFields) => emit("error", msg, f),
};

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
