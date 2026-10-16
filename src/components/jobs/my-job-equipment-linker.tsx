"use client";

import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { FormDialog } from "@/components/forms/form-dialog";
import { useAction } from "@/components/forms/use-action";
import { getPropertyEquipmentOptions, linkJobEquipment } from "@/server/jobs/actions";

interface EquipmentOption {
  value: string;
  label: string;
  hint?: string;
}

export function MyJobEquipmentLinker({
  jobId,
  propertyId,
  linkedEquipmentIds,
  disabled = false,
}: {
  jobId: string;
  propertyId: string | null;
  linkedEquipmentIds: string[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<EquipmentOption[]>([]);
  const [selected, setSelected] = useState<string[]>(linkedEquipmentIds);
  const [loading, setLoading] = useState(false);

  const save = useAction(linkJobEquipment, {
    successMessage: "Equipment links updated",
    onSuccess: () => setOpen(false),
  });

  useEffect(() => {
    setSelected(linkedEquipmentIds);
  }, [linkedEquipmentIds]);

  useEffect(() => {
    let cancelled = false;
    if (!open) return () => {};
    if (!propertyId) {
      setOptions([]);
      return () => {};
    }

    setLoading(true);
    void getPropertyEquipmentOptions({ id: propertyId }).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOptions(result.data);
    });

    return () => {
      cancelled = true;
    };
  }, [open, propertyId]);

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    );
  };

  return (
    <FormDialog
      title="Link equipment to this job"
      description="Select the units you serviced on site."
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm" variant="outline" disabled={disabled || !propertyId}>
          <Link2 /> Link equipment
        </Button>
      }
    >
      {(close) => (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save.run({ id: jobId, equipmentIds: selected }).then((result) => {
              if (result.ok) close();
            });
          }}
        >
          {!propertyId ? (
            <p className="text-muted-foreground text-sm">
              This job has no site selected, so equipment cannot be linked yet.
            </p>
          ) : loading ? (
            <p className="text-muted-foreground text-sm">Loading equipment...</p>
          ) : options.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No equipment records exist for this site yet. Ask office/admin to add equipment under
              the client property first.
            </p>
          ) : (
            <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
              {options.map((option) => (
                <label key={option.value} className="flex items-start gap-3 rounded-md border p-3">
                  <Checkbox
                    checked={selected.includes(option.value)}
                    onCheckedChange={() => toggle(option.value)}
                  />
                  <span className="space-y-1">
                    <Label className="cursor-pointer">{option.label}</Label>
                    {option.hint && (
                      <span className="text-muted-foreground block text-xs">{option.hint}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={save.pending || !propertyId || loading || options.length === 0}
            >
              Save links
            </Button>
          </div>
        </form>
      )}
    </FormDialog>
  );
}
