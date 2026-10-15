"use client";

import { useRouter } from "next/navigation";
import type { User } from "@prisma/client";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyField, SelectField, SwitchField, TextField } from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import { ROLE_LABELS, options } from "@/lib/labels";
import { userSchema, type UserInput } from "@/lib/validations/team";
import { saveUser } from "@/server/team/actions";

const COLOURS = [
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#ca8a04",
  "#db2777",
];

export function UserForm({
  user,
  onDone,
}: {
  user?: Pick<
    User,
    "id" | "name" | "email" | "role" | "phone" | "color" | "hourlyCostCents" | "active"
  >;
  onDone?: () => void;
}) {
  const router = useRouter();
  const form = useZodForm(userSchema, {
    defaultValues: {
      name: user?.name ?? "",
      email: user?.email ?? "",
      role: user?.role ?? "TECHNICIAN",
      phone: user?.phone ?? "",
      color: user?.color ?? COLOURS[0],
      hourlyCost: user ? (user.hourlyCostCents / 100).toFixed(2) : "",
      active: user?.active ?? true,
      password: "",
    },
  });
  const action = useAction((v: UserInput) => saveUser(user?.id ?? null, v), {
    successMessage: user ? "User saved" : "User created",
    onSuccess: (d) => {
      onDone?.();
      if (user) router.refresh();
      else router.push(`/team/${d.id}`);
    },
  });
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => action.run(form.getValues(), form))}
        className="space-y-4"
        noValidate
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="name" label="Name" />
          <TextField name="email" label="Email (login)" type="email" autoComplete="off" />
          <SelectField name="role" label="Role" options={options(ROLE_LABELS)} />
          <TextField name="phone" label="Mobile" type="tel" />
          <MoneyField
            name="hourlyCost"
            label="Hourly cost"
            description="Wage + on-costs, for job profitability."
          />
          <FormField
            control={form.control}
            name="color"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Calendar colour</FormLabel>
                <FormControl>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {COLOURS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => field.onChange(c)}
                        className="size-7 rounded-full border-2 transition"
                        style={{
                          backgroundColor: c,
                          borderColor: field.value === c ? "var(--foreground)" : "transparent",
                        }}
                        aria-label={`Colour ${c}`}
                        aria-pressed={field.value === c}
                      />
                    ))}
                    <Input
                      type="color"
                      value={field.value}
                      onChange={(e) => field.onChange(e.target.value)}
                      className="h-7 w-10 p-0.5"
                      aria-label="Custom colour"
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <TextField
            name="password"
            label={user ? "New password" : "Starting password"}
            type="password"
            autoComplete="new-password"
            description={
              user
                ? "Leave blank to keep the current password."
                : "At least 10 characters with a letter and a number."
            }
          />
        </div>
        <SwitchField
          name="active"
          label="Active"
          description="Inactive users can't sign in and aren't shown on the schedule."
        />
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>{user ? "Save" : "Create user"}</SubmitButton>
        </div>
      </form>
    </Form>
  );
}
