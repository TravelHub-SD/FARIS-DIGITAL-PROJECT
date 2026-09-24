import * as React from "react";

import { cn } from "@/lib/utils";

import { selectClasses } from "./styles";

// Native <select>: zero client JS, correct RTL, accessible on every phone.
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(selectClasses, className)}
      {...props}
    />
  );
}

export { NativeSelect };
