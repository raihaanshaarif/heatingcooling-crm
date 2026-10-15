"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";

/**
 * Button + dialog for use from Server Components. The child form receives an
 * `onDone` prop that closes the dialog.
 */
export function FormDialogButton({
  label,
  title,
  description,
  icon,
  variant = "outline",
  size,
  wide,
  children,
}: {
  label: React.ReactNode;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  wide?: boolean;
  children: React.ReactElement<{ onDone?: () => void }>;
}) {
  return (
    <FormDialog
      title={title}
      description={description}
      wide={wide}
      trigger={
        <Button variant={variant} size={size}>
          {icon}
          {label}
        </Button>
      }
    >
      {(close) => React.cloneElement(children, { onDone: close })}
    </FormDialog>
  );
}
