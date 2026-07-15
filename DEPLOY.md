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
   "Pooled connection". (A pooled URL also works for the app, but the build's
   schema creation is most reliable on the direct URL.)

4. **Add the remaining env vars** (Project → Settings → Environment Variables):

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | Postgres connection string (from step 3) |
   | `AUTH_SECRET` | any long random string — e.g. run `openssl rand -base64 32` |
   | `ANTHROPIC_API_KEY` | *(optional)* your Anthropic key for live invoice reading; omit to use the mock parser |
   | `ANTHROPIC_MODEL` | *(optional)* `claude-opus-4-8` |

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

### 2. Turn on daily reminders (Vercel Cron)
`vercel.json` already declares a daily cron that calls `/api/cron/daily`
(training reminders + outstanding e-signature reminders).
1. Set `CRON_SECRET` (any long random string: `openssl rand -hex 32`) in the
   Vercel env. Vercel automatically sends it as a bearer token on cron runs, and
   the endpoint rejects anything else.
2. Redeploy. The cron runs once a day (13:00 UTC ≈ morning ET). You can also
   trigger it manually as an admin by POSTing to `/api/cron/daily`.

### 3. Notification recipients (optional)
Defaults resolve to the seeded company addresses. Override with `HR_EMAIL`,
`FIELD_OPS_EMAIL`, `COO_EMAIL`, `OWNER_EMAIL` if they change.
