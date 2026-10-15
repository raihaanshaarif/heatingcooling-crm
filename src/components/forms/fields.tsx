"use client";

import * as React from "react";
import { useFormContext } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Form fields wired to react-hook-form through FormProvider context. Every field
 * renders a label, the control, an optional description and the validation error.
 */
interface BaseFieldProps {
  name: string;
  label: string;
  description?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export function TextField({
  name,
  label,
  description,
  className,
  disabled,
  type = "text",
  placeholder,
  autoComplete,
  inputMode,
  prefix,
}: BaseFieldProps & {
  type?: React.HTMLInputTypeAttribute;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  prefix?: string;
}) {
  const { control } = useFormContext();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            {prefix ? (
              <div className="relative">
                <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">
                  {prefix}
                </span>
                <Input
                  {...field}
                  value={(field.value as string | number | null | undefined) ?? ""}
                  type={type}
                  placeholder={placeholder}
                  autoComplete={autoComplete}
                  inputMode={inputMode}
                  disabled={disabled}
                  className="pl-7"
                />
              </div>
            ) : (
              <Input
                {...field}
                value={(field.value as string | number | null | undefined) ?? ""}
                type={type}
                placeholder={placeholder}
                autoComplete={autoComplete}
                inputMode={inputMode}
                disabled={disabled}
              />
            )}
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function MoneyField(props: BaseFieldProps & { placeholder?: string }) {
  return (
    <TextField
      {...props}
      prefix="$"
      inputMode="decimal"
      placeholder={props.placeholder ?? "0.00"}
    />
  );
}

export function TextareaField({
  name,
  label,
  description,
  className,
  disabled,
  rows = 3,
  placeholder,
}: BaseFieldProps & { rows?: number; placeholder?: string }) {
  const { control } = useFormContext();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Textarea
              {...field}
              value={(field.value as string | null | undefined) ?? ""}
              rows={rows}
              placeholder={placeholder}
              disabled={disabled}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export const NONE = "none";

export function SelectField({
  name,
  label,
  description,
  className,
  disabled,
  options,
  placeholder = "Select…",
  allowEmpty,
  emptyLabel = "None",
  onValueChange,
}: BaseFieldProps & {
  options: SelectOption[];
  placeholder?: string;
  /** Adds a "None" option that sets the value to null. */
  allowEmpty?: boolean;
  emptyLabel?: string;
  onValueChange?: (value: string | null) => void;
}) {
  const { control } = useFormContext();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <Select
            value={(field.value as string | null | undefined) || (allowEmpty ? NONE : "")}
            onValueChange={(v) => {
              const value = v === NONE ? null : v;
              field.onChange(value);
              onValueChange?.(value);
            }}
            disabled={disabled}
          >
            <FormControl>
              <SelectTrigger onBlur={field.onBlur}>
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {allowEmpty && <SelectItem value={NONE}>{emptyLabel}</SelectItem>}
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function CheckboxField({ name, label, description, className, disabled }: BaseFieldProps) {
  const { control } = useFormContext();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={cn("flex flex-row items-start gap-2 space-y-0", className)}>
          <FormControl>
            <Checkbox
              checked={!!field.value}
              onCheckedChange={(v) => field.onChange(v === true)}
              disabled={disabled}
            />
          </FormControl>
          <div className="grid gap-1 leading-none">
            <FormLabel className="font-normal">{label}</FormLabel>
            {description && <FormDescription>{description}</FormDescription>}
            <FormMessage />
          </div>
        </FormItem>
      )}
    />
  );
}

export function SwitchField({ name, label, description, className, disabled }: BaseFieldProps) {
  const { control } = useFormContext();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem
          className={cn(
            "flex flex-row items-center justify-between gap-4 rounded-lg border p-3",
            className,
          )}
        >
          <div className="space-y-0.5">
            <FormLabel>{label}</FormLabel>
            {description && <FormDescription>{description}</FormDescription>}
          </div>
          <FormControl>
            <Switch checked={!!field.value} onCheckedChange={field.onChange} disabled={disabled} />
          </FormControl>
        </FormItem>
      )}
    />
  );
}

/** Multi-select rendered as a checkbox list (technicians, equipment, tags). */
export function CheckboxGroupField({
  name,
  label,
  description,
  className,
  options,
  emptyText = "Nothing to choose from.",
}: BaseFieldProps & {
  options: (SelectOption & { hint?: string; color?: string })[];
  emptyText?: string;
}) {
  const { control } = useFormContext();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const value = (field.value as string[] | undefined) ?? [];
        return (
          <FormItem className={className}>
            <FormLabel>{label}</FormLabel>
            {options.length === 0 ? (
              <p className="text-muted-foreground text-sm">{emptyText}</p>
            ) : (
              <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                {options.map((o) => {
                  const checked = value.includes(o.value);
                  return (
                    <label key={o.value} className="flex cursor-pointer items-start gap-2 text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) =>
                          field.onChange(
                            v === true ? [...value, o.value] : value.filter((x) => x !== o.value),
                          )
                        }
                      />
                      <span className="leading-tight">
                        {o.color && (
                          <span
                            className="mr-1.5 inline-block size-2 rounded-full"
                            style={{ backgroundColor: o.color }}
                          />
                        )}
                        {o.label}
                        {o.hint && (
                          <span className="text-muted-foreground block text-xs">{o.hint}</span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {description && <FormDescription>{description}</FormDescription>}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}
