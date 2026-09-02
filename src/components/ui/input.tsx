import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-11 w-full rounded-md border border-border bg-surface-2 px-3 text-sm text-fg",
        "placeholder:text-subtle transition-[border-color,box-shadow] duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        "disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}

/** Native date field that closes the calendar as soon as a day is picked. */
function DateInput({
  value,
  onValue,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type" | "onChange" | "value"> & {
  value: string;
  onValue: (value: string) => void;
}) {
  return (
    <Input
      type="date"
      className={className}
      value={value}
      onChange={(e) => {
        const next = e.target.value;
        onValue(next);
        if (/^\d{4}-\d{2}-\d{2}$/.test(next)) e.currentTarget.blur();
      }}
      {...props}
    />
  );
}

function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "flex h-11 w-full rounded-md border border-border bg-surface-2 px-3 text-sm text-fg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        "disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-24 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg",
        "placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        className,
      )}
      {...props}
    />
  );
}

export { Input, DateInput, NativeSelect, Textarea };