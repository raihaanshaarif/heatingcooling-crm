"use client";

import { useRouter } from "next/navigation";
import { Form } from "@/components/ui/form";
import { SwitchField, TextField } from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import { routeStartSchema, type RouteStartInput } from "@/lib/validations/routes";
import { saveRouteStart } from "@/server/routes/actions";

/** Team profile: start the day from home instead of the depot. */
export function RouteStartForm({
  user,
  onDone,
}: {
  user: { id: string; routeFromHome: boolean; homeAddress: string | null };
  onDone?: () => void;
}) {
  const router = useRouter();
  const form = useZodForm(routeStartSchema, {
    defaultValues: {
      userId: user.id,
      routeFromHome: user.routeFromHome,
      homeAddress: user.homeAddress ?? "",
    },
  });
  const action = useAction((v: RouteStartInput) => saveRouteStart(v), {
    successMessage: "Route start saved",
    onSuccess: () => {
      onDone?.();
      router.refresh();
    },
  });
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => action.run(form.getValues(), form))}
        className="space-y-4"
        noValidate
      >
        <SwitchField
          name="routeFromHome"
          label="Start from home"
          description="Plan this person's day from their home (they take the van home) instead of the depot."
        />
        <TextField
          name="homeAddress"
          label="Home address"
          placeholder="12 Smith St, Box Hill VIC 3128"
          description="Street, suburb, state and postcode. Only used for route planning; never shown to clients."
        />
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>Save</SubmitButton>
        </div>
      </form>
    </Form>
  );
}
