# Deploying Clements Inventory

The sandbox runs entirely locally (SQLite + local file storage). To go live,
host the app on **Vercel** and move the database, file storage, and secrets to
**Supabase**. Budget ~30–45 minutes the first time.

---

## 1. Create the Supabase project (database + storage)

1. Sign up at <https://supabase.com> and create a new project. Pick a region
   close to Florida (e.g. `us-east-1`). Save the database password.
2. In **Project Settings → Database → Connection string**, copy the
   **URI**. You'll use two forms of it:
   - **Pooled** (port `6543`, `...pooler.supabase.com`) for the app at runtime.
   - **Direct** (port `5432`) for running migrations.
3. In **Storage**, create a bucket named `invoices` (keep it **private**).

## 2. Point Prisma at Postgres

Edit `prisma/schema.prisma`:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")       // pooled connection
  directUrl = env("DIRECT_URL")         // direct connection (migrations)
}
```

Create the schema in Supabase and seed it:

```bash
# Use the DIRECT (5432) URL for these one-off commands
DATABASE_URL="postgresql://...:5432/postgres" npx prisma db push
DATABASE_URL="postgresql://...:5432/postgres" npm run db:seed   # optional sample data
```

> **Moving existing sandbox data (optional).** The local SQLite `dev.db` is just
> the sample seed, so most teams start fresh with `db:seed` and enter real data
> through the app. If you must carry data over, export each table to CSV from
> `dev.db` and import via the Supabase table editor, or use a tool like
> `pgloader`. Re-run the seed only on an empty database.

## 3. Deploy the app on Vercel

1. Push this repo to GitHub and import it at <https://vercel.com/new>.
2. In **Project → Settings → Environment Variables**, add:

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | Supabase **pooled** URI (port 6543) |
   | `DIRECT_URL` | Supabase **direct** URI (port 5432) |
   | `AUTH_SECRET` | `openssl rand -base64 32` |
   | `ANTHROPIC_API_KEY` | your Anthropic key (enables live invoice reading) |
   | `ANTHROPIC_MODEL` | `claude-opus-4-8` (or your preferred model) |

3. Deploy. The `build` script runs `prisma generate` automatically. Vercel gives
   you a URL — open it, sign in, and add it to your phone's home screen.

## 4. Move invoice file storage to Supabase Storage

The sandbox writes uploaded invoices to `public/uploads`, which is **ephemeral
on Vercel** (wiped on every deploy). Switch to the `invoices` bucket for
production. In `app/api/check-in/parse/route.ts`, replace the local
`writeFile(...)` block with an upload:

```ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // server-only secret
);

const { data, error } = await supabase.storage
  .from("invoices")
  .upload(stored, bytes, { contentType: mime, upsert: false });
if (error) throw error;
const filePath = data.path; // store this; generate signed URLs to view later
```

Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Vercel's env, and
`npm install @supabase/supabase-js`. Parsing still sends the file bytes straight
to Claude, so nothing else in the flow changes.

## 5. Auth in production

Auth is built in (email/password with hashed passwords and DB-backed sessions) —
no third-party auth service required. To add a manager, insert a `users` row
with a hashed password. A quick way:

```bash
node -e "const {scryptSync,randomBytes}=require('crypto');const s=randomBytes(16).toString('hex');console.log(s+':'+scryptSync(process.argv[1],s,64).toString('hex'))" "theNewPassword"
```

Put the output in `users.password_hash` (via the Supabase table editor). Rotate
`AUTH_SECRET` only when you want to force everyone to sign in again.

## 6. Post-deploy checklist

- [ ] Sign in works on the Vercel URL.
- [ ] Check-Out posts and shows a receipt.
- [ ] Check-In reads a real invoice (confirms `ANTHROPIC_API_KEY` is set).
- [ ] Uploaded invoices land in the Supabase `invoices` bucket.
- [ ] Dashboard, Reports export, Reconcile, and Alerts all load.
- [ ] "Add to Home Screen" installs the PWA on iOS and Android.
