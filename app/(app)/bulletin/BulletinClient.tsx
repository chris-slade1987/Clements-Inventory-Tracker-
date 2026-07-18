"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import DateInput from "@/components/DateInput";
import Glyph from "@/components/Glyph";

const inp = "mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface";

const BRANCHES = [
  { key: "", label: "Company-wide" },
  { key: "vero", label: "Vero Beach" },
  { key: "stuart", label: "Stuart" },
  { key: "orlando", label: "Orlando" },
  { key: "naples", label: "Naples" },
];
const POST_TYPES = [
  { key: "story", label: "Story" },
  { key: "announcement", label: "Announcement" },
  { key: "shoutout", label: "Shoutout" },
  { key: "event", label: "Event" },
];
const EVENT_KINDS = [
  { key: "holiday", label: "Holiday" },
  { key: "closure", label: "Office closure" },
  { key: "early_release", label: "Early release" },
  { key: "event", label: "Event" },
];

type PostSeed = {
  id?: string; type: string; title: string; excerpt: string | null; body: string | null;
  linkUrl: string | null; location: string | null; honoreeName: string | null; branch: string | null; eventDate: string | null;
};

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <Card className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 space-y-3 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-ink text-xl leading-none">×</button>
        </div>
        {children}
      </Card>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-ink">{label}{children}</label>;
}
function Actions({ busy, onClose, onSave, label }: { busy: boolean; onClose: () => void; onSave: () => void; label: string }) {
  return (
    <div className="flex gap-2 pt-1">
      <button onClick={onClose} className={btn.secondary}>Cancel</button>
      <button onClick={onSave} disabled={busy} className={`${btn.primary} flex-1`}>{busy ? "Saving…" : label}</button>
    </div>
  );
}

function PostModal({ seed, onClose, onDone }: { seed?: PostSeed; onClose: () => void; onDone: () => void }) {
  const editing = !!seed?.id;
  const [f, setF] = useState<PostSeed & { pinned: boolean }>({
    type: seed?.type ?? "story", title: seed?.title ?? "", excerpt: seed?.excerpt ?? "", body: seed?.body ?? "",
    linkUrl: seed?.linkUrl ?? "", location: seed?.location ?? "", honoreeName: seed?.honoreeName ?? "",
    branch: seed?.branch ?? "", eventDate: seed?.eventDate ?? "", pinned: false,
  });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    if (!f.title.trim()) return setError("Give the post a title.");
    setBusy(true); setError(null);
    let res: Response;
    if (editing) {
      res = await fetch("/api/bulletin/post", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update", id: seed!.id, ...f }) });
    } else {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => { if (v !== "" && v != null && v !== false) fd.append(k, String(v)); });
      if (file) fd.append("image", file);
      res = await fetch("/api/bulletin/post", { method: "POST", body: fd });
    }
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not save.");
    onDone();
  }

  return (
    <Modal title={editing ? "Edit post" : "New post"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type"><select value={f.type} onChange={(e) => set("type", e.target.value)} className={inp}>{POST_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></Field>
        <Field label="Branch"><select value={f.branch ?? ""} onChange={(e) => set("branch", e.target.value)} className={inp}>{BRANCHES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}</select></Field>
      </div>
      <Field label="Title"><input value={f.title} onChange={(e) => set("title", e.target.value)} className={inp} placeholder="Headline shown on the tile" /></Field>
      <Field label="Excerpt (tile teaser)"><input value={f.excerpt ?? ""} onChange={(e) => set("excerpt", e.target.value)} className={inp} placeholder="One line under the title" /></Field>
      <Field label="Body (full story)"><textarea value={f.body ?? ""} onChange={(e) => set("body", e.target.value)} rows={5} className={inp} placeholder="The full post — shown on the detail page." /></Field>

      {f.type === "event" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Event date"><DateInput value={f.eventDate ?? ""} onChange={(v) => set("eventDate", v)} /></Field>
          <Field label="Location"><input value={f.location ?? ""} onChange={(e) => set("location", e.target.value)} className={inp} /></Field>
        </div>
      ) : null}
      {f.type === "shoutout" ? (
        <Field label="Person celebrated (optional)"><input value={f.honoreeName ?? ""} onChange={(e) => set("honoreeName", e.target.value)} className={inp} placeholder="e.g. Tim Slade" /></Field>
      ) : null}

      <Field label="External link (optional)"><input value={f.linkUrl ?? ""} onChange={(e) => set("linkUrl", e.target.value)} className={inp} placeholder="https://… — tile opens this instead of a detail page" /></Field>

      {!editing ? (
        <>
          <Field label="Photo (optional)"><input type="file" accept=".jpg,.jpeg,.png,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 w-full text-sm" /></Field>
          <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={f.pinned} onChange={(e) => set("pinned", e.target.checked)} /> Feature at the top</label>
        </>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Actions busy={busy} onClose={onClose} onSave={save} label={editing ? "Save changes" : "Publish post"} />
    </Modal>
  );
}

function EventModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: "", kind: "event", date: "", endDate: "", timeLabel: "", branch: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    if (!f.title.trim() || !f.date) return setError("Title and date are required.");
    setBusy(true); setError(null);
    const res = await fetch("/api/bulletin/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", ...f }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not save.");
    onDone();
  }

  return (
    <Modal title="Add calendar event" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type"><select value={f.kind} onChange={(e) => set("kind", e.target.value)} className={inp}>{EVENT_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></Field>
        <Field label="Branch"><select value={f.branch} onChange={(e) => set("branch", e.target.value)} className={inp}>{BRANCHES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}</select></Field>
      </div>
      <Field label="Title"><input value={f.title} onChange={(e) => set("title", e.target.value)} className={inp} placeholder="e.g. Thanksgiving — Closed" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date"><DateInput value={f.date} onChange={(v) => set("date", v)} /></Field>
        <Field label="End date (optional)"><DateInput value={f.endDate} onChange={(v) => set("endDate", v)} /></Field>
      </div>
      <Field label="Time note (optional)"><input value={f.timeLabel} onChange={(e) => set("timeLabel", e.target.value)} className={inp} placeholder="e.g. Closing 1:00 PM" /></Field>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Actions busy={busy} onClose={onClose} onSave={save} label="Add to calendar" />
    </Modal>
  );
}

// ---- Buttons used by the server pages ----
export function NewPostButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className={btn.primary}>+ New post</button>
      {open ? <PostModal onClose={() => setOpen(false)} onDone={() => { setOpen(false); router.refresh(); }} /> : null}
    </>
  );
}
export function EditPostButton({ post }: { post: PostSeed }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="text-xs font-medium text-brand-700 hover:underline">Edit</button>
      {open ? <PostModal seed={post} onClose={() => setOpen(false)} onDone={() => { setOpen(false); router.refresh(); }} /> : null}
    </>
  );
}
export function NewEventButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className={btn.secondary}>+ Event</button>
      {open ? <EventModal onClose={() => setOpen(false)} onDone={() => { setOpen(false); router.refresh(); }} /> : null}
    </>
  );
}
export function PinPost({ id, pinned }: { id: string; pinned: boolean }) {
  const router = useRouter();
  async function toggle() {
    await fetch("/api/bulletin/post", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pin", id }) });
    router.refresh();
  }
  return <button onClick={toggle} title={pinned ? "Unfeature" : "Feature"} className="grid h-7 w-7 place-items-center rounded-lg bg-black/45 text-white hover:bg-black/65"><Glyph name="star" filled={pinned} className="h-3.5 w-3.5" /></button>;
}
export function DeletePost({ id }: { id: string }) {
  const router = useRouter();
  async function del() {
    if (!confirm("Delete this post?")) return;
    await fetch("/api/bulletin/post", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id }) });
    router.refresh();
  }
  return <button onClick={del} title="Delete" className="grid h-7 w-7 place-items-center rounded-lg bg-black/45 text-white hover:bg-red-600"><Glyph name="trash" className="h-3.5 w-3.5" /></button>;
}
