import type { ReactNode } from "react";

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
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-line bg-card-grad shadow-sm ${className}`}
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

/** Reusable className strings for buttons so every screen matches. */
export const btn = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-grad px-4 py-2.5 text-sm font-medium text-[#05271c] shadow-sm shadow-brand-600/30 hover:brightness-[0.97] active:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed transition-[filter]",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-white/5 px-4 py-2.5 text-sm font-medium text-ink hover:bg-white/10 disabled:opacity-50 transition-colors",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors",
};
