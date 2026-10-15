"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SubmitButton({
  pending,
  children,
  className,
  size,
  variant,
}: {
  pending: boolean;
  children: React.ReactNode;
  className?: string;
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  return (
    <Button type="submit" disabled={pending} className={className} size={size} variant={variant}>
      {pending && <Loader2 className="animate-spin" />}
      {children}
    </Button>
  );
}
