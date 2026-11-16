import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, branchLocked } from "@/lib/auth";
import { DIVISION_LABELS, type Division } from "@/lib/constants";
import { BRANCHES } from "@/lib/management";
import {
  ensureCancellationsSeeded,
  listCancellationMonths,
  loadCancellations,
  loadUnmatchedSetups,
  setupsLoadedFor,
  mbrAttritionFor,
  cancellationBudgetByBranch,
  cancellationBudgetYear,
} from "@/lib/cancellations";
import { UploadCard } from "./CancelCharts";
import { CancellationDashboard, MonthSelect, type DashRow, type BranchCard, type YearPoint } from "./Dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cancellation Center — CanopyOS" };

// Cancellation Center (COO request 2026-11-16; redesigned after the UI audit the
// same day). Branch is the primary lens: a branch strip (with budget pace) picks
// the scope, insight cards and one drill-down heat map (branches → routes ×
// reason / division / service / tenure / value / city) filter the account list
// instantly on the client. Sources: PestPac Gain & Loss Report (value) + Service
// Setup List (cancel reasons), one month each. Branch managers are pinned to their
// own branch; admins upload. Gated by the `cancellations` access item.

const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};
const mdy = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return `${m}/${d}/${y}`; };
const lastDayOf = (key: string) => { const [y, m] = key.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

const valueBand = (v: number) => (v < 300 ? "lt300" : v < 600 ? "300" : v < 1000 ? "600" : "1000");
const tenureBand = (start: string | null, endIso: string) => {
  if (!start) return "";
  const y = (Date.parse(`${endIso}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / (365.25 * 86_400_000);
  return y < 1 ? "lt1" : y < 2 ? "1-2" : y < 5 ? "2-5" : "5+";
};

export default async function CancellationCenterPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  await ensureCancellationsSeeded();

  const isAdmin = user.role === "admin";
  const locked = branchLocked(user) ? user.branch : null;
  const months = await listCancellationMonths();

  if (months.length === 0) {
    return (
      <>
        <PageHeader title="Cancellation Center" subtitle="Cancellations by branch, division, service, route, reason and city" />
        <EmptyState title="No cancellation reports yet" hint={isAdmin ? "Upload the PestPac Gain & Loss Report below to get started." : "An admin uploads the monthly PestPac reports here."} />
        {isAdmin ? <Card className="mt-4"><UploadCard /></Card> : null}
      </>
    );
  }

  const month = months.find((m) => m.periodKey === sp.m) ?? months[0];
  const isMtd = Number(month.endDate.slice(8, 10)) < lastDayOf(month.periodKey);
  const year = Number(month.periodKey.slice(0, 4));
  const monthNo = Number(month.periodKey.slice(5, 7));

  const [records, reasons, budgets, mbrMap, extras] = await Promise.all([
    loadCancellations([month.periodKey], locked),
    setupsLoadedFor(month.periodKey),
    cancellationBudgetByBranch(month.periodKey),
    mbrAttritionFor(month.periodKey),
    loadUnmatchedSetups(month.periodKey, locked),
  ]);

  const rows: DashRow[] = records.map((r) => ({
    account: r.account, customer: r.customer, city: r.city, zip: r.zip, branch: r.branch, route: r.route, tech: r.techName ?? "",
    serviceCode: r.serviceCode, division: DIVISION_LABELS[r.division as Division] ?? r.division,
    reason: reasons ? r.reason ?? "" : "", since: r.serviceStart ?? "", tenure: reasons ? tenureBand(r.serviceStart, month.endDate) : "",
    value: valueBand(r.lossValue), lossCount: r.lossCount, lossValue: r.lossValue,
  }));

  // Budget (monthly targets) and budget-to-date (pro-rated while the month is open).
  const frac = Math.min(1, Number(month.endDate.slice(8, 10)) / lastDayOf(month.periodKey));
  const visible = locked ? BRANCHES.filter((b) => b.key === locked) : BRANCHES;
  const cards: BranchCard[] = visible.map((b) => {
    const budget = budgets.get(b.key) ?? null;
    return { key: b.key, label: b.label, budget, toDate: budget != null ? budget * frac : null };
  });
  if (!locked) {
    const all = cards.every((c) => c.budget != null) ? cards.reduce((s, c) => s + (c.budget ?? 0), 0) : null;
    cards.unshift({ key: "all", label: "All branches", budget: all, toDate: all != null ? all * frac : null });
  }

  // Year-by-month actual vs budget for each scope the viewer can pick.
  const scopes = locked ? [locked] : ["all", ...BRANCHES.map((b) => b.key)];
  const yearByScope: Record<string, YearPoint[]> = {};
  for (const sc of scopes) {
    const pts = await cancellationBudgetYear(sc === "all" ? "company" : sc, year);
    yearByScope[sc] = pts
      .filter((p) => p.actual != null && p.m <= monthNo)
      .map((p) => ({
        label: p.label, actual: p.actual ?? 0, budget: p.budget, fromUpload: p.source === "upload",
        partial: p.source === "upload" && p.throughDay != null && p.throughDay < lastDayOf(`${year}-${String(p.m).padStart(2, "0")}`),
      }));
  }
  const mbr: Record<string, number | null> = {};
  for (const [k, v] of mbrMap) mbr[k] = v;

  const initial: Record<string, string> = {};
  for (const k of ["branch", "route", "reason", "division", "service", "tenure", "value", "city", "multi", "dim", "metric"]) if (sp[k]) initial[k] = sp[k]!;
  if (initial.branch && !BRANCHES.some((b) => b.key === initial.branch)) delete initial.branch;

  const windowLabel = `${mdy(month.startDate)}–${mdy(month.endDate)}${isMtd ? " · month to date" : ""}`;

  return (
    <>
      <PageHeader
        title="Cancellation Center"
        subtitle={`${monthLabel(month.periodKey)} · ${windowLabel}${locked ? ` · ${BRANCHES.find((b) => b.key === locked)?.label}` : ""}`}
        actions={<MonthSelect months={months.map((m) => ({ value: m.periodKey, label: monthLabel(m.periodKey) }))} value={month.periodKey} />}
      />
      <CancellationDashboard
        rows={rows}
        branches={cards}
        lockedBranch={locked}
        reasonsLoaded={!!reasons}
        initial={initial}
        periodLabel={`Sources: PestPac Gain & Loss Report (${month.fileName}, loaded ${month.createdAt.toLocaleDateString("en-US", { timeZone: "America/New_York" })}${month.uploadedBy ? ` by ${month.uploadedBy}` : ""})${reasons ? ` and Service Setup List for cancel reasons (${reasons.fileName}, cancel dates through ${mdy(reasons.endDate)})` : " — no Service Setup List yet, so no reasons"}. Lost value is the report's Loss Value; technician is the route holder. Neither report carries the date of each cancellation`}
        isMtd={isMtd}
        throughLabel={mdy(month.endDate).slice(0, -5)}
        fileLabel={month.periodKey}
        yearByScope={yearByScope}
        mbr={mbr}
        extras={extras.map((x) => ({ branch: x.branch, account: x.account, customer: x.customer, serviceCode: x.serviceCode, chargeType: x.chargeType, techCode: x.techCode, reason: x.reason, total: x.total }))}
        year={year}
      >
        {isAdmin ? (
          <details className="rounded-xl border border-line bg-white">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-ink">Upload a month <span className="font-normal text-muted">· Gain &amp; Loss Report or Service Setup List</span></summary>
            <div className="border-t border-line"><UploadCard /></div>
          </details>
        ) : null}
      </CancellationDashboard>
    </>
  );
}
