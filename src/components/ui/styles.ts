// Plain class strings with no imports, shared by the shadcn components and by
// the few client components on public pages, which must not pull
// tailwind-merge / Radix into the public JS bundle.

export const inputClasses =
  "flex h-10 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 file:me-3 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground";

export const selectClasses =
  "flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export const labelClasses = "text-sm leading-none font-medium select-none";

export const alertClasses = {
  base: "rounded-md border px-3 py-2 text-sm",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  success:
    "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
  warning: "border-highlight/40 bg-highlight/10 text-foreground",
  info: "border-primary/30 bg-primary/5 text-foreground",
} as const;
