"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import DateInput from "@/components/DateInput";

type Opt = { key: string; label: string };
type EmpOpt = { id: string; name: string };
export type DocItem = {
  id: string; category: string; title: string; filePath: string | null; holderName: string | null; employeeName: string | null;
  licenseType: string | null; licenseNumber: string | null; categories: string | null; issueDate: string | null; expirationDate: string | null;
  landlord: string | null; monthlyRent: number | null; priorMonthlyRent: number | null; leaseStart: string | null; leaseEnd: string | null; notes: string | null;
};
export type ContactItem = { id: string; category: string; name: string; company: string | null; role: string | null; phone: string | null; email: string | null; website: string | null; notes: string | null };

const inp = "mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface";
const money = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

// ---- Edit-document modal (rename / edit fields / MOVE to another branch) ----
export type DocEdit = {
  id: string; branch: string; category: string; title: string;
  employeeId: string; holderName: string; licenseType: string; licenseNumber: string; categories: string;
  issueDate: string; expirationDate: string;
  landlord: string; monthlyRent: number | null; leaseStart: string; leaseEnd: string; notes: string;
};
function EditDocModal({ doc, branches, docCats, licenseTypes, employees, canMove, onClose, onDone }: {
  doc: DocEdit; branches: Opt[]; docCats: Opt[]; licenseTypes: Opt[]; employees: EmpOpt[]; canMove: boolean; onClose: () => void; onDone: () => void;
}) {
  const [f, setF] = useState({
    branch: doc.branch, category: doc.category, title: doc.title ?? "",
    employeeId: doc.employeeId ?? "", holderName: doc.holderName ?? "",
    licenseType: doc.licenseType || "cpo", licenseNumber: doc.licenseNumber ?? "", categories: doc.categories ?? "",
    issueDate: doc.issueDate ?? "", expirationDate: doc.expirationDate ?? "",
    landlord: doc.landlord ?? "", monthlyRent: doc.monthlyRent != null ? String(doc.monthlyRent) : "",
    leaseStart: doc.leaseStart ?? "", leaseEnd: doc.leaseEnd ?? "", notes: doc.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    if (!f.title.trim()) return setError("Give the document a title.");
    setBusy(true); setError(null);
    const res = await fetch("/api/branch/document", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", id: doc.id, ...f }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not save.");
    onDone();
  }

  const isLic = f.category === "licensing";
  const isLease = f.category === "lease";

  return (
    <Modal title="Edit document" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <select value={f.category} onChange={(e) => set("category", e.target.value)} className={inp}>
            {docCats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Title"><input value={f.title} onChange={(e) => set("title", e.target.value)} className={inp} /></Field>
      </div>

      {canMove ? (
        <Field label="Branch (move to…)">
          <select value={f.branch} onChange={(e) => set("branch", e.target.value)} className={inp}>
            {branches.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
        </Field>
      ) : null}

      {isLic ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="License type">
              <select value={f.licenseType} onChange={(e) => set("licenseType", e.target.value)} className={inp}>{licenseTypes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
            </Field>
            <Field label="License #"><input value={f.licenseNumber} onChange={(e) => set("licenseNumber", e.target.value)} className={inp} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Holder (employee)">
              <select value={f.employeeId} onChange={(e) => set("employeeId", e.target.value)} className={inp}>
                <option value="">— not linked —</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </Field>
            <Field label="Categories (e.g. GHP,LAWN,WDO)"><input value={f.categories} onChange={(e) => set("categories", e.target.value)} className={inp} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Issue date"><DateInput value={f.issueDate} onChange={(v) => set("issueDate", v)} /></Field>
            <Field label="Expiration date"><DateInput value={f.expirationDate} onChange={(v) => set("expirationDate", v)} /></Field>
          </div>
        </>
      ) : null}

      {isLease ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Landlord / property"><input value={f.landlord} onChange={(e) => set("landlord", e.target.value)} className={inp} /></Field>
            <Field label="Monthly rent ($)"><input value={f.monthlyRent} onChange={(e) => set("monthlyRent", e.target.value)} className={inp} inputMode="decimal" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lease start"><DateInput value={f.leaseStart} onChange={(v) => set("leaseStart", v)} /></Field>
            <Field label="Lease end (renewal)"><DateInput value={f.leaseEnd} onChange={(v) => set("leaseEnd", v)} /></Field>
          </div>
        </>
      ) : null}

      <Field label="Notes"><textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className={inp} /></Field>
      <p className="text-[11px] text-muted">To move this to a different kind of record (e.g. a vehicle), delete it here and re-add it through the Document Center so the agent can re-file it.</p>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <ModalActions busy={busy} onClose={onClose} onSave={save} label="Save changes" />
    </Modal>
  );
}

// ---- Add-contact modal ----
function ContactModal({ branch, preset, contactCats, onClose, onDone }: { branch: string; preset: { category: string }; contactCats: Opt[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ category: preset.category, name: "", company: "", role: "", phone: "", email: "", website: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    if (!f.name.trim()) return setError("Give the contact a name.");
    setBusy(true); setError(null);
    const res = await fetch("/api/branch/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", branch, ...f }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not save.");
    onDone();
  }

  return (
    <Modal title="Add contact" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type"><select value={f.category} onChange={(e) => set("category", e.target.value)} className={inp}>{contactCats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></Field>
        <Field label="Name"><input value={f.name} onChange={(e) => set("name", e.target.value)} className={inp} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Company"><input value={f.company} onChange={(e) => set("company", e.target.value)} className={inp} /></Field>
        <Field label="Role / title"><input value={f.role} onChange={(e) => set("role", e.target.value)} className={inp} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone"><input value={f.phone} onChange={(e) => set("phone", e.target.value)} className={inp} inputMode="tel" /></Field>
        <Field label="Email"><input value={f.email} onChange={(e) => set("email", e.target.value)} className={inp} inputMode="email" /></Field>
      </div>
      <Field label="Notes"><textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className={inp} /></Field>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <ModalActions busy={busy} onClose={onClose} onSave={save} label="Save contact" />
    </Modal>
  );
}

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
function ModalActions({ busy, onClose, onSave, label }: { busy: boolean; onClose: () => void; onSave: () => void; label: string }) {
  return (
    <div className="flex gap-2 pt-1">
      <button onClick={onClose} className={btn.secondary}>Cancel</button>
      <button onClick={onSave} disabled={busy} className={`${btn.primary} flex-1`}>{busy ? "Saving…" : label}</button>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-ink">{label}{children}</label>;
}

// Small client action buttons used by the server page (add doc / contact / delete).
// Documents are now added ONLY through the AI Document Center (one way in, so the
// agent proposes where each file lives and the user approves). The branch hub's
// "+ Add" keeps its place but routes there instead of opening a direct-upload
// modal that bypassed the intake.
export function AddDocButton(props: { category?: string; docCats?: Opt[]; licenseTypes?: Opt[]; employees?: EmpOpt[]; branch: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push(`/management/documents?tab=add&branch=${props.branch}`)}
      className="text-xs font-medium text-brand-700 hover:underline"
    >
      + Add
    </button>
  );
}
export function EditDocButton({ doc, branches, docCats, licenseTypes, employees, canMove }: { doc: DocEdit; branches: Opt[]; docCats: Opt[]; licenseTypes: Opt[]; employees: EmpOpt[]; canMove: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="text-xs font-medium text-brand-700 hover:underline">Edit</button>
      {open ? <EditDocModal doc={doc} branches={branches} docCats={docCats} licenseTypes={licenseTypes} employees={employees} canMove={canMove} onClose={() => setOpen(false)} onDone={() => { setOpen(false); router.refresh(); }} /> : null}
    </>
  );
}
export function AddContactButton({ category, contactCats, branch, label = "+ Add" }: { category: string; contactCats: Opt[]; branch: string; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="text-xs font-medium text-brand-700 hover:underline">{label}</button>
      {open ? <ContactModal branch={branch} preset={{ category }} contactCats={contactCats} onClose={() => setOpen(false)} onDone={() => { setOpen(false); router.refresh(); }} /> : null}
    </>
  );
}
// One-click repair: re-runs the branch-hub reconcile against the live database
// (assigns each operator to the branch they certify, restores missing operators,
// business licenses, and leases). Idempotent; leaves manager uploads untouched.
export function RepairButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function repair() {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/branch/reconcile", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg(data.error ?? "Repair failed."); return; }
    setMsg(`Repaired — ${data.created ?? 0} added, ${data.updated ?? 0} corrected.`);
    router.refresh();
  }
  return (
    <div className="flex items-center gap-2">
      {msg ? <span className="text-[11px] text-muted">{msg}</span> : null}
      <button onClick={repair} disabled={busy} className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50">{busy ? "Repairing…" : "↻ Repair branch data"}</button>
    </div>
  );
}
export function DeleteX({ kind, id }: { kind: "document" | "contact"; id: string }) {
  const router = useRouter();
  async function del() {
    if (!confirm("Remove this?")) return;
    await fetch(`/api/branch/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id }) });
    router.refresh();
  }
  return <button onClick={del} className="text-xs text-muted hover:text-red-600">Delete</button>;
}
