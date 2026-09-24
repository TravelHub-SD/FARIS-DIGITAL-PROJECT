import * as React from "react";

import { cn } from "@/lib/utils";

function Alert({
  className,
  tone = "info",
  ...props
}: React.ComponentProps<"div"> & {
  tone?: "info" | "error" | "success" | "warning";
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      data-tone={tone}
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        tone === "error" &&
          "border-destructive/40 bg-destructive/10 text-destructive",
        tone === "success" &&
          "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
        tone === "warning" &&
          "border-highlight/40 bg-highlight/10 text-foreground",
        tone === "info" && "border-primary/30 bg-primary/5 text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Alert };
