"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAction } from "@/components/forms/use-action";
import { SMS_MAX_LENGTH } from "@/lib/validations/settings";
import { sendOneOffSms } from "@/server/sms/actions";
import type { SmsComposeContext } from "@/server/sms/queries";
import { SmsCounter } from "./sms-counter";

/** One-off text from the client or job page: pick a template, edit, see the count, send. */
export function SendSmsForm({
  context,
  onDone,
}: {
  context: SmsComposeContext;
  onDone?: () => void;
}) {
  const router = useRouter();
  const first = context.templates[0];
  const [templateKey, setTemplateKey] = useState<string>(first?.key ?? "");
  const [body, setBody] = useState(first?.body ?? "");
  const action = useAction(sendOneOffSms, {
    successMessage: (d) => d.message,
    onSuccess: () => {
      router.refresh();
      onDone?.();
    },
  });

  if (context.blockedReason) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <MessageSquareOff className="mt-0.5 size-4 shrink-0" />
          <p>
            Can&apos;t text {context.clientName}: {context.blockedReason}.
          </p>
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onDone}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run({ clientId: context.clientId, jobId: context.jobId, body });
      }}
    >
      <p className="text-sm">
        To <span className="font-medium">{context.clientName}</span> on{" "}
        <span className="font-medium tabular-nums">{context.to}</span>
      </p>
      {!context.providerReady && (
        <p className="text-muted-foreground rounded-md border border-dashed p-2 text-xs">
          SMS isn&apos;t set up yet (Integrations), so this text will be logged but not sent.
        </p>
      )}
      <div className="space-y-2">
        <Label htmlFor="sms-template">Template</Label>
        <Select
          value={templateKey}
          onValueChange={(key) => {
            setTemplateKey(key);
            const t = context.templates.find((x) => x.key === key);
            if (t) setBody(t.body);
          }}
        >
          <SelectTrigger id="sms-template" className="w-full">
            <SelectValue placeholder="Choose a template" />
          </SelectTrigger>
          <SelectContent>
            {context.templates.map((t) => (
              <SelectItem key={t.key} value={t.key}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="sms-body">Message</Label>
        <Textarea
          id="sms-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          maxLength={SMS_MAX_LENGTH}
        />
        <SmsCounter text={body} />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={action.pending || !body.trim()}>
          Send SMS
        </Button>
      </div>
    </form>
  );
}
