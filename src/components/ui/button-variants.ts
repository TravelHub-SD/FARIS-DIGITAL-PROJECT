import { cva, type VariantProps } from "class-variance-authority";

// Only cva (≈1 KB): safe to import from light client components.
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md whitespace-nowrap transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        highlight:
          "bg-highlight text-highlight-foreground shadow-xs hover:bg-highlight/90",
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
        soft: "bg-primary-soft text-primary-text hover:bg-primary-soft/80",
      },
      size: {
        default: "h-9 px-4 py-2 text-sm font-medium has-[>svg]:px-3",
        sm: "h-8 gap-1.5 rounded-md px-3 text-sm font-medium has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 text-sm font-medium has-[>svg]:px-4",
        icon: "size-10 text-sm font-medium",
        /** Main actions on phones: 48 px tall. (Text size and weight live
         *  in each size, not the base, so they never conflict.) */
        xl: "h-12 rounded-xl px-6 text-base font-bold has-[>svg]:px-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
