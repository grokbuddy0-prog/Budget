import * as React from "react";
import { Drawer as Vaul } from "vaul";
import { cn } from "@/lib/utils";

function Drawer(props: React.ComponentProps<typeof Vaul.Root>) {
  return <Vaul.Root shouldScaleBackground={false} {...props} />;
}

function DrawerOverlay({ className, ...props }: React.ComponentProps<typeof Vaul.Overlay>) {
  return (
    <Vaul.Overlay
      className={cn("fixed inset-0 z-50 bg-bg/70", className)}
      {...props}
    />
  );
}

function DrawerContent({
  className,
  children,
  title,
  ...props
}: React.ComponentProps<typeof Vaul.Content> & { title: string }) {
  return (
    <Vaul.Portal>
      <DrawerOverlay />
      <Vaul.Content
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-xl bg-surface outline-none",
          "shadow-[var(--shadow-sheet)]",
          className,
        )}
        {...props}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border" />
        <Vaul.Title className="px-4 pb-2 pt-3 text-base font-medium text-fg">
          {title}
        </Vaul.Title>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </Vaul.Content>
    </Vaul.Portal>
  );
}

export { Drawer, DrawerContent };
