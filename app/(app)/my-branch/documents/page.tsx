import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, scopedBranch, branchLocked } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import { listEmployees } from "@/lib/people";
import {
  BRANCH_DOC_CATEGORIES, CONTACT_CATEGORIES, LICENSE_TYPES,
  branchDocuments, branchContacts, certifiedOperators, contactCategoryLabel, rentIncreasePct,
} from "@/lib/branch-hub";
import { AddDocButton, AddContactButton, DeleteX } from "./BranchHubClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Branch Hub — Clements Command & Control" };

const money = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

export default async function BranchHubPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const branch = scopedBranch(user, requested) ?? BRANCHES[0].key;
  const locked = branchLocked(user);

  const [docGroups, contactGroups, operators, employees] = await Promise.all([
    branchDocuments(branch), branchContacts(branch), certifiedOperators(branch), listEmployees(),
  ]);

  const docCats = BRANCH_DOC_CATEGORIES.map((c) => ({ key: c.key as string, label: c.label }));
  const contactCatOpts = CONTACT_CATEGORIES.map((c) => ({ key: c.key as string, label: c.label }));
  const licenseTypes = LICENSE_TYPES.map((c) => ({ key: c.key as string, label: c.label }));
  const empOpts = employees.map((e) => ({ id: e.id, name: e.name }));

  return (
    <>
      <PageHeader title="Branch Hub" subtitle={`${branchLabel(branch)} — licenses, lease & facility, key contacts a new manager needs`} />

      {!locked ? (
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
          {BRANCHES.map((b) => (
            <Link key={b.key} href={`/my-branch/documents?branch=${b.key}`} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${branch === b.key ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"}`}>{b.label}</Link>
          ))}
        </div>
      ) : null}

      {/* Certified operator compliance banner */}
      <Card className={`p-4 mb-5 ${operators.length === 0 ? "ring-1 ring-red-300" : ""}`}>
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-ink">Certified operator</div>
          <span className="text-[11px] text-muted">FL Ch. 482 requires a certified operator per branch</span>
        </div>
        {operators.length === 0 ? (
          <p className="mt-2 text-sm text-red-600">No certified operator on file for {branchLabel(branch)}. Add the operator&rsquo;s license under Licensing below.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {operators.map((o) => {
              const crit = o.daysOut != null && o.daysOut <= 45;
              return (
                <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                  <span className="font-medium text-ink">{o.holder}</span>
                  {o.categories ? <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-medium text-brand-700">{o.categories}</span> : null}
                  {o.licenseNumber ? <span className="text-xs text-muted">#{o.licenseNumber}</span> : null}
                  {o.employeeBranch && o.employeeBranch !== branch ? <span className="text-[11px] text-muted">(works {branchLabel(o.employeeBranch)})</span> : null}
                  {o.expirationDate ? <span className={`ml-auto text-xs font-medium ${o.daysOut != null && o.daysOut <= 0 ? "text-red-600" : crit ? "text-amber-600" : "text-muted"}`}>{o.daysOut != null && o.daysOut <= 0 ? "EXPIRED" : `expires ${fmt(o.expirationDate.toISOString())}`}</span> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Documents by subcategory */}
      <div className="space-y-4 mb-6">
        {docGroups.map((g) => (
          <Card key={g.key} className="p-0 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-line bg-black/[0.02] flex items-center justify-between">
              <div>
                <span className="text-sm font-semibold text-ink">{g.label}</span>
                <span className="ml-2 text-[11px] text-muted">{g.hint}</span>
              </div>
              {(user.role === "admin" || user.role === "manager") ? <AddDocButton category={g.key} docCats={docCats} licenseTypes={licenseTypes} employees={empOpts} branch={branch} /> : null}
            </div>
            {g.items.length === 0 ? (
              <p className="px-4 py-5 text-center text-sm text-muted">Nothing filed yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {g.items.map((d) => {
                  const expIso = d.expirationDate ? d.expirationDate.toISOString() : d.leaseEnd ? d.leaseEnd.toISOString() : null;
                  const expDate = d.expirationDate ?? d.leaseEnd;
                  const days = expDate ? Math.round((expDate.getTime() - Date.now()) / 864e5) : null;
                  const pct = rentIncreasePct(d.monthlyRent, d.priorMonthlyRent);
                  return (
                    <li key={d.id} className="px-4 py-3 flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {d.filePath ? <a href={`/api/branch/document/${d.id}/file`} target="_blank" className="text-sm font-medium text-brand-700 hover:underline">📄 {d.title}</a> : <span className="text-sm font-medium text-ink">{d.title}</span>}
                          {d.categories ? <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-medium text-brand-700">{d.categories}</span> : null}
                        </div>
                        <div className="text-xs text-muted mt-0.5">
                          {g.key === "licensing" ? [d.employee?.name ?? d.holderName, d.licenseNumber ? `#${d.licenseNumber}` : null].filter(Boolean).join(" · ") : null}
                          {g.key === "lease" ? [d.landlord, d.monthlyRent != null ? `${money(d.monthlyRent)}/mo` : null].filter(Boolean).join(" · ") : null}
                          {d.notes && g.key === "other" ? d.notes : null}
                        </div>
                        {pct != null && pct > 0 ? <div className="text-[11px] text-amber-600 mt-0.5">▲ Rent up {pct.toFixed(1)}% from {money(d.priorMonthlyRent)}</div> : null}
                      </div>
                      <div className="text-right shrink-0">
                        {expIso ? <div className={`text-xs font-medium ${days != null && days <= 0 ? "text-red-600" : days != null && days <= (g.key === "lease" ? 270 : 90) ? "text-amber-600" : "text-muted"}`}>{g.key === "lease" ? "lease ends" : "expires"} {fmt(expIso)}{days != null && days > 0 ? ` · ${days}d` : days != null && days <= 0 ? " · expired" : ""}</div> : null}
                        {(user.role === "admin" || user.role === "manager") ? <div className="mt-1"><DeleteX kind="document" id={d.id} /></div> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        ))}
      </div>

      {/* Key contacts */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-line bg-black/[0.02] flex items-center justify-between">
          <div className="text-sm font-semibold text-ink">Key contacts</div>
          {(user.role === "admin" || user.role === "manager") ? <AddContactButton category="property_manager" contactCats={contactCatOpts} branch={branch} label="+ Add contact" /> : null}
        </div>
        {contactGroups.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">No contacts yet. Add the property manager, vendors, FDACS rep, and anyone a new manager would need.</p>
        ) : (
          <div className="divide-y divide-line">
            {contactGroups.map((g) => (
              <div key={g.key} className="px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">{contactCategoryLabel(g.key)}</div>
                <ul className="space-y-2">
                  {g.items.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-ink">{c.name}{c.role ? <span className="font-normal text-muted"> · {c.role}</span> : null}</div>
                        <div className="text-xs text-muted">{[c.company, c.phone, c.email].filter(Boolean).join(" · ") || "—"}</div>
                        {c.notes ? <div className="text-[11px] text-muted mt-0.5">{c.notes}</div> : null}
                      </div>
                      {(user.role === "admin" || user.role === "manager") ? <DeleteX kind="contact" id={c.id} /> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
