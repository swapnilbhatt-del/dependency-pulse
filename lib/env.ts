import "server-only";

/**
 * Runtime environment access. Values are read lazily so builds never need
 * secrets, and helpers report which variables are missing without exposing
 * their values.
 */
export const REQUIRED_VARS = [
  "DATABASE_URL",
  "GITHUB_TOKEN",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "ADMIN_PASSWORD",
  "SESSION_SECRET",
  "CRON_SECRET",
  "APP_BASE_URL",
] as const;
export const OPTIONAL_VARS = ["DIGEST_RECIPIENTS", "TIMEZONE_LABEL"] as const;

type VarName = (typeof REQUIRED_VARS)[number] | (typeof OPTIONAL_VARS)[number];

export function env(name: VarName): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function configStatus(): Record<VarName, boolean> {
  const out = {} as Record<VarName, boolean>;
  for (const k of [...REQUIRED_VARS, ...OPTIONAL_VARS]) out[k] = Boolean(env(k));
  return out;
}

export function missingRequired(): string[] {
  return REQUIRED_VARS.filter((k) => !env(k));
}

export function appBaseUrl(): string {
  const explicit = env("APP_BASE_URL");
  if (explicit && /^https?:\/\//.test(explicit)) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return vercel ? `https://${vercel}` : "http://localhost:3000";
}

export function timezoneLabel(): string {
  return env("TIMEZONE_LABEL") ?? "Asia/Kolkata";
}

export function geminiModelName(): string {
  return env("GEMINI_MODEL") ?? "gemini-3.8-flash";
}

export function defaultRecipients(): string[] {
  return (env("DIGEST_RECIPIENTS") ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
}
