import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Help — Canopy OS" };

export default async function HelpPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="Help"
        subtitle="How the two everyday workflows work."
      />

      <div className="space-y-4">
        <Workflow
          badge="OUT"
          badgeClass="bg-blue-100 text-blue-700"
          title="Check-Out — giving stock to a technician"
          steps={[
            "Open Check-Out. Your warehouse is pre-selected — change it if you're pulling from another location.",
            "Pick the technician the products are going to.",
            "Add products by typing to search, or tap Scan to read a barcode with the camera.",
            "Set the quantity for each line. The current on-hand shows next to each product, and a red warning appears if you'd pull more than you have (you can override).",
            "Tap Confirm check-out. Stock moves onto the truck and you get a receipt.",
          ]}
          href="/check-out"
          cta="Go to Check-Out"
        />

        <Workflow
          badge="IN"
          badgeClass="bg-brand-100 text-brand-700"
          title="Check-In — receiving a distributor invoice"
          steps={[
            "Open Check-In and upload the distributor invoice (PDF or a photo).",
            "Tap Read invoice. The reader pulls out each line — product, quantity, unit, and price.",
            "Review the lines. Each is matched to a product automatically; fix any match, or create a new product for anything unrecognized.",
            "Check the warehouse, distributor, invoice number, and date at the top.",
            "Tap Confirm check-in. Stock is added, the invoice is saved, and the anomaly checks run automatically.",
          ]}
          href="/check-in"
          cta="Go to Check-In"
        />

        <Card className="p-4">
          <h2 className="font-semibold text-ink mb-2">Fixing mistakes</h2>
          <p className="text-sm text-muted">
            Use <Link href="/reconcile" className="text-brand-700 font-medium hover:underline">Reconcile</Link>{" "}
            to find any movement and reverse it, correct the quantity, or add a
            manual adjustment with a reason. Nothing is ever deleted — every
            change is recorded with who made it and when.
          </p>
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold text-ink mb-2">Alerts</h2>
          <p className="text-sm text-muted">
            <Link href="/alerts" className="text-brand-700 font-medium hover:underline">Alerts</Link>{" "}
            flags price jumps, likely duplicate invoices, negative stock, and
            unusually large check-outs. Acknowledge the ones you&rsquo;ve seen and
            dismiss the ones that don&rsquo;t matter.
          </p>
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold text-ink mb-2">Install on your phone</h2>
          <div className="text-sm text-muted space-y-2">
            <p>
              <span className="font-medium text-ink">iPhone / iPad (Safari):</span>{" "}
              tap the Share button, then <em>Add to Home Screen</em>. The app opens
              full-screen from your home screen like a normal app.
            </p>
            <p>
              <span className="font-medium text-ink">Android (Chrome):</span> tap
              the ⋮ menu, then <em>Install app</em> (or <em>Add to Home screen</em>).
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}

function Workflow({
  badge,
  badgeClass,
  title,
  steps,
  href,
  cta,
}: {
  badge: string;
  badgeClass: string;
  title: string;
  steps: string[];
  href: string;
  cta: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className={`rounded px-2 py-0.5 text-xs font-bold ${badgeClass}`}>
          {badge}
        </span>
        <h2 className="font-semibold text-ink">{title}</h2>
      </div>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3 text-sm text-muted">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
      <Link
        href={href}
        className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline"
      >
        {cta} →
      </Link>
    </Card>
  );
}
