# Deploying Clements Command & Control

The sandbox runs on SQLite locally. To get a public link, deploy the app to
**Vercel** and give it a hosted **Postgres** database. The repo is set up so a
deploy needs **no code edits and no manual database commands** — the build
detects Postgres, switches the Prisma provider, creates the schema, and loads
the sample data automatically the first time.

> This is a **separate GitHub repo** from any other project, so importing it
> into Vercel creates a **brand-new, isolated Vercel project** — its own domain,
> env vars, and database. It shares nothing with your other Vercel projects.

---

## Fastest path — a link in ~10 minutes (Vercel + Neon Postgres)

1. **Push the branch** (already done): `claude/trusting-mendel-a9oe34`.

2. **Import to Vercel.** Go to <https://vercel.com/new>, pick the
   `Clements-Inventory-Tracker-` repo. On the import screen set **Branch** to
   `claude/trusting-mendel-a9oe34` (or merge it to `main` first and use that).
   Don't deploy yet — add the database and env vars first.

3. **Create a Postgres database.** In the Vercel project, open the **Storage**
   tab → **Create Database** → **Neon (Postgres)**. Vercel provisions it and
   auto-adds a `DATABASE_URL` env var. Use the **direct** (non-pooled)
   connection string for `DATABASE_URL` — Neon shows it when you toggle off
   "Pooled connection". The build's schema creation + data repair is most
   reliable on the direct URL.

   > ⚠️ **Pooling gotcha (this is the #1 cause of runaway "Function Duration"
   > bills):** a plain **pooled / pgbouncer** Neon URL (host contains `-pooler`,
   > no flag) makes Prisma **hang** on runtime queries — functions run to their max
   > duration and Vercel bills for every second. The app now **auto-appends
   > `pgbouncer=true` + `connect_timeout=10` + `pool_timeout=10` + `options=-c
   > statement_timeout=10000`** to any Postgres `DATABASE_URL` at runtime
   > (`lib/prisma.ts`), so a bare pooled URL no longer hangs. The appends only ever
   > ADD parameters — the host is never rewritten, so the runtime keeps whichever
   > endpoint you configure. Even so, the recommended setup is:
   > - **`DATABASE_URL`** = the **pooled** endpoint (best for serverless connection
   >   count); the code adds `pgbouncer=true` for you.
   > - **`DIRECT_URL`** (or `DATABASE_URL_UNPOOLED`) = the **direct** (non-pooled)
   >   endpoint. Deploy-time `prisma db push` uses this (it derives it by dropping
   >   `-pooler` if unset) so schema migrations never hang on the pooler.
   >
   > **Second guardrail — function duration.** Every handler under `app/api/**`
   > declares an explicit `export const maxDuration`: **20s** by default, **60s**
   > for the routes that call the Anthropic API or parse an uploaded spreadsheet.
   > That is the ceiling Vercel bills against, and it takes precedence over
   > `vercel.json`. If a route legitimately needs longer, raise that one route's
   > export rather than the default. Build-time work is unaffected — the schema
   > push and seeds in `scripts/deploy-db.ts` use their own client and keep full
   > time.

4. **Add the remaining env vars** (Project → Settings → Environment Variables):

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | Postgres connection string (from step 3) |
   | `AUTH_SECRET` | any long random string — e.g. run `openssl rand -base64 32` |
   | `ANTHROPIC_API_KEY` | *(optional)* your Anthropic key for live invoice reading; omit to use the mock parser |
   | `ANTHROPIC_MODEL` | *(optional)* `claude-opus-4-8` |
   | `COAST_API_KEY` | *(optional)* Coast fuel-card API key — enables the live fuel sync (`/fleet/fuel` "Sync from Coast" + the 6-hourly `fuel-sync` cron). Omit to keep manual `.xlsx` statement uploads only. |
   | `COAST_API_BASE` | *(optional)* override the Coast API host — default `https://public.coastpay.com`; set `https://public.demo.coastpay.com` for the sandbox |

5. **Deploy.** The build runs schema creation + sample-data seed automatically.
   When it finishes, open the `*.vercel.app` URL and sign in:

   - **Email:** `manager@clementspest.com`
   - **Password:** `clements123`  ← change this after first login (see below)

That's it — you have a shareable link, and "Add to Home Screen" installs it as
an app on any phone.

---

## After it's live

**Change the demo password.** Generate a new hash locally:

```bash
node -e "const {scryptSync,randomBytes}=require('crypto');const s=randomBytes(16).toString('hex');console.log(s+':'+scryptSync(process.argv[1],s,64).toString('hex'))" "yourNewPassword"
```

Paste the output into `users.password_hash` for the manager row (Neon has a SQL
editor, or use any Postgres client). Add more managers by inserting rows the
same way.

**Durable file storage (uploads).** All uploads — vehicle documents (insurance,
registration, title, bill of sale), personnel-record attachments, separation
docs, training materials, and parsed invoices — go through `lib/storage.ts`.

- **Production:** set `BLOB_READ_WRITE_TOKEN` and files are stored in **Vercel
  Blob** (Vercel project → Storage → create a Blob store; the token is added to
  the project automatically). Nothing else to configure.
- **Local dev / no token:** files fall back to `public/uploads` on local disk.

Without a token in production the app still works — parsing/reads use the
in-memory bytes — the original just isn't retained (Vercel's filesystem is
ephemeral), so set the token to keep documents.

Stored URLs are public-but-unguessable (same as before). Vehicle-insurance and
HR documents can contain sensitive data (e.g. driver's-license numbers); before
going live, consider gating downloads behind an authenticated proxy route
(`/api/file/[id]` that checks the session, then streams from Blob) and switching
`access` to non-public in `lib/storage.ts`. This pairs with the role/access-control
work.

**Linking to Google Drive / other clouds (later, optional).** Vercel Blob already
gives durable storage, so Drive isn't required for the app to work. Add a Drive
(or SharePoint/Dropbox) integration only if you want documents to *also* live in
your existing Workspace so staff can browse them outside the portal — that's an
OAuth + Drive API mirror we can layer on `lib/storage.ts` without touching the
callers.

---

## Notes

- **Local dev is unaffected.** With a `file:` `DATABASE_URL`, the build's
  `deploy-db` step is a no-op, so `npm run dev` keeps using SQLite.
- **Redeploys don't wipe data.** The seed only runs when the database is empty.
- **Provider switch is automatic.** `scripts/deploy-db.ts` flips the Prisma
  datasource to `postgresql` at build time when it sees a Postgres URL; the
  committed schema stays on SQLite for local use.

---

## Activating email + daily reminders (phase-1 wiring)

The app captures everything and is wired for email, but **nothing is sent until
you provide an email provider**. Until then every send is recorded in the
`EmailLog` table and safely skipped.

### 1. Turn on email (Resend)
1. Create a [Resend](https://resend.com) account, verify your sending domain
   (`clementspestcontrol.com`), and create an API key.
2. In the Vercel project → Settings → Environment Variables, set:
   - `RESEND_API_KEY` — the key from Resend
   - `EMAIL_FROM` — e.g. `Clements Command & Control <no-reply@clementspestcontrol.com>`
   - `APP_URL` — your deployed URL (used to build links in emails)
3. Redeploy. Inspection scores, training assignments/reminders, personnel-record
   notifications (to April + Graham + Chris + Tim), and e-signature links will
   now actually deliver.

### 2. Turn on the scheduled jobs (Vercel Cron)
`vercel.json` declares two crons:

| Path | Schedule | Purpose |
| --- | --- | --- |
| `/api/cron/daily` | `0 13 * * *` (daily) | Training + e-signature reminders |
| `/api/cron/sales-sync` | `0 * * * *` (hourly) | Pull the Sales Center sheet |

1. Set `CRON_SECRET` (any long random string: `openssl rand -hex 32`) in the
   Vercel env. Vercel automatically sends it as a bearer token on cron runs, and
   the endpoints reject anything else.
2. Redeploy. The daily job runs at 13:00 UTC (≈ morning ET); the sales sync runs
   hourly. You can also trigger either manually as an admin by POSTing to its path.

> ⚠️ **The hourly `sales-sync` cron requires the Vercel Pro plan.** The Hobby
> (free) plan only allows crons that run **at most once per day**, and — this is
> the gotcha — Vercel silently **rejects every new deployment** while a sub-daily
> cron is present (error: "Hobby accounts are limited to daily cron jobs"). That
> looks exactly like "pushes stopped deploying" with no obvious cause. If you ever
> run this project on Hobby, change `sales-sync` in `vercel.json` to a daily
> schedule (e.g. `0 6 * * *`) or remove it — otherwise **nothing will deploy.**
> The branch-data repair does **not** depend on this cron; it runs at build time
> (`scripts/deploy-db.ts`), so a daily or removed sales cron doesn't affect it.

### 3. Notification recipients (optional)
Defaults resolve to the seeded company addresses. Override with `HR_EMAIL`,
`FIELD_OPS_EMAIL`, `COO_EMAIL`, `OWNER_EMAIL` if they change.

---

## ⚠️ Circle back at go-live: automated spreadsheet feeds

Some data comes from live Google Sheets that auto-refresh from an outside system
(today: **Sales Center**, via the sheet's hourly API feed). These feeds **cannot
be tested from the dev sandbox** — its network blocks `docs.google.com` — so they
only come alive once the app is deployed on Vercel **and** the sheet is shared.
Run this checklist when the site goes live, and again whenever a new automated
sheet is added:

### Sales Center (built — needs the sheet shared)
- [ ] **Share the sheet for reading without a login.** In the Google Sheet →
  **Share → General access → "Anyone with the link – Viewer"** (or **File →
  Share → Publish to web**). Until then the app gets a Google login page instead
  of data and the Sales page shows a "sheet sync error" note.
- [ ] **(Optional) Pin the sheet URL.** The default is baked in, but you can
  override it with a `SALES_SHEET_URL` env var or a `sales_sheet_url` row in the
  `Setting` table (env wins). Use this to point at a different workbook/tab
  (`export?format=csv&gid=<tab-gid>`).
- [ ] **Set `CRON_SECRET`** (same one as the daily cron above). `vercel.json`
  already declares the hourly job `/api/cron/sales-sync`; Vercel sends the secret
  as a bearer token and the endpoint rejects anything else.
- [ ] **Verify.** After deploy, open **Management → Sales & Attrition** and click
  **Sync now** (admin/manager). You should see the live tiles populate (MTD/QTD/
  YTD close rates, by-branch, reps, sources). The hourly cron keeps it fresh.

### Pattern for future automated sheets
When wiring another auto-updating spreadsheet (e.g. a finance or ops feed), reuse
the Sales Center shape: a `lib/*-sync.ts` reader (CSV export URL + parser + a
`*Snapshot` table), an admin-triggered `POST /api/.../sync` route, and a
`vercel.json` cron guarded by `CRON_SECRET`. **Each new sheet must be shared
"Anyone with the link – Viewer" before its feed will work in production** — add
it to this checklist when you build it.
