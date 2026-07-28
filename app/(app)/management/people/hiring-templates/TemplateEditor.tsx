"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { RESPONSE_TYPE_LABELS, type ResponseType } from "@/lib/ats-config";

export type EditorQuestion = { id?: string; section: string; text: string; responseType: ResponseType; required: boolean };
type RoleOption = { key: string; label: string };
type BankItem = { id: string; category: string; roleHint: string | null; text: string; responseType: string };

const RESPONSE_TYPES: ResponseType[] = ["rating_1_5", "yes_no", "text", "basics_yesno_unsure"];

export default function TemplateEditor({
  mode,
  templateId,
  kind,
  initial,
  roleOptions,
  bank,
}: {
  mode: "create" | "edit";
  templateId?: string;
  kind: "interview" | "screening";
  initial: { name: string; description: string; roleKeys: string[]; isDefault: boolean; questions: EditorQuestion[] };
  roleOptions: RoleOption[];
  bank: BankItem[];
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [roleKeys, setRoleKeys] = useState<string[]>(initial.roleKeys);
  const [isDefault, setIsDefault] = useState(initial.isDefault);
  const [questions, setQuestions] = useState<EditorQuestion[]>(initial.questions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showBank, setShowBank] = useState(false);
  const [showAi, setShowAi] = useState(false);

  const toggleRole = (k: string) => setRoleKeys((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const addQuestion = (q: EditorQuestion) => setQuestions((s) => [...s, q]);
  const updateQuestion = (i: number, patch: Partial<EditorQuestion>) => setQuestions((s) => s.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  const removeQuestion = (i: number) => setQuestions((s) => s.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => setQuestions((s) => {
    const j = i + dir;
    if (j < 0 || j >= s.length) return s;
    const next = [...s];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  async function save() {
    if (!name.trim()) return setError("A template name is required.");
    if (questions.length === 0) return setError("Add at least one question.");
    setBusy(true); setError(null); setMsg(null);
    const payload = {
      action: mode === "create" ? "template.create" : "template.update",
      id: templateId,
      kind,
      name: name.trim(),
      description,
      roleKeys,
      isDefault,
      questions: questions.map((q) => ({ id: q.id, section: q.section, text: q.text, responseType: q.responseType, required: q.required })),
    };
    const res = await fetch("/api/hiring/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not save the template.");
    if (mode === "create" && data.id) { router.push(`/management/people/hiring-templates/${data.id}`); return; }
    setMsg("Saved."); router.refresh();
  }

  return (
    <div className="space-y-5 max-w-3xl pb-8">
      <Card className="p-4 space-y-3">
        <label className="block text-sm font-medium">Template name
          <input data-testid="tpl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "interview" ? "e.g. Pest Technician interview" : "e.g. Pest Technician screening call"} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm font-medium">Description <span className="text-xs font-normal text-muted">(optional)</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What this template is for…" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </label>
        <div>
          <div className="text-sm font-medium mb-1">Assign to roles / worker types</div>
          <div className="flex flex-wrap gap-1.5">
            {roleOptions.map((r) => {
              const sel = roleKeys.includes(r.key);
              return (
                <button key={r.key} type="button" onClick={() => toggleRole(r.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${sel ? "bg-emerald-grad text-[#05271c] shadow" : "border border-line bg-white text-ink hover:bg-black/[0.03]"}`}>
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="h-4 w-4" />
          <span>Use as the <strong>default</strong> {kind} template (fallback for roles without a specific match)</span>
        </label>
      </Card>

      {/* Question list */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Questions <span className="text-xs font-normal text-muted">({questions.length})</span></h2>
        </div>
        {questions.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted">No questions yet — add from the bank, write a custom one, or draft with AI below.</Card>
        ) : (
          <div className="space-y-2">
            {questions.map((q, i) => (
              <Card key={i} className="p-3" data-testid="tpl-question">
                <div className="flex items-start gap-2">
                  <div className="flex flex-col gap-0.5 pt-0.5">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-muted hover:text-ink disabled:opacity-30" title="Move up" data-testid="q-up">▲</button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === questions.length - 1} className="text-muted hover:text-ink disabled:opacity-30" title="Move down" data-testid="q-down">▼</button>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <input value={q.section} onChange={(e) => updateQuestion(i, { section: e.target.value })} placeholder="Section / competency (optional)" className="w-full rounded-md border border-line px-2 py-1 text-xs" />
                    <textarea value={q.text} onChange={(e) => updateQuestion(i, { text: e.target.value })} rows={2} placeholder="Question text" className="w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                    <div className="flex flex-wrap items-center gap-2">
                      <select value={q.responseType} onChange={(e) => updateQuestion(i, { responseType: e.target.value as ResponseType })} className="rounded-md border border-line px-2 py-1 text-xs bg-white">
                        {RESPONSE_TYPES.map((rt) => <option key={rt} value={rt}>{RESPONSE_TYPE_LABELS[rt]}</option>)}
                      </select>
                      <label className="flex items-center gap-1 text-xs text-muted">
                        <input type="checkbox" checked={q.required} onChange={(e) => updateQuestion(i, { required: e.target.checked })} /> Required
                      </label>
                      <button type="button" onClick={() => removeQuestion(i)} className="ml-auto text-xs font-medium text-red-600 hover:underline">Remove</button>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Add-question controls */}
      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold text-ink">Add a question</div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setShowBank(true)} className={btn.secondary}>From the off-the-shelf bank</button>
          <button type="button" onClick={() => addQuestion({ section: "", text: "", responseType: kind === "interview" ? "rating_1_5" : "text", required: false })} className={btn.secondary}>Custom question</button>
          <button type="button" onClick={() => setShowAi(true)} className={btn.primary} data-testid="ai-open">✨ Draft with AI</button>
        </div>
        <p className="text-xs text-muted">Not sure how to word it? Let the AI assistant draft it for you — it writes best-practice, role-grounded, legally-mindful questions.</p>
      </Card>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {msg ? <p className="text-sm text-emerald-700">{msg}</p> : null}

      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className={btn.primary} data-testid="tpl-save">{busy ? "Saving…" : mode === "create" ? "Create template" : "Save changes"}</button>
        <button onClick={() => router.push("/management/people/hiring-templates")} className={btn.secondary}>Back to library</button>
      </div>

      {showBank ? <BankModal kind={kind} bank={bank} onClose={() => setShowBank(false)} onInsert={(q) => addQuestion(q)} /> : null}
      {showAi ? <AiModal kind={kind} roleOptions={roleOptions} defaultRole={roleKeys[0] ?? "any"} onClose={() => setShowAi(false)} onInsert={(q) => addQuestion(q)} /> : null}
    </div>
  );
}

function BankModal({ kind, bank, onClose, onInsert }: { kind: string; bank: BankItem[]; onClose: () => void; onInsert: (q: EditorQuestion) => void }) {
  const categories = useMemo(() => ["all", ...Array.from(new Set(bank.map((b) => b.category)))], [bank]);
  const roles = useMemo(() => ["all", ...Array.from(new Set(bank.map((b) => b.roleHint).filter((x): x is string => !!x)))], [bank]);
  const [cat, setCat] = useState("all");
  const [role, setRole] = useState("all");
  const filtered = bank.filter((b) => (cat === "all" || b.category === cat) && (role === "all" || b.roleHint === role));

  return (
    <Modal title={`Off-the-shelf ${kind} bank`} onClose={onClose}>
      <div className="flex flex-wrap gap-2">
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="rounded-lg border border-line px-2 py-1.5 text-xs bg-white">
          {categories.map((c) => <option key={c} value={c}>{c === "all" ? "All categories" : c}</option>)}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-lg border border-line px-2 py-1.5 text-xs bg-white">
          {roles.map((r) => <option key={r} value={r}>{r === "all" ? "All roles" : r}</option>)}
        </select>
      </div>
      <div className="mt-3 space-y-2">
        {filtered.length === 0 ? <p className="text-sm text-muted">No matching questions.</p> : filtered.map((b) => (
          <div key={b.id} className="flex items-start gap-2 rounded-lg border border-line p-2.5" data-testid="bank-item">
            <div className="min-w-0 flex-1">
              <div className="text-sm text-ink">{b.text}</div>
              <div className="mt-0.5 text-[11px] text-muted">{b.category} · {RESPONSE_TYPE_LABELS[b.responseType as ResponseType] ?? b.responseType}{b.roleHint ? ` · ${b.roleHint}` : ""}</div>
            </div>
            <button type="button" onClick={() => onInsert({ section: b.category, text: b.text, responseType: (b.responseType as ResponseType), required: false })} className="shrink-0 text-xs font-medium text-brand-700 hover:underline" data-testid="bank-insert">Insert</button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function AiModal({ kind, roleOptions, defaultRole, onClose, onInsert }: { kind: "interview" | "screening"; roleOptions: RoleOption[]; defaultRole: string; onClose: () => void; onInsert: (q: EditorQuestion) => void }) {
  const [role, setRole] = useState(defaultRole);
  const [intent, setIntent] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<EditorQuestion[]>([]);

  async function run() {
    setBusy(true); setMessage(null); setSuggestions([]);
    const res = await fetch("/api/hiring/ai-questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, role, intent, draft }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (Array.isArray(data.suggestions) && data.suggestions.length) {
      setSuggestions(data.suggestions.map((s: { section?: string; text: string; responseType: string }) => ({ section: s.section ?? "General", text: s.text, responseType: (s.responseType as ResponseType), required: false })));
    }
    if (data.message) setMessage(data.message);
    else if (!data.suggestions?.length) setMessage("No suggestions returned.");
  }

  return (
    <Modal title="Draft with AI" onClose={onClose}>
      <p className="text-xs text-muted">Describe the role and what you want to assess (or paste a rough question). The assistant drafts polished, role-grounded, legally-mindful questions you can insert and edit.</p>
      <label className="mt-3 block text-sm font-medium">Role
        <select value={role} onChange={(e) => setRole(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
          {roleOptions.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
      </label>
      <label className="mt-2 block text-sm font-medium">What do you want to assess?
        <textarea data-testid="ai-intent" value={intent} onChange={(e) => setIntent(e.target.value)} rows={2} placeholder="e.g. how they handle an upset customer at the door" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
      </label>
      <label className="mt-2 block text-sm font-medium">Or refine a rough question <span className="text-xs font-normal text-muted">(optional)</span>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder="Paste a draft to polish…" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
      </label>
      <button onClick={run} disabled={busy} className={`${btn.primary} mt-3`} data-testid="ai-run">{busy ? "Drafting…" : "Draft with AI"}</button>

      {message ? <p className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800" data-testid="ai-message">{message}</p> : null}
      {suggestions.length ? (
        <div className="mt-3 space-y-2">
          {suggestions.map((s, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-line p-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-ink">{s.text}</div>
                <div className="mt-0.5 text-[11px] text-muted">{s.section} · {RESPONSE_TYPE_LABELS[s.responseType]}</div>
              </div>
              <button type="button" onClick={() => onInsert(s)} className="shrink-0 text-xs font-medium text-brand-700 hover:underline">Insert</button>
            </div>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <Card className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 space-y-1 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-ink text-xl leading-none">×</button>
        </div>
        {children}
        <div className="pt-3">
          <button onClick={onClose} className={btn.secondary}>Done</button>
        </div>
      </Card>
    </div>
  );
}
