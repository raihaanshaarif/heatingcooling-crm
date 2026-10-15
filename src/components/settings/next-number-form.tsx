"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/components/forms/use-action";
import { setNextNumber } from "@/server/settings-actions";

export function NextNumberForm({
  counterKey,
  label,
  prefix,
  next,
}: {
  counterKey: "QUOTE" | "JOB" | "INVOICE" | "CREDIT_NOTE";
  label: string;
  prefix: string;
  next: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(next));
  const action = useAction(setNextNumber, {
    successMessage: `Next ${label.toLowerCase()} number updated`,
    onSuccess: () => router.refresh(),
  });
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run({ key: counterKey, next: Number(value) });
      }}
    >
      <span className="w-28 text-sm">{label}</span>
      <span className="text-muted-foreground text-sm">{prefix}-</span>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        inputMode="numeric"
        className="h-8 w-28"
        aria-label={`Next ${label} number`}
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={action.pending || value === String(next)}
      >
        Set
      </Button>
    </form>
  );
}
