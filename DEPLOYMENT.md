# Deploying SupplySaathi

**Interface on Vercel. API + agent worker on Render.**

```
        browser
           │  (one origin — no CORS, no keys in the bundle)
           ▼
  ┌──────────────────┐        /api/*  rewritten        ┌────────────────────────┐
  │  Vercel          │ ─────────────────────────────►  │  Render (Docker)       │
  │  UI pages only   │                                 │  API routes + worker   │
  │  API_ORIGIN set  │  ◄─────── JSON / SSE ─────────  │  SQLite on a disk      │
  └──────────────────┘                                 └────────────────────────┘
```

One codebase builds both. The `API_ORIGIN` environment variable decides which
role a deployment plays:

| Deployment | `API_ORIGIN` | Behaviour |
| --- | --- | --- |
| Render | *unset* | Serves its own `/api/*` against the SQLite file the worker shares |
| Vercel | Render URL | Rewrites every `/api/*` request to Render before its own routes match |

The rewrite lives in `next.config.mjs` under `beforeFiles`, which runs ahead of
the filesystem. An ordinary rewrite would be checked *after* a route matched, so
Vercel would run its own copy of `/api/cases`, reach for a database that is not
there, and fail.

Because the browser only ever talks to the Vercel origin, there is no CORS to
configure, no preflight on every call, and no API hostname or credential in the
client bundle.

---

## Part 1 — Deploy the API to Render (do this first)

Vercel needs the Render URL, so Render goes first.

### 1.1 Push to GitHub

```sh
git add -A
git commit -m "SupplySaathi"
git push
```

`.gitignore` already excludes `.env.local`, `data/` and `node_modules`.

### 1.2 Create the service

Easiest is the included [`render.yaml`](./render.yaml): in Render choose
**New → Blueprint**, point it at the repository, apply. It declares the service,
the disk, and every variable.

Manually instead: **New → Web Service** → Docker runtime, then

- **Instance type:** a paid one — the free tier cannot attach a disk.
  `0.5c-512mb` is the cheapest; move to `1c-2g` if the worker is OOM-killed
  during a research run.
- **Disk:** mount path `/app/data`, 1 GB.
- **Health check path:** leave **blank**. `/api/health` is behind the password
  gate and probes external providers on every call — as a liveness check it
  would fail auth *and* bill third-party requests forever.

### 1.3 Environment variables

| Variable | Value |
| --- | --- |
| `APP_MODE` | `demo` to start |
| `DATABASE_PATH` | `/app/data/supplysaathi.db` |
| `APP_TIMEZONE` | `Asia/Kolkata` |
| `APP_AUTH_ENABLED` | `true` |
| `APP_AUTH_PASSWORD` | a long random ASCII password |
| `EMAIL_PROVIDER` | `none` |
| `APP_BASE_URL` | your Vercel URL, once you have it (step 2.4) |

Leave `API_ORIGIN` **unset** here. Setting it would make Render proxy to itself.

### 1.4 Verify

Watch the logs for `Ready` **and** `Worker … started`. Then:

```sh
curl -u any:YOUR_PASSWORD https://your-api.onrender.com/api/health
```

Create a case, run research, restart the service, confirm the case survived.
That last step is the disk working.

---

## Part 2 — Deploy the interface to Vercel

### 2.1 Import the project

**Add New → Project**, pick the same repository. Vercel detects Next.js; leave
the build settings alone.

### 2.2 Environment variables

| Variable | Value |
| --- | --- |
| `API_ORIGIN` | `https://your-api.onrender.com` — no trailing slash |
| `APP_MODE` | `demo` or `live` — sets the composer's default |
| `APP_TIMEZONE` | `Asia/Kolkata` |
| `APP_AUTH_ENABLED` | `true` |
| `APP_AUTH_PASSWORD` | **the same password as Render** |

**No provider keys here.** Anakin, DeepSeek, Bright Data and Cognee keys belong
only on Render. Vercel never calls those services.

The password must match because both hosts gate independently: the browser
authenticates once against Vercel, and the rewrite forwards the same
`Authorization` header to Render, which validates it too.

### 2.3 Deploy and check

Open the Vercel URL, enter the password, and confirm:

- **Cases** lists cases from Render — proving the rewrite works
- **Settings** shows provider capabilities — proving `/api/health` proxies
- Starting research streams live events — proving SSE survives the proxy

### 2.4 Point `APP_BASE_URL` at Vercel

Back in Render, set `APP_BASE_URL` to your Vercel URL. It is used for the
cross-origin check on writes. Redeploy Render.

### A note on SSE and Vercel timeouts

Research progress streams over server-sent events. Vercel's proxy will cut a
long-lived connection (around 60s on Hobby). This is survivable by design: the
client reconnects and resumes from its last sequence number, so no timeline
entry is lost or duplicated. You may see a brief pause in a long run.

---

## Part 3 — Turn on live research

Add to **Render only**, then redeploy:

```
APP_MODE=live
ANAKIN_API_KEY=...
DEEPSEEK_API_KEY=...
```

Open **Settings** in the deployed app. It probes each provider against its real
endpoint, so it will tell you whether your plan actually grants search — a key
being present proves nothing. `npm run doctor` in the Render shell does the same.

Keep `EMAIL_PROVIDER=none` until you deliberately enable sending. When you do,
set a verified sender and put only your own address in `EMAIL_ALLOWLIST` first.
Draft approval is always required regardless.

---

## Part 4 — Operations

- **Always HTTPS.** Basic auth sends the password on every request.
- **One instance only.** Concurrent writers to one SQLite file risk corruption,
  and job recovery assumes a single worker. Render enforces this: a service with
  a disk cannot scale past one instance.
- **Deploys have a short gap.** Render stops the old instance before starting
  the new one when a disk is attached.
- **Never split the worker into its own Render service.** Disks cannot be shared
  between services, so it could not see the database.
- **Backups:** do not copy the live `.db` while writes are in flight — WAL files
  may hold committed data. Use `VACUUM INTO` for a consistent copy, then move
  that off the disk. Test a restore.
- **Never run `npm run seed` against production** — it inserts sample records.

---

## Local checks

### Run both roles locally

```sh
# API role — serves /api, runs the worker
DATABASE_PATH=./data/api.db npm run build && npm start        # :3000

# UI role — proxies /api to the API role
API_ORIGIN=http://localhost:3000 npm run build
npx next start -p 3001                                         # :3001
```

Open <http://localhost:3001>. Everything should work exactly as in production.

### Docker

```sh
docker build -t supplysaathi .
docker run --rm -p 3000:3000 -e APP_MODE=demo \
  -v supplysaathi-data:/app/data supplysaathi
```

**This was built and run during development** — image builds, migrations apply
to the mounted volume, both processes start, a full demo case completes, data
survives a restart, and SIGTERM reaches the worker's shutdown handler. Image is
about 1.3 GB.

Four things the container gets right, each of which failed before being fixed:

1. **Disk ownership.** A mounted volume arrives root-owned, replacing whatever
   the image created there. `docker-entrypoint.sh` starts as root, takes
   ownership of the data directory, then drops to the unprivileged `node` user.
   Without it the only symptom is an opaque `unable to open database file`.
2. **`ps` is present.** `concurrently --kill-others` walks the process tree with
   `ps`; the slim base has none, so shutdown crashed instead of stopping the
   sibling.
3. **`HOME` is set.** Dropping privileges does not change `HOME`; left as
   `/root`, npm fails writing caches as `node` and logs errors that look like
   failures.
4. **The supervisor is PID 1.** Neither `npm start` nor `npx` will do — both
   leave npm at PID 1, where it swallows SIGTERM and the worker never releases
   its in-flight job.

A non-zero exit code on `docker stop` is expected: `concurrently` reports a
signal-killed child. The stop was deliberate.

---

## References

- [Render Blueprint spec](https://render.com/docs/blueprint-spec) ·
  [Docker services](https://render.com/docs/docker) ·
  [Disks](https://render.com/docs/disks) ·
  [Compute plans](https://render.com/docs/compute-plans)
- [Next.js rewrites](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites) ·
  [Vercel environment variables](https://vercel.com/docs/environment-variables)
