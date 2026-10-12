# Architecture

Upstream Weekly is a single Next.js 16 App Router application on Vercel. It has one Postgres database (Supabase) and three outbound integrations: GitHub, Gemini and Resend. See [COMPONENTS_MAP.md](COMPONENTS_MAP.md) for the diagram and the component-by-component table.

## Runtime shape

```
Vercel Cron ──GET + Bearer──▶ /api/cron/weekly-digest ──▶ lib/pipeline/run.ts
                                                          │
           ┌──────────────────────────────────────────────┼──────────────────────────────┐
           ▼                                              ▼                              ▼
   lib/github (ingest)                           lib/ai (Gemini Flash)          lib/delivery (Resend)
   releases · tags · advisories                  summarize + classify           one email per recipient
           │                                              │
           └──▶ lib/normalize ─▶ lib/filter ─▶ lib/signals + guardrails ─▶ lib/digest (build, render)
                                                          │
                                                   Postgres (db/schema.ts)
                                                          │
                       /, /digest/[week], /archive  ◀─────┴─────▶  /admin (repos, recipients, runs)
```

## Key decisions

- **The orchestration is a pure function of injected dependencies.** `runWeeklyDigest(deps, opts)` in `lib/pipeline/run.ts` receives the database, GitHub, Gemini and email providers through a `PipelineDeps` interface. `lib/pipeline/deps.ts` wires in the real services; `tests/unit/pipeline.test.ts` uses an in-memory fake to prove idempotency, partial failure and continuation.
- **Idempotency comes from the database.** `digest_runs.iso_week` is unique. A 6-minute lease (`lock_until`) stops concurrent duplicate invocations, and `delivered_at` stops re-sending. Each Resend call also carries an idempotency key per week and recipient.
- **The time budget is handled by continuation.** One invocation has 240 s of work budget (the Hobby limit is 300 s). If classification work remains, the run releases its lease and the cron route re-invokes itself (`?continue=<week>&hop=n`, at most 6 hops). Everything finished so far is cached in Postgres, so each hop resumes where the last stopped. Measured live: a cold full run of 27 repos takes about 66 s and a warm one about 27 s, so continuation is a safety net.
- **The AI cache is separate from the guardrails.** Raw validated model output is cached per `(release_id, body_hash, model)`. Guardrails, tiering and copy are re-applied on every run, so improving a rule never costs another model call.
- **Public pages read a stored model.** The digest is stored as a JSON `DigestModel` and rendered by React for the web and by string templates for the email. Public pages use ISR (5 minutes) and are revalidated after a send.
- **Auth.** The admin session is an HMAC-SHA256-signed, httpOnly, `SameSite=Lax` cookie with a 12-hour expiry. It is checked in `proxy.ts` and again in every admin page and server action. Login attempts are rate-limited in Postgres (5 per 15 minutes per IP hash). Password comparison is constant-time.
- **Database driver.** `postgres.js` with `prepare: false` works with Supabase's transaction pooler and with Neon's pooled URLs alike.
