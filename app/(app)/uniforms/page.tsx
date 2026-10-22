import { PageHeader, Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { UNIFORMS, UNIFORM_BY_KEY, uniformKeyForLevel, type UniformRole } from "@/lib/uniforms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Uniform Guidelines — CanopyOS" };

// Company → Uniform Guidelines. The CEO-approved customer-facing uniform standard
// for each field role, open to everyone. A viewer whose role has a uniform sees
// theirs called out first; the full set is below. Referenced from onboarding.
export default async function UniformGuidelinesPage() {
  const user = await requireUser();
  const myKey = uniformKeyForLevel(user.accessLevel);
  const mine = myKey ? UNIFORM_BY_KEY[myKey] : null;

  return (
    <>
      <PageHeader
        title="Uniform Guidelines"
        subtitle="The approved customer-facing uniform standard for each field role. Wear it on every customer-facing visit."
      />

      {mine ? (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-ink">Your uniform · {mine.label}</h2>
          <UniformCard uniform={mine} highlight />
        </section>
      ) : null}

      <h2 className="mb-2 text-sm font-semibold text-ink">{mine ? "All field roles" : "By role"}</h2>
      <div className="space-y-6">
        {UNIFORMS.filter((u) => u.key !== myKey).map((u) => (
          <UniformCard key={u.key} uniform={u} />
        ))}
      </div>
    </>
  );
}

function UniformCard({ uniform, highlight = false }: { uniform: UniformRole; highlight?: boolean }) {
  return (
    <Card className={`p-0 overflow-hidden ${highlight ? "ring-2 ring-brand-300" : ""}`}>
      <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_320px]">
        {/* The approved guideline sheet */}
        <a href={uniform.image} target="_blank" rel="noreferrer" className="block bg-[#f6f8f6]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={uniform.image}
            alt={`${uniform.label} uniform guidelines`}
            loading="lazy"
            className="mx-auto block h-auto w-full max-w-[560px]"
          />
        </a>
        {/* Text summary (accessible + printable) */}
        <div className="border-t border-line p-4 md:border-l md:border-t-0">
          <div className="text-sm font-semibold text-ink">{uniform.label}</div>
          <p className="mt-0.5 text-[12px] text-muted">{uniform.blurb}</p>
          <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Approved items</div>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
            {uniform.items.map((it, i) => <li key={i}>{it}</li>)}
          </ul>
          <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Approved footwear</div>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {uniform.footwear.map((f, i) => (
              <li key={i} className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">{f}</li>
            ))}
          </ul>
          <a href={uniform.image} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs font-medium text-brand-700 hover:underline">Open full-size guideline →</a>
        </div>
      </div>
    </Card>
  );
}
