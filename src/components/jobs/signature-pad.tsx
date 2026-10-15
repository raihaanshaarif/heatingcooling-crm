"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SignatureCanvas from "react-signature-canvas";
import { Eraser, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/forms/use-action";
import { saveSignature } from "@/server/jobs/actions";

/** Customer sign-off captured on the technician's phone. */
export function SignaturePad({
  jobId,
  defaultName,
  onDone,
}: {
  jobId: string;
  defaultName?: string | null;
  onDone?: () => void;
}) {
  const router = useRouter();
  const pad = useRef<SignatureCanvas>(null);
  const [name, setName] = useState(defaultName ?? "");
  const [empty, setEmpty] = useState(true);
  const action = useAction(saveSignature, {
    successMessage: "Signature saved",
    onSuccess: () => {
      onDone?.();
      router.refresh();
    },
  });
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="sig-name">Customer name</Label>
        <Input
          id="sig-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="space-y-1">
        <Label>Signature</Label>
        <div className="overflow-hidden rounded-md border bg-white">
          <SignatureCanvas
            ref={pad}
            penColor="#111827"
            canvasProps={{ className: "h-48 w-full touch-none", "aria-label": "Signature pad" }}
            onEnd={() => setEmpty(pad.current?.isEmpty() ?? true)}
          />
        </div>
        <p className="text-muted-foreground text-xs">Ask the customer to sign with their finger.</p>
      </div>
      <div className="flex justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            pad.current?.clear();
            setEmpty(true);
          }}
        >
          <Eraser /> Clear
        </Button>
        <Button
          type="button"
          disabled={empty || !name.trim() || action.pending}
          onClick={() => {
            const dataUrl = pad.current?.getTrimmedCanvas().toDataURL("image/png");
            if (dataUrl) void action.run({ id: jobId, signedByName: name, dataUrl });
          }}
        >
          <PenLine /> Save signature
        </Button>
      </div>
    </div>
  );
}
