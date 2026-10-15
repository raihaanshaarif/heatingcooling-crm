"use client";

import { useTransition } from "react";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { toast } from "sonner";

type Result<T> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

/**
 * Run a server action from a client component with a pending state, toasts and
 * (optionally) server-side field errors mapped back onto a react-hook-form form.
 */
export function useAction<I, T>(
  action: (input: I) => Promise<Result<T>>,
  options: {
    successMessage?: string | ((data: T) => string);
    onSuccess?: (data: T) => void;
    onError?: (error: string) => void;
  } = {},
) {
  const [pending, startTransition] = useTransition();
  const run = <F extends FieldValues>(input: I, form?: { setError: UseFormSetError<F> }) =>
    new Promise<Result<T>>((resolve) => {
      startTransition(async () => {
        const result = await action(input);
        if (result.ok) {
          const msg =
            typeof options.successMessage === "function"
              ? options.successMessage(result.data)
              : options.successMessage;
          if (msg) toast.success(msg);
          options.onSuccess?.(result.data);
        } else {
          if (form && result.fieldErrors) {
            for (const [field, errors] of Object.entries(result.fieldErrors)) {
              if (errors?.[0]) form.setError(field as Path<F>, { message: errors[0] });
            }
          }
          toast.error(result.error);
          options.onError?.(result.error);
        }
        resolve(result);
      });
    });
  return { run, pending };
}
