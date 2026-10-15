"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { parseAsBoolean, useQueryState } from "nuqs";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";

/**
 * "New X" button + dialog, usable from Server Components. Also opens when the URL
 * has ?new=1 (used by quick actions).
 */
export function NewRecordDialog({
  label,
  title,
  description,
  wide,
  children,
}: {
  label: string;
  title: string;
  description?: string;
  wide?: boolean;
  /** The form; it receives an `onDone` prop that closes the dialog. */
  children: React.ReactElement<{ onDone?: () => void }>;
}) {
  const [open, setOpen] = useQueryState(
    "new",
    parseAsBoolean.withDefault(false).withOptions({ history: "replace" }),
  );
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => void setOpen(o ? true : null)}
      title={title}
      description={description}
      wide={wide}
      trigger={
        <Button>
          <Plus /> {label}
        </Button>
      }
    >
      {(close) => React.cloneElement(children, { onDone: close })}
    </FormDialog>
  );
}
