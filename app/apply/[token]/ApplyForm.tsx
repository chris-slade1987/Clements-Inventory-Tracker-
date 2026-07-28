"use client";

import { useState } from "react";

const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = /\.(pdf|doc|docx)$/i;

const ABOUT_WORD_CAP = 250;
const countWords = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export default function ApplyForm({ token, src, jobTitle }: { token: string; src: string; jobTitle: string }) {
  const [form, setForm] = useState({
    firstName: "", lastName: "", phone: "", email: "",
    addressStreet: "", addressCity: "", addressState: "", addressZip: "", about: "",
  });
  const [resume, setResume] = useState<File | null>(null);
  const [website, setWebsite] = useState(""); // honeypot — must stay empty
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const aboutWords = countWords(form.about);
  const aboutOver = aboutWords > ABOUT_WORD_CAP;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.firstName.trim() || !form.lastName.trim()) return setError("Please enter your first and last name.");
    if (!form.phone.trim()) return setError("Please enter your best phone number.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setError("Please enter a valid email address.");
    if (!form.addressStreet.trim() || !form.addressCity.trim() || !form.addressState.trim() || !form.addressZip.trim())
      return setError("Please enter your full mailing address.");
    if (aboutOver) return setError(`Please keep “Tell us about yourself” to ${ABOUT_WORD_CAP} words or fewer.`);
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
      fd.set("addressStreet", form.addressStreet);
      fd.set("addressCity", form.addressCity);
      fd.set("addressState", form.addressState);
      fd.set("addressZip", form.addressZip);
      fd.set("about", form.about);
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
      <div className="py-6 text-center">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full bg-emerald-grad text-[#05271c] shadow-sm">
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Application received</h2>
        <p className="mt-3 text-slate-600">
          Thank you{form.firstName ? `, ${form.firstName}` : ""} — your application for <strong className="text-slate-800">{jobTitle}</strong> is in.
        </p>
        <p className="mt-1.5 text-slate-600">
          A confirmation is on its way to <strong className="text-slate-800">{form.email}</strong>. If we move forward, our hiring team will reach out to set up a quick phone screen.
        </p>
        <div className="mx-auto mt-6 max-w-sm rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-left text-sm text-emerald-900">
          <span className="font-semibold">What&rsquo;s next:</span> we review every application, then reach out to schedule a short call. Keep an eye on your email and phone.
        </div>
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

      {/* Mailing address */}
      <div className="pt-1">
        <div className="text-sm font-semibold text-slate-700">Mailing address</div>
        <div className="mt-1.5 space-y-4">
          <input value={form.addressStreet} onChange={(e) => set("addressStreet", e.target.value)} autoComplete="address-line1" placeholder="Street address" className={inputCls} />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
            <input value={form.addressCity} onChange={(e) => set("addressCity", e.target.value)} autoComplete="address-level2" placeholder="City" className={`${inputCls} col-span-2 sm:col-span-3`} />
            <input value={form.addressState} onChange={(e) => set("addressState", e.target.value)} autoComplete="address-level1" placeholder="State" className={`${inputCls} sm:col-span-1`} />
            <input value={form.addressZip} onChange={(e) => set("addressZip", e.target.value)} autoComplete="postal-code" inputMode="numeric" placeholder="ZIP" className={`${inputCls} sm:col-span-2`} />
          </div>
        </div>
      </div>

      {/* Tell us about yourself — capped at 250 words */}
      <label className="block text-sm font-semibold text-slate-700">
        <span className="flex items-baseline justify-between gap-2">
          <span>Tell us about yourself</span>
          <span className={`text-xs font-normal ${aboutOver ? "text-red-600" : "text-slate-400"}`}>{aboutWords} / {ABOUT_WORD_CAP} words</span>
        </span>
        <textarea
          value={form.about}
          onChange={(e) => set("about", e.target.value)}
          rows={5}
          placeholder="A few sentences about your experience, what you're looking for, and why this role interests you."
          className={`${inputCls} resize-y leading-relaxed ${aboutOver ? "border-red-400 focus:border-red-500 focus:ring-red-500/30" : ""}`}
        />
        <span className="mt-1 block text-xs font-normal text-slate-400">Optional, but it helps us get to know you. {ABOUT_WORD_CAP}-word limit.</span>
      </label>

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
        disabled={busy || aboutOver}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-grad px-5 py-3.5 text-[15px] font-semibold text-[#05271c] shadow-sm shadow-emerald-700/20 transition hover:brightness-95 disabled:opacity-60"
      >
        {busy ? "Submitting…" : "Submit application"}
        {busy ? null : <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>}
      </button>
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-slate-500">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M5 11h14v9H5zM8 11V7a4 4 0 118 0v4" /></svg>
        Your information is private and used only for hiring.
      </p>
    </form>
  );
}
