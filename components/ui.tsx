import type { ReactNode, HTMLAttributes } from "react";
import { UNITS_OF_MEASURE } from "@/lib/uom";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div>
        <h1 className="text-2xl md:text-3xl font-light tracking-tight text-ink">
          {title}
        </h1>
        {subtitle ? (
          <p className="text-sm text-muted mt-1">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}

export function Card({
  children,
  className = "",
  ...rest
}: {
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`surface-light rounded-2xl border border-line bg-card-grad shadow-lg shadow-black/10 ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  icon,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <Card className="p-8 text-center">
      {icon ? (
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600">
          {icon}
        </div>
      ) : null}
      <div className="font-medium text-ink">{title}</div>
      {hint ? <div className="text-sm text-muted mt-1">{hint}</div> : null}
    </Card>
  );
}

/**
 * Controlled unit-of-measure dropdown. THE only way a unit is chosen anywhere in
 * the app — options come from the canonical UNITS_OF_MEASURE table, so the value
 * is always a canonical code and never free text.
 */
export function UnitSelect({
  value,
  onChange,
  className = "",
  id,
}: {
  value: string;
  onChange: (code: string) => void;
  className?: string;
  id?: string;
}) {
  const hasValue = UNITS_OF_MEASURE.some((u) => u.code === value);
  return (
    <select
      id={id}
      value={hasValue ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      className={className || "w-full rounded-lg border border-line px-3 py-2.5 text-sm bg-surface"}
    >
      {hasValue ? null : <option value="">— Select unit —</option>}
      {UNITS_OF_MEASURE.map((u) => (
        <option key={u.code} value={u.code}>
          {u.label} ({u.code})
        </option>
      ))}
    </select>
  );
}

/** Reusable className strings for buttons so every screen matches. */
export const btn = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-grad px-4 py-2.5 text-sm font-medium text-[#05271c] shadow-sm shadow-brand-600/30 hover:brightness-[0.97] active:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed transition-[filter]",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-xl border border-[#cfe0d6] bg-white px-4 py-2.5 text-sm font-medium text-[#0e1b15] hover:bg-[#eef5f0] disabled:opacity-50 transition-colors",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors",
};
