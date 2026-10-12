import { COLLECTION } from "@/lib/health/config";
import { errorMessage } from "@/lib/log";
import { backoffMs, sleep } from "@/lib/util";

/**
 * Minimal JSON fetcher for the public (keyless) health sources. Every call has
 * a timeout and bounded retries, and is memoized for the duration of one run
 * so a run never fetches the same URL twice. It never throws: failures come
 * back as a typed outcome with a plain-language reason.
 */
export type FetchOutcome<T> =
  | { kind: "ok"; status: number; data: T; url: string; at: string }
  | { kind: "not_found"; status: 404; url: string; at: string; reason: string }
  | { kind: "rate_limited"; status: number; url: string; at: string; reason: string }
  | { kind: "error"; status: number | null; url: string; at: string; reason: string };

export interface HttpDeps {
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  retries?: number;
  now?: () => Date;
}

export class RunCache {
  private readonly map = new Map<string, Promise<FetchOutcome<unknown>>>();
  readonly fetched: string[] = [];
  get<T>(key: string, load: () => Promise<FetchOutcome<T>>): Promise<FetchOutcome<T>> {
    let p = this.map.get(key) as Promise<FetchOutcome<T>> | undefined;
    if (!p) {
      this.fetched.push(key);
      p = load();
      this.map.set(key, p as Promise<FetchOutcome<unknown>>);
    }
    return p;
  }
}

const TRANSIENT = new Set([429, 500, 502, 503, 504]);

export async function fetchJson<T>(
  url: string,
  init: { method?: "GET" | "POST"; body?: unknown; headers?: Record<string, string> } = {},
  deps: HttpDeps = {},
  cache?: RunCache,
): Promise<FetchOutcome<T>> {
  const key = `${init.method ?? "GET"} ${url} ${init.body ? JSON.stringify(init.body) : ""}`;
  const run = async (): Promise<FetchOutcome<T>> => {
    const f = deps.fetchImpl ?? fetch;
    const wait = deps.sleepImpl ?? sleep;
    const retries = deps.retries ?? COLLECTION.sourceRetries;
    const timeout = deps.timeoutMs ?? COLLECTION.sourceTimeoutMs;
    const at = () => (deps.now ? deps.now() : new Date()).toISOString();
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await f(url, {
          method: init.method ?? "GET",
          headers: { Accept: "application/json", "User-Agent": "upstream-weekly-adoption-check", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
          body: init.body ? JSON.stringify(init.body) : undefined,
          signal: AbortSignal.timeout(timeout),
        });
      } catch (err) {
        if (attempt < retries) {
          await wait(backoffMs(attempt));
          continue;
        }
        const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        return { kind: "error", status: null, url, at: at(), reason: timedOut ? `Timed out after ${timeout / 1000} s` : `Network error: ${errorMessage(err)}` };
      }
      if (res.status === 404) return { kind: "not_found", status: 404, url, at: at(), reason: "Not found (404)" };
      if (TRANSIENT.has(res.status)) {
        const ra = Number(res.headers.get("retry-after"));
        if (attempt < retries && (!ra || ra <= 20)) {
          await wait(ra ? ra * 1000 : backoffMs(attempt));
          continue;
        }
        if (res.status === 429) return { kind: "rate_limited", status: 429, url, at: at(), reason: "Rate limited (429)" };
        return { kind: "error", status: res.status, url, at: at(), reason: `Server error (${res.status})` };
      }
      if (!res.ok) return { kind: "error", status: res.status, url, at: at(), reason: `HTTP ${res.status}` };
      const text = await res.text();
      try {
        return { kind: "ok", status: res.status, data: JSON.parse(text) as T, url, at: at() };
      } catch {
        return { kind: "error", status: res.status, url, at: at(), reason: "Malformed JSON in response" };
      }
    }
  };
  return cache ? cache.get(key, run) : run();
}

/** Hosts we may link to from health reports (Part 10: outbound links). */
export const ALLOWED_LINK_HOSTS = ["github.com", "scorecard.dev", "securityscorecards.dev", "osv.dev", "www.npmjs.com", "npmjs.com", "pypi.org", "pypistats.org"];

export function safeSourceUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ALLOWED_LINK_HOSTS.includes(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}
