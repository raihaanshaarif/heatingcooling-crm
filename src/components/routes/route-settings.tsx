"use client";

import { useRouter } from "next/navigation";
import { Loader2, MapPinned } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { TextField } from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import { routeSettingsSchema, type RouteSettingsInput } from "@/lib/validations/settings";
import { saveRouteSettings } from "@/server/settings-actions";
import { geocodeMissingAddresses } from "@/server/routes/actions";

export function RouteSettingsForm({ routeDayStart }: { routeDayStart: string }) {
  const router = useRouter();
  const form = useZodForm(routeSettingsSchema, { defaultValues: { routeDayStart } });
  const action = useAction((v: RouteSettingsInput) => saveRouteSettings(v), {
    successMessage: "Route settings saved",
    onSuccess: () => router.refresh(),
  });
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => action.run(form.getValues(), form))}
        className="flex flex-wrap items-end gap-3"
        noValidate
      >
        <TextField
          name="routeDayStart"
          label="Day starts at"
          type="time"
          className="w-56"
          description="Technicians leave the depot (or home) at this time."
        />
        <SubmitButton pending={action.pending}>Save</SubmitButton>
      </form>
    </Form>
  );
}

/** Admin: find every address that isn't on the map yet (Google, or suburb centres without a key). */
export function GeocodeMissingButton() {
  const router = useRouter();
  const action = useAction(geocodeMissingAddresses, {
    successMessage: (d) =>
      d.checked === 0
        ? "Every address is already on the map."
        : `${d.checked} address${d.checked === 1 ? "" : "es"} checked: ${d.located} found by Google, ${d.approximate} placed at the suburb centre, ${d.failed} not found.${d.usedGoogle ? "" : " (Google Maps isn't set up, so only suburb centres were used.)"}`,
    onSuccess: () => router.refresh(),
  });
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={action.pending}
      onClick={() => void action.run(undefined)}
    >
      {action.pending ? <Loader2 className="animate-spin" /> : <MapPinned />} Geocode missing
      addresses
    </Button>
  );
}
