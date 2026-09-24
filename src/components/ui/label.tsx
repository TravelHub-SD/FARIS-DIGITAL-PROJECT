import * as React from "react";

import { cn } from "@/lib/utils";

import { labelClasses } from "./styles";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(labelClasses, className)}
      {...props}
    />
  );
}

export { Label };
