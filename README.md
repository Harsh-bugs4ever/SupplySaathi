# SupplySaathi

**Your supplier fell through. Your business shouldn't.**

A sourcing agent that reads live supplier pages, rejects what doesn't fit, shows the tradeoffs with evidence, and prepares quote requests for your approval.

Built for the [Anakin Forge hackathon](https://anakin.io/hackathon/anakin-forge).

> **Deploying:** **[DEPLOYMENT.md](./DEPLOYMENT.md)** — interface on Vercel, API + worker on Render.
> **Provider keys:** **[PROVIDERS.md](./PROVIDERS.md)** — where to get each one and how to verify it.

---

## Quick start

Requires **Node 22.5+** (24 recommended). No native build step, no database server.

```bash
npm install
npm run migrate
npm run dev          # app + worker, http://localhost:3000
```

Then, in the composer:

1. Pick **Try demo** (sample data) or **Live research** (real supplier pages)
2. Click **Try: 500 cake boxes** to fill the example brief
3. **Create demo case** / **Create live sourcing case**
4. **Start research**, watch the timeline, open **Evidence** on any card

Live research works with **no credentials at all** — Anakin's keyless tier handles page retrieval, and discovery falls back to a curated supplier catalogue. Keys unlock broader search and better extraction.

| Command | Does |
|---|---|
| `npm run dev` | App + worker, with reload |
| `npm run build && npm start` | Production: migrate, then app + worker |
| `npm run doctor` | Probe every provider, print what's actually available |
| `npm run seed` | Create a demo case ready to research |
| `npm test` | 180 tests |
| `npm run typecheck` | `tsc --noEmit` |

---

## The problem

A small bakery depends on two or three suppliers. When one cancels on a Tuesday, the owner stops baking and starts searching: find alternatives, decode inconsistent listings, work out whether "pack of 25" at ₹380 beats "pack of 50" at ₹720, check whether a box labelled *10 × 10 × 5* means the inside or the outside, find out if anyone delivers by Friday — then write the same email six times.

Hours of work that produce no cakes.

## What the agent does

You describe what you need in a sentence. It then:

1. **Parses the brief** into checkable requirements, and resolves *"by Friday"* into an explicit date in your timezone — shown to you **before** research starts, because everything downstream depends on it.
2. **Asks only questions that change the answer.** Zero questions is a good outcome.
3. **Retrieves live supplier pages** via Anakin. A search-results page is recognised as a listing and followed to individual products, not mistaken for one.
4. **Extracts facts with a supporting quote each.** A value with no excerpt behind it is recorded as unknown, not guessed.
5. **Does arithmetic in code, never in the model** — pack conversion, minimum-order rounding, increments, subtotals.
6. **Evaluates hard constraints**, keeping *failed* and *unknown* strictly apart.
7. **Ranks transparently**, explaining each placement in a sentence. No confidence percentages.
8. **Drafts a quote request** per supplier, built around that supplier's own open questions.
9. **Sends only what you explicitly approved** — editing a draft afterwards revokes the approval automatically.

### The distinction the product rests on

> A page that doesn't mention food-contact safety hasn't told you the product is unsafe. It hasn't told you it's safe either.

That third answer — *unknown* — becomes a question for the supplier. Most tools collapse it into a pass or fail. SupplySaathi keeps it separate in the data model, the ranking, the chip colour, and the glyph on that chip (so it survives greyscale and colour-blindness).

In practice the agent will tell you:

- this listing **matches** your dimensions
- this cheaper one is **4 × 4 × 1.5 in** — excluded, it's a different product
- this one's **minimum order is 5,000 units** when you need 500 — excluded
- this one **might** work, but **nobody said when it ships** — ask them
- this says *"food safe"* but **names no standard** — a supplier's claim, not a certificate
- this page **couldn't be read** — which tells you nothing about the product

Nothing is invented in live mode. Not a listing, price, certification, shipping date, or contact address.

---

## Modes

Mode is chosen **per case**, in the composer.

**Demo** runs on deterministic fixtures with no network access. Demo cases are labelled in the composer, with a badge in the case list, and with a banner inside the case itself. The fixtures deliberately exercise each decision: a clean match, a pack-size conversion, a minimum-order failure, missing delivery evidence, a dimensions conflict, and a retrieval failure.

**Live** uses configured providers and real pages. Missing integrations produce honest errors, never fixtures.

`APP_MODE` sets the composer's default. **The two never mix** — the provider is chosen at construction, so there's no code path from a failed live call to sample data. Silently substituting fixtures for live data would be the most damaging thing this tool could do.

---

## Providers

Every key is server-side only; nothing reaches the browser. `npm run doctor` and the Settings page probe each provider against its real endpoint, so "search unavailable" means the credentials genuinely don't grant search — not that a variable is missing.

### Anakin — web research

Verified against <https://anakin.io/docs/api-reference>:

- `POST https://api.anakin.io/v1/url-scraper/scrape` — `{ url, country, useBrowser, generateJson }`
- `POST https://api.anakin.io/v1/search` — `{ prompt, limit }`
- Header: `X-API-Key`

| Credential | Retrieval | Discovery |
|---|---|---|
| No key | ✅ keyless tier | curated catalogue + your own URLs |
| `ANAKIN_API_KEY` | ✅ higher limits | live search |

Both are supported paths. The split is probed at runtime.

### DeepSeek — reasoning

Verified against <https://api-docs.deepseek.com>. OpenAI-compatible `/chat/completions`; models `deepseek-flash` and `deepseek-v4-pro`; `response_format: { type: "json_object" }`. Model and base URL are configurable because that list changes.

Every response is Zod-validated before it's trusted. A violation triggers **one** repair attempt showing the model its own output and the specific error, then falls back to a deterministic rule-based extractor. An auth or model-name failure disables the model for the rest of the run rather than paying the timeout on every call.

### Cognee — memory

Verified against <https://docs.cognee.ai/api-reference>: `/api/v1/{add,cognify,search}`, header `X-Api-Key`.

Cognee holds **contextual** memory only — preferences, past supplier experience, rejection reasons. Case state, quantities, deadlines, approvals and send records live in SQLite and nowhere else. If Cognee is down, the case works and the UI says memory is unavailable.

### Email

`EMAIL_PROVIDER` is `none` (default — `.eml` export, labelled as an export, never as a sent message), `smtp`, `resend` (sends an `Idempotency-Key` so a retried request can't double-send), or `test` (records locally, sends nothing).

`EMAIL_ALLOWLIST` restricts outgoing mail to named addresses; a badge appears in the UI and other recipients are refused.

---

## Architecture

```
Browser ──► Next.js app ──► SQLite ◄── Worker process
              (routes)      (WAL)       (agent runs)
                  │                          │
                  └──── SSE ◄── events ──────┘
```

Locally that is one process pair. **Deployed, it splits across two hosts**: the interface on Vercel, the API and worker together on Render beside the SQLite file. One codebase builds both — the `API_ORIGIN` environment variable decides the role, and when set, every `/api/*` request is rewritten to the API host *before* Next's own routes match. See [DEPLOYMENT.md](./DEPLOYMENT.md).

The API and worker cannot be separated: they share a SQLite file, and a Render disk is reachable by exactly one service.

**Why a separate worker.** A run takes minutes and the owner will close the tab. Job state is persisted, so a run survives a refresh, a restart, or the worker being killed — anything left `running` at startup is requeued.

**Why SSE reads from the database** rather than being pushed: the processes share no state, and a reconnecting client resumes from its last sequence number without losing or duplicating an entry. On completion the client refetches the authoritative snapshot.

```
src/lib/domain/      pure logic: costing, constraints, ranking, units, dates
src/lib/providers/   adapters: reasoning, web, memory, email — one port each
src/lib/agent/       runner, brief normalisation, prompts, outreach, listing detection
src/lib/db/          schema, typed repository, SQLite adapter
src/lib/security/    URL guard, page sanitisation, auth, log redaction
src/lib/client/      browser API client — resolves where /api lives
src/middleware.ts    password gate for deployed instances
worker/              the job loop
migrations/          plain SQL, applied in order, one transaction each
Dockerfile           API host image; entrypoint fixes disk ownership, drops root
next.config.mjs      the API_ORIGIN rewrite that makes the split work
```

Provider code never leaks into domain logic. Demo mode satisfies the same interfaces, which is why it exercises the real costing, constraint and ranking code — only retrieval is substituted.

**Why no ORM.** `better-sqlite3` has no prebuilt binary for Node 24 on Windows, so `npm install` fails without a full MSVC toolchain. SupplySaathi uses Node's built-in `node:sqlite` behind a thin adapter (`src/lib/db/sqlite.ts`) restoring named parameters, value coercion and transactions. The repository is hand-written so JSON value-object columns decode at exactly one place, and a schema change is a TypeScript error rather than a runtime `undefined`.

### Four kinds of information

| Kind | Example | Where |
|---|---|---|
| **Retrieved** | "Pack size 50", with its quote | `Evidence`, `explicitly_stated` |
| **Derived** | 10 packs × 50 = 500 units | `Costing`, `derived` / `computed` |
| **Interpreted** | how a model read an ambiguous phrase | `Evidence.interpretation` |
| **Confirmed** | what you typed | authority `user_provided` |

Supplier claims stay distinguishable from independent verification throughout.

---

## Design

A dark sourcing command centre: near-black ground, lime-green accent, monospaced figures wherever numbers are compared down a column, and an animated network diagram of the sourcing process on the landing screen.

Constraint state is carried by **both** colour and glyph (✓ / ? / ✕). Motion only marks arriving results, and `prefers-reduced-motion` is honoured. The mascot is a cartoon ghost carrying a parcel — your supplier vanished, so a friendly ghost fetches the box. *Saathi* means companion.

---

## Safety

Retrieved pages are **untrusted data**:

- Content is never concatenated into a system prompt. It's fenced between explicit markers, framed as a document to analyse, and the markers are stripped from the content so a page can't close the fence early.
- Common override phrasings are neutralised and flagged in the timeline.
- Extraction has no tools and can only return schema-checked JSON, so an injected instruction has nowhere to act.

Also, each with tests:

- URLs resolving to localhost, private ranges, link-local, carrier NAT and cloud metadata are blocked, as are non-HTTP schemes and URLs carrying credentials. Redirect chains are re-validated per hop.
- Recipient addresses are **never guessed** — sourced from a page actually read (URL recorded), or typed by you.
- An approval pins the exact version, recipient and SHA-256 content hash. Editing any of them revokes it in the same transaction.
- Sends are idempotent: the key derives from the approval and its content, so a double-click, retry or worker restart collapse into one email.
- An ambiguous send result is recorded as `unknown` and **never retried automatically**.
- Provider acceptance is never called delivery.
- Secrets stay in environment variables and are redacted from logs.
- `APP_AUTH_ENABLED=true` puts HTTP Basic auth in front of a deployed instance via `src/middleware.ts`.

---

## Verification

```bash
npm test        # 180 tests, 11 files
```

| File | Covers |
|---|---|
| `costing` | pack rounding, MOQ, increments, missing shipping ≠ zero, refusal to calculate |
| `constraints` | unknown vs failed, internal/external dimensions, claim vs named standard, currency mismatch |
| `dates` | weekday resolution, timezones, ambiguity flagging, returning null over guessing |
| `security` | SSRF blocking, prompt injection, redirect chains, log redaction, content bounds |
| `auth` | credential checking for the middleware gate |
| `outreach` | approval invalidation, duplicate sends, concurrent race, allowlist, uncertain outcomes |
| `resilience` | invalid model output, model fallback, partial retrieval, memory outage, cancellation, job recovery |
| `listing` | listing vs product pages, link harvesting, tracking-param stripping, name cleanup |
| `live-health` | a provider error inside an HTTP 200 can't report as healthy |
| `research-route` | run-start guards |
| `e2e` | create → research → evidence → select → edit → approve → send → reload and verify persistence |

Also: `npm run typecheck` clean, production build clean, `npm audit` 0 vulnerabilities.

### Verified live

- **Anakin page retrieval (keyless)** — real HTTP, ~2.6s typical
- **A full live run** — followed a Flipkart listing to 6 real product pages, extracted real supplier names, pack sizes, prices and dimensions, computed subtotals, and **correctly excluded** all three whose boxes were 4 × 4 × 1.5 in and 8 × 8 × 5 in against a required 10 × 10 × 5 in
- **Capability probing** — Anakin scrape works keyless; search returns 401 without a key
- **Full HTTP flow** against the running server, including all five approval/send guards

Live testing found two real bugs, both fixed: a search-results page treated as a single product (splicing one listing's price onto another's pack size), and a fallback provider's "not configured" error masking the primary's actual rate limit.

**Not verified live:** DeepSeek completions, Anakin search, Cognee, and real email delivery. Their adapters are complete and unit-tested against documented contracts; `npm run doctor` confirms them once keys are present. The Docker image *was* built and run — see [DEPLOYMENT.md](./DEPLOYMENT.md). Fixture-based verification is never described as live verification anywhere in this project.

---

## Known limitations

- **One category** — bakery packaging, India. The constraint logic generalises; the catalogue and some extraction heuristics don't.
- **Extraction tracks the model.** Without `DEEPSEEK_API_KEY` the rule-based extractor handles tidy pages well and messy ones poorly. It's labelled as rule-based, not passed off as model work.
- **DNS rebinding isn't closed.** URLs are validated, but a hostname *resolving* to a private address would still be fetched. Closing it needs socket pinning, impossible through a third-party scraper. In practice the fetch happens on the provider's infrastructure, not ours.
- **No currency conversion.** Cross-currency candidates are marked unknown rather than converted — an unreferenced FX rate is a fabricated number.
- **No delivery confirmation.** We observe that a provider accepted a message, never that it arrived.
- **The catalogue goes stale.** Entries were live-checked on 2026-09-13. A dead entry surfaces as a retrieval failure, never as a claim about availability.
- **Single business workspace.** One shared password, not user accounts. One replica only — job recovery assumes a single worker.
- **Lead time is an estimate.** "Ships in 2–3 days" is the supplier's published figure, not a commitment, and the UI says so.

---

## Two-minute demo script

Run `npm run dev`, open <http://localhost:3000>.

> **0:00** — "A bakery's supplier just cancelled 500 cake boxes, needed by Friday. Normally that's an afternoon of tab-juggling."
>
> **0:15** — Click **Try: 500 cake boxes**, then create the case. "One sentence in. Notice what comes back first — *Friday* is now **Friday, 18 September 2026**, in their timezone, shown before we spend a single request. Everything depends on that date, so they get to catch it."
>
> **0:35** — **Start research.** "Every line is a real action that just finished. No fake progress bars."
>
> **0:55** — Point at the excluded BulkBox card. "It found a cheaper carton and threw it out: minimum order 5,000 when they need 500. It tells you *why*, in numbers you can check."
>
> **1:10** — Open **Evidence**. "Every fact has the URL, the exact quote, the retrieval time, and how we read it. This one says 'food safe' but names no standard — logged as a supplier claim, not a certification, so the card stays amber."
>
> **1:30** — Comparison table. "Pack of 25 versus pack of 50, normalised. Amber cells are *unknown*, not zero. No landed total, because nobody published shipping — so we don't invent one. The headline is qualified: 'lowest known merchandise cost among candidates matching the documented dimensions', not 'best supplier'."
>
> **1:45** — Select two → **Prepare quote requests** → open one. "A real email built around *this* supplier's open questions. Edit the body and watch the approval revoke itself. Approve, and only then can it send."
>
> **2:00** — "Reload: the evidence, the decisions, the send record are all still here. Next case, it remembers they prefer recycled board. The agent read the live web, reasoned through the tradeoffs, and stopped to ask permission before touching anyone's inbox."

---

Next.js · TypeScript · Tailwind · Node built-in SQLite. Web data by [Anakin](https://anakin.io).
