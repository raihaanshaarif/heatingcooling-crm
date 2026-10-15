"use client";

import { useForm, type UseFormProps } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";

/** react-hook-form typed with the schema's input (form values) and output (parsed values). */
export function useZodForm<
  S extends z.ZodType<Record<string, unknown>, z.ZodTypeDef, Record<string, unknown>>,
>(schema: S, options: Omit<UseFormProps<z.input<S>, unknown, z.output<S>>, "resolver">) {
  return useForm<z.input<S>, unknown, z.output<S>>({ ...options, resolver: zodResolver(schema) });
}
