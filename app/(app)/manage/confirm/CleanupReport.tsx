import { Card } from "@/components/ui";
import type { CatalogCleanupReport, CatalogDecisionsReport } from "@/lib/catalog-cleanup";
import { PENDING_FULL_NAMES } from "@/lib/catalog-names";

// Product Review → the 11/10 approved-catalog cleanup: what it changed, what still
// needs a decision, and the full names drafted for confirmation. Read-only.
const fmtStock = (s: { warehouse: string; qty: number }[]) => s.map((x) => `${x.warehouse} ${x.qty}`).join(" · ");

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <details className="border-t border-line py-2">
      <summary className="cursor-pointer text-sm">
        {title} <span className="text-muted">({count})</span>
      </summary>
      <div className="mt-2 max-h-72 overflow-y-auto text-xs">{children}</div>
    </details>
  );
}

export default function CleanupReport({ report, decisions }: { report: CatalogCleanupReport; decisions?: CatalogDecisionsReport | null }) {
  const date = new Date(report.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  return (
    <Card className="mb-4 p-4">
      <div className="mb-2">
        <h2 className="text-base">Approved catalog cleanup · {date}</h2>
        <p className="text-sm text-muted">
          Undid the 11/5 bulk approval. On-hand was not changed — merged duplicates carry their stock onto the catalog product.
        </p>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div><div className="text-lg">{report.renamed.length}</div><div className="text-muted">renamed to full description</div></div>
        <div><div className="text-lg">{report.merged.length}</div><div className="text-muted">duplicates merged</div></div>
        <div><div className="text-lg">{report.deactivated.length}</div><div className="text-muted">removed (not on catalog, no stock)</div></div>
        <div><div className="text-lg">{report.offCatalogWithStock.length}</div><div className="text-muted">off-catalog with stock — decide in Off-catalog</div></div>
      </div>

      {decisions ? (
        <Section
          title="Julie's catalog decisions applied"
          count={decisions.renamed.length + decisions.unitsChanged.length + decisions.merged.length + decisions.discontinued.length}
        >
          <ul className="space-y-1">
            {decisions.merged.map((r) => (
              <li key={`m-${r.from}`}>Merged {r.from} <span className="text-muted">→</span> {r.into}{r.stock.length ? <span className="text-muted"> (moved: {fmtStock(r.stock)})</span> : null}</li>
            ))}
            {decisions.renamed.map((r) => <li key={`r-${r.from}`}>{r.from} <span className="text-muted">→</span> {r.to}</li>)}
            {decisions.unitsChanged.map((r) => <li key={`u-${r.name}`}>{r.name}: unit {r.from} <span className="text-muted">→</span> {r.to}</li>)}
            {decisions.discontinued.map((r) => (
              <li key={`d-${r.name}`}>Discontinued {r.name}{r.removed.length ? <span className="text-muted"> (on-hand removed: {fmtStock(r.removed)})</span> : <span className="text-muted"> (no stock)</span>}</li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title="Off-catalog with stock (need a decision)" count={report.offCatalogWithStock.length}>
        <ul className="space-y-1">{report.offCatalogWithStock.map((r) => <li key={r.name}>{r.name} <span className="text-muted">— {fmtStock(r.stock)}</span></li>)}</ul>
      </Section>
      <Section title="Full names awaiting your confirmation" count={PENDING_FULL_NAMES.length}>
        <ul className="space-y-1">
          {PENDING_FULL_NAMES.map((r) => (
            <li key={r.short}>
              {r.short} <span className="text-muted">→</span> {r.mergeInto ? <>merge into the catalog product for “{r.mergeInto}”</> : r.draft}
              {r.note ? <span className="text-muted"> — {r.note}</span> : null}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Renamed" count={report.renamed.length}>
        <ul className="space-y-1">{report.renamed.map((r) => <li key={r.from}>{r.from} <span className="text-muted">→</span> {r.to}</li>)}</ul>
      </Section>
      <Section title="Merged into a catalog product" count={report.merged.length}>
        <ul className="space-y-1">
          {report.merged.map((r) => (
            <li key={r.from}>{r.from} <span className="text-muted">→</span> {r.into}{r.stock.length ? <span className="text-muted"> (moved: {fmtStock(r.stock)})</span> : null}</li>
          ))}
        </ul>
      </Section>
      <Section title="Removed from the catalog (no stock)" count={report.deactivated.length}>
        <p className="mb-1 text-muted">Deactivated, not deleted. To bring one back, open it in Catalog Admin and tick “On approved catalog”.</p>
        <ul className="columns-1 sm:columns-2">{report.deactivated.map((n) => <li key={n}>{n}</li>)}</ul>
      </Section>
      <Section title="Kept — approved in-app by a super admin" count={report.keptApprovedInApp.length}>
        <ul>{report.keptApprovedInApp.map((n) => <li key={n}>{n}</li>)}</ul>
      </Section>
    </Card>
  );
}
