# Getting and verifying provider keys

Four integrations, in the order they're worth adding. **All of them go on the
API host (Render) only** — never on Vercel, and never in `NEXT_PUBLIC_*`
variables, which are compiled into the browser bundle.

After adding any key:

```sh
npm run doctor        # locally, or in the Render shell
```

or open **Settings** in the app. Both probe each provider against its real
endpoint, because a key being present does not prove your plan grants the
capability you need.

---

## 1. Anakin — web research

**Biggest single upgrade to live mode.** Page retrieval already works *without*
a key on the keyless tier (verified during development, ~2.6s per page). A key
raises rate limits and unlocks search-based discovery, so the agent can find
suppliers instead of starting from the curated catalogue.

1. Sign up at <https://anakin.io>
2. Find your key in the dashboard (see <https://anakin.io/docs/api-reference>)
3. Set on Render:

```
ANAKIN_API_KEY=your_key
ANAKIN_COUNTRY=in          # proxy egress country; "in" suits Indian suppliers
```

**Verify:** Settings should show `anakin → search: available`. If it says
`search: unavailable` with a 401, the key is wrong or the plan lacks search —
retrieval will still work, and discovery falls back to the catalogue.

**Cost control:** `AGENT_MAX_PAGES` (default 12) caps pages per case.

---

## 2. DeepSeek — reasoning

Turns messy real-world supplier pages into structured facts far better than the
rule-based fallback. Cheap: at `deepseek-flash` rates a case costs a fraction of
a rupee.

1. Sign up at <https://platform.deepseek.com>, add a small balance
2. Create an API key
3. Set on Render:

```
DEEPSEEK_API_KEY=your_key
DEEPSEEK_MODEL=deepseek-flash      # or deepseek-v4-pro for harder pages
```

**Verify:** Settings should show `deepseek → chat_completions: available`. A
404 there means the model name isn't available to your account — change
`DEEPSEEK_MODEL`. Model identifiers change; check
<https://api-docs.deepseek.com> rather than trusting a value copied from a blog.

Without this key the app still works, and extraction is labelled *rule-based* in
the UI rather than passed off as model interpretation.

---

## 3. Bright Data — fallback retrieval and search

Optional. Used when Anakin fails on a page, and for SERP search if you have
that zone.

Zones matter: **Web Unlocker** (page retrieval) and **SERP** (search) are
*separate products*. Having one does not give you the other, which is exactly
what the capability probe checks.

1. Sign up at <https://brightdata.com>
2. Create a **Web Unlocker** zone, and optionally a **SERP** zone
3. Copy the API key from the zone's Overview tab
4. Set on Render:

```
BRIGHTDATA_API_KEY=your_key
BRIGHTDATA_UNLOCKER_ZONE=your_unlocker_zone_name
BRIGHTDATA_SERP_ZONE=your_serp_zone_name      # omit if you don't have one
```

**Verify:** Settings lists each zone by name and says whether it was found on
your account. A zone name typo shows up here as "not found", with your actual
active zones listed.

---

## 4. Cognee — cross-case memory

Optional. Remembers preferences across cases ("we prefer recyclable packaging").
Without it, preferences still work — they're stored locally — but don't carry
semantic recall.

1. Sign up at <https://cognee.ai> and open the Cloud dashboard
2. Copy the base URL (looks like `https://<tenant>.aws.cognee.ai`) and API key
3. Set on Render:

```
COGNEE_API_KEY=your_key
COGNEE_BASE_URL=https://your-tenant.aws.cognee.ai
COGNEE_DATASET=supplysaathi
```

**Verify:** Settings shows `cognee → memory: available`. If it's unavailable the
app says "memory temporarily unavailable" and carries on — a memory outage never
blocks a sourcing case.

Only text you explicitly asked to remember is stored. No prices, no contacts.

---

## 5. Email — sending quote requests

Off by default. Drafts can be downloaded as `.eml` or copied without any of
this, and that's labelled as an **export**, never as a sent message.

### Resend (simplest)

1. Sign up at <https://resend.com>, verify a sending domain
2. Create an API key
3. Set on Render:

```
EMAIL_PROVIDER=resend
RESEND_API_KEY=your_key
EMAIL_FROM_ADDRESS=orders@yourverifieddomain.com
EMAIL_FROM_NAME=Your Bakery
EMAIL_ALLOWLIST=you@example.com          # start with only your own address
```

### SMTP

```
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASS=...
EMAIL_FROM_ADDRESS=orders@yourdomain.com
EMAIL_ALLOWLIST=you@example.com
```

### Before you widen the allowlist

Keep `EMAIL_ALLOWLIST` set to your own address until you have sent a real
request to yourself and read it. While it is set, a badge appears in the UI and
any other recipient is refused outright.

Then remember what the app does and does not promise: it reports
**"accepted by email provider"**, never "delivered". It cannot observe delivery
and will not claim to.

---

## Quick reference

| Variable | Host | Required? | Without it |
| --- | --- | --- | --- |
| `ANAKIN_API_KEY` | Render | No | Keyless retrieval; catalogue-based discovery |
| `DEEPSEEK_API_KEY` | Render | No | Rule-based extraction, labelled as such |
| `BRIGHTDATA_*` | Render | No | No fallback provider |
| `COGNEE_*` | Render | No | Local-only memory |
| `EMAIL_PROVIDER` + sender | Render | No | `.eml` export only |
| `APP_AUTH_PASSWORD` | **Both** | Yes, if public | Anyone can spend your credits |
| `API_ORIGIN` | Vercel only | Yes | Vercel tries to serve the API itself and fails |

---

## If something doesn't work

| Symptom | Cause |
| --- | --- |
| Settings shows "Could not reach the API" | `API_ORIGIN` wrong on Vercel, or Render is down |
| Browser asks for the password twice | Render and Vercel passwords differ |
| `search: unavailable` despite a key | Your plan lacks search — discovery falls back to the catalogue, which is a supported mode |
| `chat_completions` 404 | `DEEPSEEK_MODEL` isn't available to your account |
| Bright Data zone "not found" | Zone name typo — Settings lists your real zones |
| Research starts but never progresses | The worker isn't running; check Render logs for `Worker … started` |
| `unable to open database file` | `DATABASE_PATH` isn't on the mounted disk, or the mount is unwritable |
