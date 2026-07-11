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

**Durable invoice files (optional).** Uploaded invoices are not persisted on
Vercel's serverless filesystem — parsing still works (it reads the file in
memory), the original just isn't kept. To store originals, add a Supabase (or
Vercel Blob) bucket and upload in `app/api/check-in/parse/route.ts` where the
local `writeFile` currently runs; store the returned path and generate signed
URLs to view them.

---

## Notes

- **Local dev is unaffected.** With a `file:` `DATABASE_URL`, the build's
  `deploy-db` step is a no-op, so `npm run dev` keeps using SQLite.
- **Redeploys don't wipe data.** The seed only runs when the database is empty.
- **Provider switch is automatic.** `scripts/deploy-db.ts` flips the Prisma
  datasource to `postgresql` at build time when it sees a Postgres URL; the
  committed schema stays on SQLite for local use.
