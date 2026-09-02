import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-border transition-colors",
        "data-[state=checked]:bg-primary data-[state=unchecked]:bg-surface-2",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-fg transition-transform",
          "data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-0.5",
          "data-[state=checked]:bg-primary-fg",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
