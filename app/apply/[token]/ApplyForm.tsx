"use client";

import { useState } from "react";

const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = /\.(pdf|doc|docx)$/i;

export default function ApplyForm({ token, src, jobTitle }: { token: string; src: string; jobTitle: string }) {
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", email: "" });
  const [resume, setResume] = useState<File | null>(null);
  const [website, setWebsite] = useState(""); // honeypot — must stay empty
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.firstName.trim() || !form.lastName.trim()) return setError("Please enter your first and last name.");
    if (!form.phone.trim()) return setError("Please enter your best phone number.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setError("Please enter a valid email address.");
    if (!resume) return setError("Please attach your résumé (PDF or Word).");
    if (!ALLOWED_EXT.test(resume.name)) return setError("Please upload a PDF or Word document.");
    if (resume.size > MAX_RESUME_BYTES) return setError("That file is too large. Please keep your résumé under 10 MB.");

    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("token", token);
      fd.set("src", src);
      fd.set("firstName", form.firstName);
      fd.set("lastName", form.lastName);
      fd.set("phone", form.phone);
      fd.set("email", form.email);
      fd.set("website", website); // honeypot
      fd.set("resume", resume);
      const res = await fetch("/api/apply", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) return setError(data.error ?? "Something went wrong. Please try again.");
      setDone(true);
    } catch {
      setBusy(false);
      setError("We couldn't reach the server. Please check your connection and try again.");
    }
  }

  if (done) {
    return (
      <div className="text-center py-4">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-700">
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
        </div>
        <h2 className="text-2xl font-semibold text-slate-900">Application received</h2>
        <p className="mt-2 text-slate-600">
          Thanks{form.firstName ? `, ${form.firstName}` : ""} — your application for <strong className="text-slate-800">{jobTitle}</strong> has been received.
        </p>
        <p className="mt-1 text-slate-600">
          We&rsquo;ve sent a confirmation to <strong className="text-slate-800">{form.email}</strong>. Our team will be in touch if we move forward to next steps.
        </p>
      </div>
    );
  }

  const inputCls =
    "mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-[15px] text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30";

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block text-sm font-semibold text-slate-700">
          First name
          <input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} autoComplete="given-name" className={inputCls} />
        </label>
        <label className="block text-sm font-semibold text-slate-700">
          Last name
          <input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} autoComplete="family-name" className={inputCls} />
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block text-sm font-semibold text-slate-700">
          Best phone
          <input value={form.phone} onChange={(e) => set("phone", e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="(772) 555-0100" className={inputCls} />
        </label>
        <label className="block text-sm font-semibold text-slate-700">
          Email
          <input value={form.email} onChange={(e) => set("email", e.target.value)} type="email" inputMode="email" autoComplete="email" placeholder="you@email.com" className={inputCls} />
        </label>
      </div>

      <label className="block text-sm font-semibold text-slate-700">
        Résumé
        <div className="mt-1.5 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/70 px-4 py-5 text-center transition hover:border-emerald-400">
          <input
            type="file"
            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => setResume(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-emerald-700"
          />
          <p className="mt-2 text-xs text-slate-500">{resume ? `Selected: ${resume.name}` : "PDF or Word document, up to 10 MB."}</p>
        </div>
      </label>

      {/* Honeypot — visually hidden; bots fill it, humans don't. */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-[-9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl bg-emerald-600 px-5 py-3.5 text-[15px] font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
      >
        {busy ? "Submitting…" : "Submit application"}
      </button>
      <p className="text-center text-xs text-slate-500">
        By applying you agree that Clements Pest Control may contact you about this role.
      </p>
    </form>
  );
}
