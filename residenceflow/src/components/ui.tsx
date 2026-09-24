import Link from "next/link";
import type { ReactNode } from "react";

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export const btn = {
  base: "inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:opacity-50 disabled:cursor-not-allowed",
  primary: "bg-[var(--brand)] text-white hover:brightness-110",
  secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
  danger: "bg-red-700 text-white hover:bg-red-800",
  ghost: "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800",
};

export function buttonClass(variant: keyof Omit<typeof btn, "base"> = "primary", extra?: string) {
  return cn(btn.base, btn[variant], extra);
}

export function LinkButton({ href, children, variant = "primary", className }: { href: string; children: ReactNode; variant?: keyof Omit<typeof btn, "base">; className?: string }) {
  return (
    <Link href={href} className={buttonClass(variant, className)}>
      {children}
    </Link>
  );
}

export function PageHeader({ title, description, actions, breadcrumbs }: { title: string; description?: string; actions?: ReactNode; breadcrumbs?: { label: string; href?: string }[] }) {
  return (
    <div className="mb-6">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 text-xs text-slate-500 dark:text-slate-400">
          <ol className="flex flex-wrap items-center gap-1">
            {breadcrumbs.map((b, i) => (
              <li key={i} className="flex items-center gap-1">
                {b.href ? <Link className="hover:underline" href={b.href}>{b.label}</Link> : <span aria-current="page">{b.label}</span>}
                {i < breadcrumbs.length - 1 && <span aria-hidden>/</span>}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h1>
          {description && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, children, className, actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cn("rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900", className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone = "default", href }: { label: string; value: ReactNode; hint?: string; tone?: "default" | "good" | "warn" | "bad"; href?: string }) {
  const toneCls = { default: "", good: "text-green-700 dark:text-green-400", warn: "text-amber-700 dark:text-amber-400", bad: "text-red-700 dark:text-red-400" }[tone];
  const inner = (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold text-slate-900 dark:text-white", toneCls)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{inner}</Link> : inner;
}

const BADGE_TONES: Record<string, string> = {
  green: "bg-green-100 text-green-800 ring-green-600/30 dark:bg-green-900/40 dark:text-green-300",
  amber: "bg-amber-100 text-amber-800 ring-amber-600/30 dark:bg-amber-900/40 dark:text-amber-300",
  red: "bg-red-100 text-red-800 ring-red-600/30 dark:bg-red-900/40 dark:text-red-300",
  blue: "bg-blue-100 text-blue-800 ring-blue-600/30 dark:bg-blue-900/40 dark:text-blue-300",
  slate: "bg-slate-100 text-slate-700 ring-slate-500/30 dark:bg-slate-800 dark:text-slate-300",
  violet: "bg-violet-100 text-violet-800 ring-violet-600/30 dark:bg-violet-900/40 dark:text-violet-300",
};

const STATUS_TONE: Record<string, keyof typeof BADGE_TONES> = {
  ACTIVE: "green", PAID: "green", CONFIRMED: "green", OCCUPIED: "green", CLOSED: "green", COMPLETED: "green", APPROVED: "green", HELD: "green", RESOLVED: "green", SUCCESS: "green", REFUNDED: "slate",
  VACANT: "blue", ISSUED: "blue", SUBMITTED: "blue", SCHEDULED: "blue", DRAFT: "slate", INVITED: "blue", TRIAGED: "blue", ASSIGNED: "violet", IN_PROGRESS: "violet", RESERVED: "violet",
  PARTIALLY_PAID: "amber", PENDING: "amber", PENDING_APPROVAL: "amber", NOTICE_GIVEN: "amber", WAITING_PARTS: "amber", WAITING_TENANT: "amber", UNDER_MAINTENANCE: "amber", UNDER_INSPECTION: "amber", RENOVATION: "amber", TENANT_CONFIRMATION: "amber", OPEN: "amber", HIGH: "amber", MEDIUM: "amber", REOPENED: "amber",
  OVERDUE: "red", REJECTED: "red", REVERSED: "red", VOID: "red", SUSPENDED: "red", TERMINATED: "red", CANCELLED: "slate", EXPIRED: "slate", ARCHIVED: "slate", INACTIVE: "slate", UNAVAILABLE: "slate", URGENT: "red", CRITICAL: "red", FAILURE: "red", DENIED: "red", CREDITED: "slate", RENEWED: "slate", LOW: "slate", NORMAL: "slate",
};

/** Status badge: text label + colour (never colour alone). */
export function Badge({ children, tone, status }: { children?: ReactNode; tone?: keyof typeof BADGE_TONES; status?: string }) {
  const t = tone ?? (status ? STATUS_TONE[status] : undefined) ?? "slate";
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", BADGE_TONES[t])}>
      {children ?? (status ? humanize(status) : "")}
    </span>
  );
}

export function humanize(s: string) {
  return s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th scope="col" className={cn("px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800", className)}>{children}</th>;
}

export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cn("px-3 py-2 align-top text-slate-800 dark:text-slate-200", className)}>{children}</td>;
}

export function Tr({ children }: { children: ReactNode }) {
  return <tr className="divide-x-0 hover:bg-slate-50 dark:hover:bg-slate-800/50">{children}</tr>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center dark:border-slate-600">
      <p className="font-medium text-slate-800 dark:text-slate-100">{title}</p>
      {description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export const inputClass =
  "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30 dark:border-slate-600 dark:bg-slate-800 dark:text-white";

export function Field({ label, name, children, hint, required, className }: { label: string; name: string; children?: ReactNode; hint?: string; required?: boolean; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={name} className="block text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
        {required && <span className="text-red-600" aria-hidden> *</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; hint?: string; wrapperClassName?: string };

export function Input({ label, name, hint, required, wrapperClassName, className, ...rest }: InputProps) {
  return (
    <Field label={label} name={name} hint={hint} required={required} className={wrapperClassName}>
      <input id={name} name={name} required={required} className={cn(inputClass, className)} {...rest} />
    </Field>
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  hint?: string;
  placeholder?: string;
  wrapperClassName?: string;
};

export function Select({ label, name, options, hint, required, placeholder, wrapperClassName, className, ...rest }: SelectProps) {
  return (
    <Field label={label} name={name} hint={hint} required={required} className={wrapperClassName}>
      <select id={name} name={name} required={required} className={cn(inputClass, className)} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
}

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; name: string; hint?: string; wrapperClassName?: string };

export function Textarea({ label, name, hint, required, wrapperClassName, className, ...rest }: TextareaProps) {
  return (
    <Field label={label} name={name} hint={hint} required={required} className={wrapperClassName}>
      <textarea id={name} name={name} required={required} rows={3} className={cn(inputClass, className)} {...rest} />
    </Field>
  );
}

export function Checkbox({ label, name, defaultChecked, value = "on" }: { label: string; name: string; defaultChecked?: boolean; value?: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="h-4 w-4 rounded border-slate-300 accent-[var(--brand)]" />
      {label}
    </label>
  );
}

export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((it, i) => (
        <div key={i}>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{it.label}</dt>
          <dd className="mt-0.5 text-sm text-slate-900 dark:text-slate-100">{it.value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Server-side pagination links preserving other query params. */
export function Pagination({ page, pageSize, total, basePath, params }: { page: number; pageSize: number; total: number; basePath: string; params?: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="mt-3 text-xs text-slate-500">{total} record(s)</p>;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v) q.set(k, v);
    q.set("page", String(p));
    return `${basePath}?${q.toString()}`;
  };
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
      <span>{total} record(s) · page {page} / {pages}</span>
      <div className="flex gap-2">
        {page > 1 && <Link className={buttonClass("secondary")} href={href(page - 1)}>‹</Link>}
        {page < pages && <Link className={buttonClass("secondary")} href={href(page + 1)}>›</Link>}
      </div>
    </div>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "success"; children: ReactNode }) {
  const cls = {
    info: "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200",
    warn: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
    error: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
    success: "border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200",
  }[tone];
  return <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-md border px-3 py-2 text-sm", cls)}>{children}</div>;
}

/** Simple GET filter bar (search + selects) that keeps server-side filtering. */
export function FilterBar({ children, action }: { children: ReactNode; action: string }) {
  return (
    <form method="get" action={action} className="mb-4 flex flex-wrap items-end gap-3">
      {children}
      <button type="submit" className={buttonClass("secondary")}>Filter</button>
    </form>
  );
}

export function parsePage(v: string | string[] | undefined) {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export function str(v: string | string[] | undefined) {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}
