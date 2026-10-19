# Org Chart rebuild — CanopyOS

A real reporting org chart of **rich employee tiles**: the reporting line (who reports to
whom) plus the operational facts a manager actually needs at a glance — route number,
approved services, scheduling rules, earned internal certifications, and an attributed note
log. It builds on the existing reporting structure (`Employee.reportsToId` / the `"OrgChart"`
self-relation) rather than replacing it.

## Rounds

- **Round 1 — data + services (this slice).** Schema fields, the canonical service
  catalog, the tile/tree builder, directory search, the employee-note log, and the scoped
  tile-field editor, exposed through `app/api/org/**`. **No UI.**
- **Round 2 — UI.** The Company → Org Chart page, the rich tile component, the new nav
  entry, the Access Rights catalog entry, and the profile "Employee Notes" section.
- **Round 3 — Copilot.** An org-chart tool for Copilot ("who handles bees in Naples?",
  "what's route 42?").

## Ground rules

- **Company-readable.** The directory/chart structure + the operational tile fields are
  visible to all authenticated users. Sensitive personnel data (pay, discipline, PTO, birth
  year, …) is **never** selected into the tile payload.
- **Append-only ledger discipline.** Employee notes are never edited or hard-deleted — a
  correction is a new note (mirrors `SalesFocusComment` / `WorkItemComment`). A future
  soft-delete is fine, but not in Round 1.
- **Additive & portable.** All new `Employee` fields are nullable; `prisma db push`-safe
  on SQLite (local) and Postgres (prod).

## Round 1 deliverables (shipped)

### Schema (`prisma/schema.prisma`)
New **nullable** `Employee` fields:

| Field | Purpose |
|---|---|
| `routeNumber` | technician/field route number — **searchable**; values load from photos later |
| `approvedServices` | JSON array of service tags they're approved to perform |
| `serviceNotes` | short free text ("Handles all bee jobs in Naples") |
| `serviceSchedulingNote` | per-service rule ("Bee jobs: schedule 3–5 PM only") |
| `personalSchedulingNote` | personal rule ("No first appt before 8:30 AM — school run") |

New model **`EmployeeNote`** — `id, employeeId (FK → Employee, onDelete Cascade), authorId?,
authorName, body, createdAt @default(now())`, `@@index([employeeId, createdAt])`. Append-only.

### Libs
- **`lib/service-catalog.ts`** — the canonical service-tag list + label map (`bees`, `wasps`,
  `rodents`, `wildlife`, `termites`, `lawn`, `mosquito`, `general`, `consultations`) with
  sanitize/serialize/parse helpers (unknown tags are dropped; stored as a JSON string).
- **`lib/org-chart.ts`**
  - `orgTileData()` → the flat tile payload per active employee. **Certifications are
    sourced from the Training Center's `CertAward` rows** (a cert is "earned" only once
    awarded), newest first, with `{ code, name, awardedAt }`.
  - `buildOrgTree()` → `{ roots, tiles }` — the reporting tree of tiles (children sorted by
    name; a person whose manager isn't active becomes a root).
  - `searchOrg(tiles, query, { branch?, service? })` → matches **name, title, role, branch
    (key+label), routeNumber, and service tags (keys+labels)**, AND across tokens, so
    "route 42", "bees Naples", or a name all resolve.
  - `canEditTileFields` / `updateTileFields` — the **scoped** tile-field editor (HR /
    leadership / super-admins edit anyone; a branch manager edits only their own branch's
    people — checked against the target employee's branch, enforced server-side).
- **`lib/employee-notes.ts`** — `addEmployeeNote(user, employeeId, body)` (stamps
  authorId/authorName + createdAt; add gate = managers / HR / leadership / super-admins) and
  `listEmployeeNotes(employeeId)` (newest first, with author + timestamp).

### API (`app/api/org/**`)
- `GET /api/org` → `{ roots, tiles }`; with `?q=` / `?branch=` / `?service=` → `{ results }`;
  `?flat=1` → `{ tiles }`. Company-readable (any signed-in user).
- `GET /api/org/notes?employeeId=` → `{ notes }` · `POST /api/org/notes { employeeId, body }`
  → add a note (access-gated).
- `POST /api/org/tile { employeeId, ...fields }` → scoped tile-field update.

## Tile payload shape

```ts
type OrgTile = {
  id; name; title; role;
  branch; branchLabel;            // key + human label
  reportsToId;                    // for the tree
  routeNumber;
  certifications: { code; name; awardedAt }[];   // earned internal certs (CertAward)
  approvedServices: { key; label }[];
  serviceNotes; serviceSchedulingNote; personalSchedulingNote;
  latestNotes: { id; authorId; authorName; body; createdAt }[];  // latest 1–2
};
```

`buildOrgTree()` returns `OrgTreeNode = OrgTile & { reports: OrgTreeNode[] }`.
