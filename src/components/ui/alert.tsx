import * as React from "react";

import { cn } from "@/lib/utils";

import { alertClasses } from "./styles";

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
      className={cn(alertClasses.base, alertClasses[tone], className)}
      {...props}
    />
  );
}

export { Alert };
