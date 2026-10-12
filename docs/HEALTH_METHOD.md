# Adoption Check: health method

This document lets you **recompute any verdict by hand** from the metrics stored with a snapshot. All values below come from [`lib/health/config.ts`](../lib/health/config.ts), method version **`2026-10-12.1`**. Every snapshot records the `config_version` that produced it, so if the version on a report differs from this one, use that version of the file from git history.

Scoring is plain code, with no model involved. Gemini Flash only writes the "Decision in one minute" text, from the finished verdict and reasons (see [Narrative](#8-narrative-gemini-flash-text-only)).

---

## 1. Where each metric comes from

Every metric is stored as `{ value, source, fetchedAt, reason?, note? }`. If a value could not be obtained it is stored as **`null` with a reason**, never as zero, and the report shows "Not available" plus that reason.

| Metric | Source (official docs) | Notes |
| --- | --- | --- |
| `archived`, `disabled`, `stars`, `forks`, `license.spdx_id`, `default_branch` | `GET /repos/{owner}/{repo}` ([docs](https://docs.github.com/en/rest/repos/repos#get-a-repository)) | Follows renames to the canonical name |
| `days_since_last_release`, `releases_in_last_365_days`, `median_days_between_releases` | `GET /repos/{o}/{r}/releases?per_page=100` ([docs](https://docs.github.com/en/rest/releases/releases)) | Drafts excluded; release date is `published_at`, falling back to `created_at`; at most 5 pages; median over the last 2 years, `null` with fewer than 3 releases |
| Same, for tag-only projects | `GET /repos/{o}/{r}/tags` + `GET /repos/{o}/{r}/commits/{sha}` ([docs](https://docs.github.com/en/rest/repos/repos#list-repository-tags)) | Used when the project has never published a GitHub Release. The 15 highest-version tags are dated by their commit. Labelled "tags only". |
| `days_since_last_default_branch_commit`, `commits_in_last_365_days` | `GET /repos/{o}/{r}/commits?sha={default}&since=…` ([docs](https://docs.github.com/en/rest/commits/commits)) | Capped at 10 pages (1,000 commits); a capped count is shown as "≥ 1,000" |
| `distinct_contributors_365`, `top_contributor_share_365` | Same commits | Author = GitHub login, else commit e-mail, else name. **Accounts typed `Bot` are excluded.** |
| Responsiveness sample | `GET /repos/{o}/{r}/issues?state=all&since=90d&sort=updated` (pull requests filtered out) and `GET /repos/{o}/{r}/pulls?state=all&sort=updated` ([issues](https://docs.github.com/en/rest/issues/issues), [pulls](https://docs.github.com/en/rest/pulls/pulls)) | Up to **50 issues + 50 PRs** updated in the last 90 days, bots excluded |
| First response, maintainer response | `GET /repos/{o}/{r}/issues/{n}/comments`, `GET /repos/{o}/{r}/pulls/{n}/reviews` | First response = first comment or review by someone other than the author (bots excluded). A maintainer response comes from `author_association` OWNER, MEMBER or COLLABORATOR. |
| `has_code_of_conduct`, `has_contributing_guide`, `has_issue_templates`, `community_profile_health_percentage` | `GET /repos/{o}/{r}/community/profile` ([docs](https://docs.github.com/en/rest/metrics/community)) | **Informational only**; not scored |
| `has_security_policy` | `GET /repos/{o}/{r}/contents/{SECURITY.md, .github/SECURITY.md, docs/SECURITY.md}`, then the OpenSSF Scorecard `Security-Policy` check | The community profile does **not** report SECURITY.md (verified against its schema), so the three locations GitHub recognises are checked. Scorecard's check also detects organisation-level policies. |
| CI status | `GET /repos/{o}/{r}/commits/{sha}/check-runs?filter=latest` ([docs](https://docs.github.com/en/rest/checks/runs)), falling back to `GET /repos/{o}/{r}/commits/{sha}/status` ([docs](https://docs.github.com/en/rest/commits/statuses)) | Failing if any completed run concluded `failure`, `timed_out` or `action_required`; passing if at least one concluded `success`, `neutral` or `skipped`; otherwise unknown. Cancelled runs are ignored. The method used is recorded. |
| `advisories_last_365` | `GET /repos/{o}/{r}/security-advisories?state=published` ([docs](https://docs.github.com/en/rest/security-advisories/repository-advisories)) | Published repository advisories with `published_at` in the last 365 days |
| Scorecard overall and checks | `GET https://api.securityscorecards.dev/projects/github.com/{o}/{r}` ([OpenSSF Scorecard](https://github.com/ossf/scorecard#public-data)) | **404 means "not available"**, not zero. A check score of −1 means "not applicable" and is stored as `null`. |
| Latest package version | `GET https://registry.npmjs.org/{pkg}/latest` / `GET https://pypi.org/pypi/{pkg}/json` | Used to decide whether a vulnerability is still unfixed |
| Vulnerabilities | `POST https://api.osv.dev/v1/query` ([docs](https://google.github.io/osv.dev/post-v1-query/)) with `{package:{name, ecosystem:"npm"\|"PyPI"}}`, then again with `version` = latest | Total; with a `fixed` event; published in 365 days; **affecting the latest version** (second query); paginated with `next_page_token` |
| Weekly downloads | npm: `GET https://api.npmjs.org/downloads/point/last-week/{pkg}` ([docs](https://github.com/npm/registry/blob/main/docs/download-counts.md)); PyPI: `GET https://pypistats.org/api/packages/{pkg}/recent?period=week` ([docs](https://pypistats.org/api/)) | pypistats data updates daily; we call it at most weekly, per their guidance |
| Dependents | — | **Not collected.** There is no reliable public source without scraping. |
| `sponsorship_or_backing`, `intended_use`, `team_notes` | Entered in `/admin/evaluate` | Backing is manual because it cannot be derived reliably. It is not scored. |

**Reliability:**
- every call has a **10 s timeout** and **2 retries** with exponential backoff on 429, 5xx and network errors (honouring `Retry-After` up to 20 s);
- at most 4 parallel requests per candidate;
- a **per-run cache**, so no URL is fetched twice in a run;
- the live app's GitHub client provides ETag conditional requests and rate-limit handling;
- one failing source marks only its metrics "not available" (source status `not_available`, `rate_limited` or `error`, with the reason) and never fails the candidate.

## 2. Dimension scores (0–100, or "insufficient")

`band(table, x)` returns the points of the **first row whose maximum is ≥ x**. Scores are rounded to the nearest integer, with halves rounding up.

| Table | Rows (max → points) |
| --- | --- |
| Release recency (days) | ≤30 → 100 · ≤90 → 85 · ≤180 → 65 · ≤365 → 40 · more → 10 |
| Releases per year | 0 → 10 · ≤3 → 55 · ≤11 → 80 · 12+ → 100 |
| Commit recency (days) | ≤14 → 100 · ≤30 → 90 · ≤90 → 70 · ≤180 → 45 · ≤365 → 25 · more → 5 |
| First response (hours) | ≤24 → 100 · ≤72 → 85 · ≤168 → 65 · ≤720 → 40 · more → 15 |
| Distinct contributors | 1 → 20 · 2 → 40 · ≤4 → 60 · ≤9 → 80 · 10+ → 100 |
| Top contributor share | ≤0.4 → 100 · ≤0.6 → 70 · ≤0.8 → 35 · more → 15 |
| Weekly downloads | <1k → 20 · <10k → 40 · <100k → 65 · <1M → 85 · 1M+ → 100 |
| Stars | <100 → 15 · <1k → 40 · <10k → 70 · 10k+ → 100 |

| Dimension | Formula | Insufficient when |
| --- | --- | --- |
| **Cadence** | 0.6 × recency + 0.4 × releases per year (one alone → that part, marked *partial*) | No release or tag date at all |
| **Maintenance** | Archived → 0; else commit-recency band | Commit date unavailable (and not archived) |
| **Responsiveness** (*sampled*) | 0.5 × first-response band + 0.5 × (maintainer share × 100); no response on any item → first-response part = 0 | Fewer than 5 sampled items |
| **Maintainer depth** | 0.5 × contributors band + 0.5 × top-share band | Commit authors unavailable |
| **Governance** | OSI license 60 / non-OSI 20 / none or unknown 0, + security policy 40 | Both license and policy unavailable |
| **CI health** | Passing 100 · failing 20 | Unknown (no checks or statuses) |
| **Security posture** | Scorecard × 10 − min(30, 10 × advisories in 365 days) | No Scorecard data |
| **Known vulnerabilities** | Any vulnerability affecting the latest version → 10; else 100 − 10 × (published in 365 days), floor 60 | No npm/PyPI package, or OSV unreachable |
| **Adoption** | 0.8 × downloads band + 0.2 × stars band (stars alone → stars band, *partial*) | No downloads and no stars |

OSI status uses [`lib/health/osi-licenses.ts`](../lib/health/osi-licenses.ts): SPDX License List **3.29.0** (16 Sep 2026), `isOsiApproved`, 141 identifiers. `NOASSERTION`/`OTHER` → unknown; missing → none.

## 3. Weighted overall score and coverage

| Dimension | Weight |
| --- | --- |
| Security posture | 20 |
| Known vulnerabilities | 15 |
| Maintenance | 15 |
| Release cadence | 10 |
| Responsiveness | 10 |
| Maintainer depth | 10 |
| Governance and licensing | 10 |
| CI health | 5 |
| Adoption | 5 |

```
covered  = Σ weight of dimensions that are not insufficient
overall  = round( Σ (weight × score) over covered / covered )
coverage = covered / 100
```

If **coverage < 0.60**, the verdict is **Insufficient data**, whatever the score.

## 4. Verdict mapping

| Overall | Verdict |
| --- | --- |
| ≥ 75 | Healthy |
| 50–74 | Watch |
| < 50 | Risky |
| coverage < 60% | Insufficient data |

## 5. Hard gates

Gates are applied **after** scoring and **only cap** a verdict, never raise it. Order: Healthy > Watch > Risky. Every triggered gate is listed first among the reasons.

| Gate | Condition | Cap |
| --- | --- | --- |
| Archived | `archived = true` | Risky |
| License | No license, unknown (`NOASSERTION`), or not OSI-approved; the reason says **"License needs legal review."** | Watch |
| Abandoned | No release (or tag) in 365 days **and** last default-branch commit > 365 days ago | Risky |
| Unfixed vulnerability | OSV reports ≥ 1 vulnerability affecting the latest version | Watch |
| Low bus factor | Top contributor share **> 0.60** (exactly 0.60 does not trigger) | Watch |

With **Insufficient data**, a Risky cap applies (archived or abandoned is definitive evidence), while a Watch cap leaves the verdict as Insufficient data.

## 6. Reasons

Reasons come from fixed templates in [`lib/health/reasons.ts`](../lib/health/reasons.ts). Each is one sentence built from one metric value and tagged **positive**, **neutral** or **concern**; a missing metric produces no reason.

They are ordered as follows:
1. gates and low coverage;
2. concerns, by dimension weight;
3. neutral reasons;
4. positives, by weight.

**Tag thresholds:**
- Release recency: ≤90 days positive, ≤365 neutral, otherwise concern.
- Releases per year: ≥4 positive, 1–3 neutral, 0 concern.
- Commit recency: ≤30 days positive, ≤180 neutral, otherwise concern.
- First response: ≤72 h positive, ≤168 h neutral, otherwise concern.
- Maintainer response share: ≥60% positive, ≥30% neutral, otherwise concern.
- Contributors: ≥5 positive, 2–4 neutral, 1 concern.
- Top share: ≤40% positive, otherwise neutral; above 60% it becomes the gate reason.
- Scorecard: ≥7 positive, ≥4 neutral, otherwise concern.
- Downloads: ≥100k positive, otherwise neutral.
- Stars: always neutral ("a weak signal on its own").

## 7. Worked example: `panva/jose`, ISO week 2026-W42

These are the stored metric values from the snapshot of 12 Oct 2026.

| Dimension | Inputs | Calculation | Score |
| --- | --- | --- | --- |
| Security | Scorecard 7.5, 0 advisories | 7.5 × 10 − 0 | **75** |
| Vulnerabilities | 3 known, 0 affect latest 6.2.12, 0 published in 365 days | 100 − 0 | **100** |
| Maintenance | last commit 10 days ago | band ≤14 | **100** |
| Cadence | last release 37 days ago, 16 in 365 days | 0.6 × 85 + 0.4 × 100 = 91 | **91** |
| Responsiveness | sample 13 issues + 8 PRs; median 3 h; maintainer share 0.29 | 0.5 × 100 + 0.5 × 29 = 64.5 | **65** |
| Maintainer depth | 5 people; top share 0.98 | 0.5 × 80 + 0.5 × 15 = 47.5 | **48** |
| Governance | MIT (OSI) + SECURITY.md | 60 + 40 | **100** |
| CI | check-runs: failing | — | **20** |
| Adoption | 154,475,623 weekly downloads; 7,824 stars | 0.8 × 100 + 0.2 × 70 = 94 | **94** |

Weighted:
```
(20×75 + 15×100 + 15×100 + 10×91 + 10×65 + 10×48 + 10×100 + 5×20 + 5×94) / 100
= 8110 / 100 = 81.1 → 81
```
Coverage is 100%, so the score maps to **Healthy** (≥ 75). The **low-bus-factor gate** applies (0.98 > 0.60) and caps the verdict at **Watch**.

**Final verdict: Watch (81).** First reason: "One contributor authored 98 percent of commits in the last 365 days (low bus factor)."

## 8. Narrative (Gemini Flash, text only)

The model gets the verdict label, score, coverage, the reason list and the metric values (values only), all inside `<<<HEALTH_DATA_START>>>…<<<HEALTH_DATA_END>>>` and declared to be data. Temperature is 0.1, with JSON schema output and a 1,500-token cap.

Code then rejects any response that:
- fails the zod schema;
- contains **a number that does not appear in the metrics or reasons**;
- uses a **verdict word other than the computed verdict** in the summary;
- has more than 3 summary sentences;
- lists strengths or concerns when no matching reasons exist.

After one retry, the reasons are turned into a **template narrative**, with `ai_status = fallback` shown on the report. Results are cached per (candidate, input hash, model); unchanged metrics never call Gemini again.

## 9. Snapshots and trend

- **One snapshot per candidate per ISO week.** An admin "Refresh health" updates that week's row.
- **Completeness rule:** a refresh whose weight coverage is lower than the report currently shown is stored, but does **not** replace it. The report explains this, e.g. "The refresh on 2026-10-19 reached only 55 percent of the scoring weight…".
- **Trend:** compares the last two snapshots. It reports a verdict change, or a score change when the verdict held, plus each dimension whose band moved. Bands: ≥75 Healthy, ≥50 Watch, otherwise Risky.

## 10. Limitations (read before relying on a verdict)

- **Sampling:** responsiveness uses up to 50 issues and 50 PRs from the last 90 days. A quiet repository may be marked "insufficient", and the sample is never the full history.
- **Bots and generated code:** linked bot accounts are excluded from authorship. Service accounts that are not typed `Bot` still count. For example, `square/square-nodejs-sdk` is generated by Fern and committed mostly by `fern-support`, which correctly reads as a low human bus factor but deserves context.
- **Stars and forks** are easy to inflate; they make up 20% of a 5-weight dimension, about 1% of the total.
- **Dependents** are not collected.
- **Backing** is manual and not scored.
- **Scorecard** covers many but not all repositories; missing data is "not available", never zero.
- **OSV** coverage of npm and PyPI is broad but not complete. An empty result reads "no records in OSV", not "no vulnerabilities".
- **Tag-only projects** are dated by the tagged commit, which can precede the tag.
- **Advisories:** only repository advisories are counted, not the global database by package.
- **Not assessed:** code quality, test coverage, API design, or fit for your specific use.
