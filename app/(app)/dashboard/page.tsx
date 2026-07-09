import { Card, PageHeader } from "@/components/ui";

const WAREHOUSES = ["Vero Beach (HQ)", "Stuart", "Orlando"];

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Warehouse inventory at a glance."
      />

      <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 mb-6">
        <p className="text-sm text-brand-800">
          <span className="font-semibold">Welcome to Clements Inventory.</span>{" "}
          This is the sandbox scaffold. Live purchased / dispersed / on-hand
          numbers, filters, and the alerts panel land with the data model and
          dashboard prompts.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {WAREHOUSES.map((name) => (
          <Card key={name} className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted">
              Warehouse
            </div>
            <div className="mt-1 text-lg font-semibold text-ink">{name}</div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                { label: "Purchased", value: "—" },
                { label: "Dispersed", value: "—" },
                { label: "On-hand", value: "—" },
              ].map((s) => (
                <div key={s.label} className="rounded-lg bg-canvas py-2">
                  <div className="text-base font-semibold text-ink">
                    {s.value}
                  </div>
                  <div className="text-[10px] uppercase text-muted">
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
