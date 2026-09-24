import * as React from "react";

import { cn } from "@/lib/utils";

import { inputClasses } from "./styles";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(inputClasses, className)}
      {...props}
    />
  );
}

export { Input };
