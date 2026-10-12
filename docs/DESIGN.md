# Dependency Pulse: design direction

## Intent

The digest is a **document you read on Monday morning in under five minutes**. The design borrows from a well-set engineering memo, not a dashboard. Most of the page is quiet: paper-toned surfaces, ink-colored type, and one accent. Color is saved for two meanings, **Act now** and **Review**, so it always signals something.

Tone of copy: plain, specific, calm. Say what happened and what to do. No exclamation marks, no filler, and no "Welcome". Buttons name their action ("Run preview", "Send digest now", "Add repository").

## Typography

| Role | Family | Size / line height | Weight | Notes |
| --- | --- | --- | --- | --- |
| Display (h1) | IBM Plex Sans | 2.25rem / 1.15 (1.75rem under 640px) | 600 | One per page, with tight tracking (-0.015em) |
| Section title (h2) | IBM Plex Sans | 1.25rem / 1.3 | 600 | Preceded by a small uppercase eyebrow label |
| Card title (h3) | IBM Plex Sans | 1.0625rem / 1.35 | 600 | Repo name, then the version in mono |
| Body | IBM Plex Sans | 1rem / 1.6 | 400 | Measure capped at 68ch |
| Meta | IBM Plex Sans | 0.8125rem / 1.45 | 400 | Dates and counts use `tabular-nums` |
| Code / versions / evidence | IBM Plex Mono | 0.875em | 400 | Versions, GHSA IDs, quoted evidence |
| Numerals (summary bar) | IBM Plex Sans | 2.5rem / 1 | 600 | `tabular-nums`, with reserved width so the layout doesn't shift |

Fonts are self-hosted via `next/font` with `display: swap`. Emails use a system font stack (`-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif`) because email clients can't rely on web fonts.

## Color tokens

All colors are CSS custom properties on `:root` and redefined for dark mode, both when the system is dark (unless the user chose light) and when `[data-theme="dark"]` is set by the toggle.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#FBFAF7` | `#111316` | Page background (paper) |
| `--surface` | `#FFFFFF` | `#181B1F` | Cards, tables |
| `--surface-2` | `#F3F1EC` | `#1F2328` | Subtle fills, FYI rows, code |
| `--ink` | `#17191C` | `#ECEDEE` | Primary text |
| `--ink-2` | `#474C54` | `#B9BEC5` | Secondary text |
| `--ink-3` | `#62676F` | `#959BA3` | Metadata (≥ 4.5:1 on `--bg` and `--surface`) |
| `--line` | `#E2DFD7` | `#2C3138` | Hairlines, borders |
| `--accent` | `#1D5BA8` | `#86B6F6` | Links, focus ring, primary buttons |
| `--act` / `--act-bg` / `--act-line` | `#B0241C` / `#FDECEA` / `#F0B4AF` | `#FF9A8F` / `#341614` / `#6A2621` | Act now tier |
| `--review` / `--review-bg` / `--review-line` | `#85500A` / `#FFF4DC` / `#EDCB85` | `#F2C46D` / `#30240D` / `#5C4514` | Review tier |
| `--ok` | `#1D6A3A` | `#7FD19B` | Healthy status |

Every tier also carries an **icon and a text label**, so color is never the only signal. Body and label text meets WCAG 2.2 AA (4.5:1) in both themes. `tests/unit/contrast.test.ts` checks the pairs above.

## Spacing and layout

- 4px base unit. The scale is 4, 8, 12, 16, 24, 32, 48, 64.
- The page column is `max-width: 46rem` for the digest (a reading document) and `72rem` for admin tables.
- 16px side gutter on mobile and 24px from 640px up. There is never horizontal page scroll. Tables collapse into stacked cards under 720px.
- Radius: 10px for cards, 8px for inputs and buttons, 999px for chips.
- Elevation: no shadows on documents. Cards use a 1px hairline plus a 3px left rule in the tier color.

## Component patterns

- **Summary bar.** Four counts (Act now, Review, FYI, Could not check) as large numerals with labels, then the window dates and the last-run time underneath.
- **Tier section.** An eyebrow label with an icon (⚠ Act now, ◐ Review, ○ FYI), an h2, and a one-line explanation of what the tier means.
- **Release card (Act now and Review).** Repo name, version in mono, category chip, flag chips ("Security fix", "Breaking change", "Major version bump", "Pre-release", "Low confidence"). Then the evidence quote block, then a one-line summary, then a one-sentence "Why flagged" line. A `<details>` element holds the key changes, the suggested next step, and the release link. It works without JavaScript.
- **FYI list.** Grouped by category, with a coverage line per category ("payments: 4 repos checked, 1 release"). Each row shows repo, version, date, one-line summary, and a link.
- **Evidence quote.** A mono font, `--surface-2` fill, and a 2px tier-colored left rule. The quoted phrase appears verbatim, with an advisory ID linked when present.
- **Status badge.** An icon plus a label (✓ OK, ⊘ Not found, ⏸ Rate limited, ✕ Error), never color alone.
- **Buttons.** Primary (accent fill), secondary (hairline), and destructive (act color, always behind a confirmation `<dialog>`). Minimum height is 44px.
- **Toasts.** Bottom-center, in an `aria-live="polite"` region, auto-dismissing after 5s, with a dismiss control.
- **States.** Every data view has a skeleton (matching the final layout), an empty state that suggests a next action, and an error state with a retry.

## Motion

- 120–180ms ease-out transitions only, for `<details>` expansion, toggle switches, and button press feedback.
- Everything is turned off under `prefers-reduced-motion: reduce`.

## Print

- Print is light-only. It removes the nav, theme toggle, and buttons, and keeps tier left rules as borders.
- Cards use `break-inside: avoid`. `<details>` content is forced open in print so key changes appear on paper.
- Margins are 14mm, which works on both A4 and US Letter.

## Email

- Table-based layout, all CSS inline, a 600px max width, and no images, web fonts, or scripts.
- The colors are mid-tone values that read on both white and dark-mode-inverted backgrounds. Tier labels are always text.

Only three font files ship (Plex Sans 400/600, Plex Mono 400) to keep the mobile Speed Index low; `font-medium` resolves to 400.

## Signature elements (v2)

- **Masthead.** Every digest and the home page open on a dark "ink" band that stays dark in both themes (`--mast-*` tokens). It carries a dotted grid, an urgency glow (red when something needs action, amber for review-only, teal for quiet weeks), and an static ECG "pulse" line (not animated, so it never delays visual completeness). Text on it meets AA contrast: `#f3f5f7` / `#c3cad3` on `#0d1117`.
- **Display serif.** Instrument Serif (one 400 file) for headlines and the large stat numerals; IBM Plex Sans and Mono for everything else.
- **Stat tiles.** Four tiles with serif numerals, an icon and label, and a meter showing each tier's share of the week.
- **Sticky section nav.** Act now, Review, FYI and Coverage pills with live counts.
- **"At a glance" card.** Gradient accent rule, a sparkle label marking AI-written text, and numbered action items. The label states how the text was checked.
- **Release cards.** A tier-tinted header strip with chips, a coloured repo monogram (stable per owner, so no avatar downloads), a mono version pill, the evidence as a pull-quote with a captioned source, a one-line "Why flagged", and the next step as a teal callout. Several releases of the same repo in one tier fold into one card ("2 more flagged releases of prisma/orm this week").
- **FYI.** Category cards with coverage in the header and monogram rows.
- **Coverage chart.** CSS bars, plus a chip cloud of quiet repos.
- **Archive and home.** Stacked act/review/FYI proportion bars per week.
- **Admin.** KPI tiles and a split-screen login.
- **Elevation.** `lift` = `--shadow-sm` at rest, `--shadow-md` on hover.

## Adoption Check patterns

The Adoption Check pages (`/evaluate`, `/evaluate/[slug]`, `/evaluate/compare`, `/admin/evaluate`) reuse the existing tokens, type scale, chips, cards and states. No new colors were added. The verdict colors map onto the existing tier tokens: `--ok` for Healthy, `--review` for Watch, and `--act` for Risky.

- **Verdict chip** (`components/health/verdict.tsx`). Every verdict shows an icon and a text label, never color alone:
  - ✓ Healthy, ◐ Watch and ⚠ Risky are filled chips.
  - **Insufficient data** uses a *dashed* outline (`.chip-dashed`), a ? icon and neutral ink. Missing evidence should read as "unknown", not as a warning or a pass.
  - "Not checked yet" uses the same dashed style.
- **Score meter.** A serif numeral "/ 100" over a thin bar colored by band, with the weight coverage underneath ("85% of weight had data (partial)"). When there is no score, it shows "—" and an empty bar, never 0.
- **Reason rows.** A fixed-width tag column with an arrow icon and a label (↑ Positive, • Neutral, ↓ Concern), then the sentence and a source link. The rows follow the scoring order: gates first, then concerns by weight, then positives. A balance line ("3 concerns · 4 neutral · 9 positive") gives the shape before the detail.
- **AI text.** The narrative ends with a caption that says who wrote it and how it was checked: by Gemini Flash with every number verified, or by a template when validation failed. Every narrative line cites the reason it rests on.
- **Compare table.**
  - A scroll container with a sticky first column (the dimension names). On a phone, the candidate columns scroll horizontally under the labels, and the page itself never scrolls sideways.
  - In each row, the strongest value is marked "★ Strongest" in text as well as color.
  - Cells without data read "No data".
  - "Copy as Markdown" puts the same table on the clipboard for a design doc or PR, and announces the copy in a polite live region.
- **Trend.** The change is written out in words first ("Score moved from 78 to 81; the verdict stayed Watch", plus each dimension whose band changed). Below that is one row per weekly snapshot: ISO week, verdict chip, score with a thin bar, and coverage. The row currently shown is marked "Shown above".
- **Loading.** Each route has its own skeleton that matches the final layout (watchlist grid, report sections, compare table), so streamed content never shifts the page.
