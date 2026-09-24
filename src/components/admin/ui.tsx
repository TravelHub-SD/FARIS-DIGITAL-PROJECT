import { Link } from "@/components/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

// Small server-rendered building blocks shared by the admin pages.

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
  testId,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      className={cn(
        "grid gap-4 rounded-xl border bg-card p-4 sm:p-5",
        className,
      )}
      data-testid={testId}
    >
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="grid gap-1">
            {title && <h2 className="text-lg font-bold">{title}</h2>}
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid content-start gap-2", className)}>
      <label htmlFor={htmlFor} className="text-sm leading-none font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function CheckboxField({
  name,
  label,
  defaultChecked,
  id,
}: {
  name: string;
  label: React.ReactNode;
  defaultChecked?: boolean;
  id?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
      <input
        type="checkbox"
        id={id ?? name}
        name={name}
        defaultChecked={defaultChecked}
        className="size-4 accent-primary"
      />
      {label}
    </label>
  );
}

const TONES = {
  neutral: "border-border bg-muted text-foreground",
  info: "border-primary/30 bg-primary/10 text-primary",
  warning: "border-highlight/50 bg-highlight/15 text-foreground",
  success:
    "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
} as const;

export function Badge({
  tone = "neutral",
  children,
  ...rest
}: {
  tone?: keyof typeof TONES;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

export const ORDER_STATUS_TONE = {
  new: "warning",
  processing: "info",
  completed: "success",
  cancelled: "neutral",
} as const;

export function Pagination({
  page,
  pages,
  href,
  labels,
}: {
  page: number;
  pages: number;
  href: (page: number) => string;
  labels: { previous: string; next: string; page: string };
}) {
  if (pages <= 1) return null;
  const cls = buttonVariants({ variant: "outline", size: "sm" });
  return (
    <nav className="flex items-center justify-between gap-2 text-sm">
      {page > 1 ? (
        <Link href={href(page - 1)} className={cls}>
          {labels.previous}
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground">{labels.page}</span>
      {page < pages ? (
        <Link href={href(page + 1)} className={cls}>
          {labels.next}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/** Wide tables scroll inside their box; the page itself never scrolls sideways. */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[40rem] border-collapse text-sm [&_td]:border-t [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 [&_th]:text-start [&_th]:font-medium [&_th]:text-muted-foreground">
        {children}
      </table>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function KeyValues({
  items,
}: {
  items: [React.ReactNode, React.ReactNode][];
}) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-medium break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Query-string helper for filter links (drops empty values). */
export function withQuery(
  path: string,
  params: Record<string, string | number | boolean | undefined | null>,
) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "" && v !== false)
      q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/** Catalog row state: archived wins over hidden. */
export function stateOf(row: {
  is_active: boolean;
  archived_at: string | null;
}) {
  return row.archived_at ? "archived" : row.is_active ? "active" : "hidden";
}
export const STATE_TONE = {
  active: "success",
  hidden: "warning",
  archived: "neutral",
} as const;

export const KYC_TONE = {
  none: "neutral",
  pending: "warning",
  verified: "success",
  rejected: "danger",
} as const;
