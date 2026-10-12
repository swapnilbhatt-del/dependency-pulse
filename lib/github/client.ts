import { GITHUB_API_BASE, GITHUB_API_VERSION, GITHUB_TIMEOUT_MS } from "@/lib/config";
import { log } from "@/lib/log";
import { backoffMs, sleep } from "@/lib/util";

export type GithubErrorKind = "not_found" | "rate_limited" | "error";

export class GithubError extends Error {
  constructor(
    message: string,
    public readonly kind: GithubErrorKind,
    public readonly status: number | null,
  ) {
    super(message);
    this.name = "GithubError";
  }
}

/** Conditional request cache (ETag / If-None-Match). */
export interface HttpCache {
  get(url: string): Promise<{ etag: string; body: string } | null>;
  set(url: string, etag: string, body: string): Promise<void>;
}

export interface GithubClientOptions {
  token: string;
  fetchImpl?: typeof fetch;
  cache?: HttpCache;
  timeoutMs?: number;
  maxRetries?: number;
  /** Longest wait honoured inline for Retry-After / reset; beyond it the call fails as rate_limited. */
  maxWaitMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
  runId?: string;
}

export interface RateLimitState {
  remaining: number | null;
  limit: number | null;
  resetAt: Date | null;
}

export interface GithubResponse<T> {
  data: T;
  status: number;
  fromCache: boolean;
  headers: Headers;
}

const TRANSIENT = new Set([500, 502, 503, 504]);

export class GithubClient {
  readonly rate: RateLimitState = { remaining: null, limit: null, resetAt: null };
  requests = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxWaitMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: GithubClientOptions) {
    if (!opts.token) throw new GithubError("GITHUB_TOKEN is not set.", "error", null);
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? GITHUB_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? 3;
    this.maxWaitMs = opts.maxWaitMs ?? 20_000;
    this.sleep = opts.sleepImpl ?? sleep;
  }

  private updateRate(h: Headers) {
    const rem = h.get("x-ratelimit-remaining");
    const lim = h.get("x-ratelimit-limit");
    const reset = h.get("x-ratelimit-reset");
    if (rem !== null) this.rate.remaining = Number(rem);
    if (lim !== null) this.rate.limit = Number(lim);
    if (reset !== null) this.rate.resetAt = new Date(Number(reset) * 1000);
  }

  /** How long to wait before retrying a 403/429, or null if it is not a rate-limit response. */
  private rateLimitWait(res: Response, attempt: number): number | null {
    const retryAfter = res.headers.get("retry-after");
    if (retryAfter !== null) return Math.max(1, Number(retryAfter)) * 1000;
    if (res.headers.get("x-ratelimit-remaining") === "0") {
      const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
      return Math.max(1000, reset - Date.now());
    }
    // Secondary limits without headers: wait and back off exponentially.
    if (res.status === 429) return backoffMs(attempt, 60_000, 120_000);
    return null;
  }

  async get<T>(path: string, query: Record<string, string | number> = {}): Promise<GithubResponse<T>> {
    const url = new URL(path.startsWith("http") ? path : `${GITHUB_API_BASE}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    const key = url.toString();
    const cached = this.opts.cache ? await this.opts.cache.get(key).catch(() => null) : null;

    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.opts.token}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": "upstream-weekly",
      };
      if (cached) headers["If-None-Match"] = cached.etag;

      const started = Date.now();
      let res: Response;
      try {
        this.requests++;
        res = await this.fetchImpl(key, { headers, signal: AbortSignal.timeout(this.timeoutMs), redirect: "follow" });
      } catch (err) {
        if (attempt < this.maxRetries) {
          await this.sleep(backoffMs(attempt));
          continue;
        }
        const msg = err instanceof Error && err.name === "TimeoutError" ? `timed out after ${this.timeoutMs}ms` : String(err);
        throw new GithubError(`GitHub request failed: ${msg}`, "error", null);
      }
      this.updateRate(res.headers);
      log.debug("github.request", { run_id: this.opts.runId, path: url.pathname, status: res.status, duration_ms: Date.now() - started, remaining: this.rate.remaining });

      if (res.status === 304 && cached) {
        return { data: JSON.parse(cached.body) as T, status: 304, fromCache: true, headers: res.headers };
      }
      if (res.ok) {
        const text = await res.text();
        const etag = res.headers.get("etag");
        if (etag && this.opts.cache) await this.opts.cache.set(key, etag, text).catch(() => undefined);
        return { data: JSON.parse(text) as T, status: res.status, fromCache: false, headers: res.headers };
      }
      if (res.status === 404) {
        throw new GithubError("Repository not found or not accessible (404).", "not_found", 404);
      }
      if (res.status === 403 || res.status === 429) {
        const wait = this.rateLimitWait(res, attempt);
        if (wait !== null) {
          log.warn("github.rate_limited", { run_id: this.opts.runId, path: url.pathname, wait_ms: wait, remaining: this.rate.remaining });
          if (wait <= this.maxWaitMs && attempt < this.maxRetries) {
            await this.sleep(wait);
            continue;
          }
          const resetText = this.rate.resetAt ? ` Resets at ${this.rate.resetAt.toISOString()}.` : "";
          throw new GithubError(`GitHub rate limit reached.${resetText}`, "rate_limited", res.status);
        }
        throw new GithubError(`GitHub denied access (${res.status}). Check that GITHUB_TOKEN can read public repositories.`, "error", res.status);
      }
      if (TRANSIENT.has(res.status) && attempt < this.maxRetries) {
        await this.sleep(backoffMs(attempt));
        continue;
      }
      if (res.status === 401) throw new GithubError("GitHub rejected GITHUB_TOKEN (401). It may be expired or revoked.", "error", 401);
      const body = await res.text().catch(() => "");
      throw new GithubError(`GitHub returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`, "error", res.status);
    }
  }
}
